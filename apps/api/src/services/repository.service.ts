import { eq, and, desc, sql as drizzleSql } from 'drizzle-orm';
import type { AnalysisResult, LandmarkContent, RepositoryMetadata } from '@archlens/shared';
import { db } from '../db/index.js';
import { repositories, analyses } from '../db/schema.js';
import { githubService, GitHubService } from './github.service.js';
import { analyzeRepositoryData } from './analyzer/index.js';

export class RepositoryService {
  private gh: GitHubService;

  constructor(customGhService?: GitHubService) {
    this.gh = customGhService || githubService;
  }

  async analyze(owner: string, repo: string): Promise<AnalysisResult> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');

    // 1. Fetch metadata and tree from GitHub REST API
    const repoMetadata = await this.gh.getRepositoryMetadata(cleanOwner, cleanRepo);
    const treeResult = await this.gh.getGitTree(cleanOwner, cleanRepo, repoMetadata.defaultBranch);

    // 2. Fetch key manifests for deeper dependency inspection
    const manifestContents: Record<string, string> = {};
    const keyManifestPaths = [
      'package.json',
      'pnpm-workspace.yaml',
      'Cargo.toml',
      'go.mod',
      'pyproject.toml',
      'requirements.txt',
    ];

    for (const item of treeResult.tree) {
      if (item.type === 'blob' && keyManifestPaths.includes(item.path)) {
        try {
          const file = await this.gh.getFileContent(
            cleanOwner,
            cleanRepo,
            item.path,
            treeResult.sha || repoMetadata.defaultBranch
          );
          if (!file.isTruncated) {
            manifestContents[item.path] = file.content;
          }
        } catch {
          // Non-critical: continue even if a specific manifest fails to load
        }
      }
    }

    // 3. Perform deterministic analysis
    const analysis = analyzeRepositoryData({
      repository: repoMetadata,
      commitSha: treeResult.sha,
      rawTree: treeResult.tree,
      manifestContents,
      analyzedAt: new Date().toISOString(),
    });

    // 4. Upsert repository in PostgreSQL
    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: cleanOwner,
        name: cleanRepo,
        url: repoMetadata.url,
        defaultBranch: repoMetadata.defaultBranch,
        description: repoMetadata.description,
        stars: repoMetadata.stars,
        forks: repoMetadata.forks,
        primaryLanguage: repoMetadata.primaryLanguage,
        createdAt: new Date(repoMetadata.createdAt),
        updatedAt: new Date(repoMetadata.updatedAt),
      })
      .onConflictDoUpdate({
        target: [repositories.owner, repositories.name],
        set: {
          url: repoMetadata.url,
          defaultBranch: repoMetadata.defaultBranch,
          description: repoMetadata.description,
          stars: repoMetadata.stars,
          forks: repoMetadata.forks,
          primaryLanguage: repoMetadata.primaryLanguage,
          updatedAt: new Date(repoMetadata.updatedAt),
        },
      })
      .returning();

    // 5. Store analysis record
    await db.insert(analyses).values({
      repositoryId: repoRow.id,
      commitSha: analysis.commitSha,
      techStack: analysis.techStack,
      architecture: analysis.architecture,
      metrics: analysis.metrics,
      tree: analysis.tree,
      analyzedAt: new Date(analysis.analyzedAt),
    });

    // Update repository id with Postgres generated id
    analysis.repository.id = String(repoRow.id);

    return analysis;
  }

  async getLatestAnalysis(owner: string, repo: string): Promise<AnalysisResult | null> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');

    const [repoRow] = await db
      .select()
      .from(repositories)
      .where(
        and(
          drizzleSql`lower(${repositories.owner}) = lower(${cleanOwner})`,
          drizzleSql`lower(${repositories.name}) = lower(${cleanRepo})`
        )
      )
      .limit(1);

    if (!repoRow) {
      return null;
    }

    const [analysisRow] = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id))
      .orderBy(desc(analyses.analyzedAt))
      .limit(1);

    if (!analysisRow) {
      return null;
    }

    const repository: RepositoryMetadata = {
      id: String(repoRow.id),
      owner: repoRow.owner,
      name: repoRow.name,
      url: repoRow.url,
      defaultBranch: repoRow.defaultBranch,
      description: repoRow.description,
      stars: repoRow.stars,
      forks: repoRow.forks,
      primaryLanguage: repoRow.primaryLanguage,
      createdAt: repoRow.createdAt.toISOString(),
      updatedAt: repoRow.updatedAt.toISOString(),
    };

    return {
      repository,
      commitSha: analysisRow.commitSha,
      techStack: analysisRow.techStack,
      architecture: analysisRow.architecture,
      metrics: analysisRow.metrics,
      tree: analysisRow.tree,
      analyzedAt: analysisRow.analyzedAt.toISOString(),
    };
  }

  async getLandmarkContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<LandmarkContent> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');

    // Path traversal check
    if (cleanPath.includes('..')) {
      throw new Error('Invalid path: directory traversal is not allowed.');
    }

    return this.gh.getFileContent(cleanOwner, cleanRepo, cleanPath, ref);
  }
}

export const repositoryService = new RepositoryService();
