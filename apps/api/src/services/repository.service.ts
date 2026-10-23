import { eq, and, desc, sql as drizzleSql } from 'drizzle-orm';
import type {
  AnalysisResult,
  LandmarkContent,
  RepositoryMetadata,
  RecentRepository,
} from '@archlens/shared';
import { db } from '../db/index.js';
import { repositories, analyses } from '../db/schema.js';
import { githubService, GitHubService } from './github.service.js';
import { analyzeRepositoryData } from './analyzer/index.js';
import { selectManifestPathsToFetch, runWithConcurrency } from './analyzer/manifest-selector.js';

export class RepositoryService {
  private gh: GitHubService;
  private inFlightAnalyses = new Map<string, Promise<AnalysisResult>>();

  constructor(customGhService?: GitHubService) {
    this.gh = customGhService || githubService;
  }

  private formatAnalysisResult(
    repoRow: {
      id: number;
      owner: string;
      name: string;
      url: string;
      defaultBranch: string;
      description: string | null;
      stars: number;
      forks: number;
      primaryLanguage: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    analysisRow: {
      commitSha: string | null;
      techStack: any;
      architecture: any;
      metrics: any;
      tree: any;
      analyzedAt: Date;
    }
  ): AnalysisResult {
    return {
      repository: {
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
      },
      commitSha: analysisRow.commitSha ?? null,
      techStack: analysisRow.techStack,
      architecture: analysisRow.architecture,
      metrics: analysisRow.metrics,
      tree: analysisRow.tree,
      analyzedAt: analysisRow.analyzedAt.toISOString(),
    };
  }

  async analyze(
    owner: string,
    repo: string,
    options?: { signal?: AbortSignal }
  ): Promise<AnalysisResult> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const timings: Record<string, number> = {};
    const t0 = Date.now();

    // 1. Resolve current HEAD commit SHA (lightweight request)
    const headCommit = await this.gh.getHeadCommit(cleanOwner, cleanRepo, 'HEAD', {
      signal: options?.signal,
    });
    const currentCommitSha = headCommit.commitSha;
    timings.resolveSha = Date.now() - t0;

    // 2. Query repository record in PostgreSQL (case-insensitive)
    const [existingRepo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          drizzleSql`lower(${repositories.owner}) = lower(${cleanOwner})`,
          drizzleSql`lower(${repositories.name}) = lower(${cleanRepo})`
        )
      )
      .limit(1);

    if (existingRepo) {
      // 2a. Check for existing analysis by repository_id + commit_sha
      const [existingAnalysis] = await db
        .select()
        .from(analyses)
        .where(
          and(
            eq(analyses.repositoryId, existingRepo.id),
            eq(analyses.commitSha, currentCommitSha)
          )
        )
        .limit(1);

      if (existingAnalysis) {
        timings.db = Date.now() - (t0 + timings.resolveSha);
        timings.totalMs = Date.now() - t0;
        console.log(
          `[RepositoryService] Analysis cache hit for ${cleanOwner}/${cleanRepo}@${currentCommitSha}:`,
          timings
        );
        return this.formatAnalysisResult(existingRepo, existingAnalysis);
      }

      // 2b. Backward compatibility: check if existing analysis stored legacy treeSha
      if (headCommit.treeSha) {
        const [legacyAnalysis] = await db
          .select()
          .from(analyses)
          .where(
            and(
              eq(analyses.repositoryId, existingRepo.id),
              eq(analyses.commitSha, headCommit.treeSha)
            )
          )
          .limit(1);

        if (legacyAnalysis) {
          // Safely upgrade legacy row to actual commit SHA
          await db
            .update(analyses)
            .set({ commitSha: currentCommitSha })
            .where(eq(analyses.id, legacyAnalysis.id));

          legacyAnalysis.commitSha = currentCommitSha;
          timings.db = Date.now() - (t0 + timings.resolveSha);
          timings.totalMs = Date.now() - t0;
          console.log(
            `[RepositoryService] Analysis legacy tree-SHA migrated to commit-SHA for ${cleanOwner}/${cleanRepo}:`,
            timings
          );
          return this.formatAnalysisResult(existingRepo, legacyAnalysis);
        }
      }
    }

    // 3. Single-flight for concurrent cold analyses on the same repo & commit SHA
    const flightKey = `${cleanOwner.toLowerCase()}/${cleanRepo.toLowerCase()}:${currentCommitSha}`;
    const inFlight = this.inFlightAnalyses.get(flightKey);
    if (inFlight) {
      return await inFlight;
    }

    const coldPromise = this.performColdAnalysis(
      cleanOwner,
      cleanRepo,
      currentCommitSha,
      headCommit.treeSha,
      timings,
      t0,
      options?.signal
    );

    this.inFlightAnalyses.set(flightKey, coldPromise);
    try {
      return await coldPromise;
    } finally {
      this.inFlightAnalyses.delete(flightKey);
    }
  }

  private async performColdAnalysis(
    cleanOwner: string,
    cleanRepo: string,
    currentCommitSha: string,
    headTreeSha: string | undefined,
    timings: Record<string, number>,
    t0: number,
    signal?: AbortSignal
  ): Promise<AnalysisResult> {
    // 1. Fetch metadata
    const tMeta = Date.now();
    const repoMetadata = await this.gh.getRepositoryMetadata(cleanOwner, cleanRepo, { signal });
    timings.metadata = Date.now() - tMeta;

    // 2. Upsert repository in PostgreSQL
    const tDbRepo = Date.now();
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

    // 3. Fetch full recursive tree from GitHub
    const tTree = Date.now();
    const treeRef = headTreeSha || currentCommitSha || repoMetadata.defaultBranch;
    const treeResult = await this.gh.getGitTree(cleanOwner, cleanRepo, treeRef);
    timings.tree = Date.now() - tTree;

    // 4. Fetch bounded manifests (workspace-aware, capped at 25 manifests) with bounded concurrency (4 parallel workers)
    const tManifests = Date.now();
    const manifestContents: Record<string, string> = {};
    const candidateManifestPaths = selectManifestPathsToFetch(treeResult.tree, 25);

    await runWithConcurrency(candidateManifestPaths, 4, async (manifestPath) => {
      try {
        const file = await this.gh.getFileContent(
          cleanOwner,
          cleanRepo,
          manifestPath,
          currentCommitSha
        );
        if (!file.isTruncated) {
          manifestContents[manifestPath] = file.content;
        }
      } catch (err: unknown) {
        console.warn(
          `[RepositoryService] Optional manifest '${manifestPath}' failed to load for ${cleanOwner}/${cleanRepo}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    });
    timings.manifests = Date.now() - tManifests;

    // 5. Perform deterministic analysis with the REAL commit SHA
    const tAnalyze = Date.now();
    const analysis = analyzeRepositoryData({
      repository: repoMetadata,
      commitSha: currentCommitSha,
      rawTree: treeResult.tree,
      manifestContents,
      analyzedAt: new Date().toISOString(),
    });
    timings.analyze = Date.now() - tAnalyze;

    // 6. Store analysis record in PostgreSQL
    const tDb = Date.now();
    await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: currentCommitSha,
        techStack: analysis.techStack,
        architecture: analysis.architecture,
        metrics: analysis.metrics,
        tree: analysis.tree,
        analyzedAt: new Date(analysis.analyzedAt),
      })
      .onConflictDoUpdate({
        target: [analyses.repositoryId, analyses.commitSha],
        set: {
          techStack: analysis.techStack,
          architecture: analysis.architecture,
          metrics: analysis.metrics,
          tree: analysis.tree,
          analyzedAt: new Date(analysis.analyzedAt),
        },
      });

    timings.db = Date.now() - tDb + (Date.now() - tDbRepo);
    timings.totalMs = Date.now() - t0;
    console.log(
      `[RepositoryService] Cold analysis completed for ${cleanOwner}/${cleanRepo}@${currentCommitSha}:`,
      timings
    );

    analysis.repository.id = String(repoRow.id);
    return analysis;
  }

  async getLatestAnalysisWithRecord(
    owner: string,
    repo: string
  ): Promise<{ analysis: AnalysisResult; analysisId: number; repositoryId: number } | null> {
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

    const analysis: AnalysisResult = {
      repository,
      commitSha: analysisRow.commitSha,
      techStack: analysisRow.techStack,
      architecture: analysisRow.architecture,
      metrics: analysisRow.metrics,
      tree: analysisRow.tree,
      analyzedAt: analysisRow.analyzedAt.toISOString(),
    };

    return {
      analysis,
      analysisId: analysisRow.id,
      repositoryId: repoRow.id,
    };
  }

  async getLatestAnalysis(owner: string, repo: string): Promise<AnalysisResult | null> {
    const record = await this.getLatestAnalysisWithRecord(owner, repo);
    return record ? record.analysis : null;
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

    // Ensure repository exists and is public (rejects unanalyzed private repos)
    const record = await this.getLatestAnalysisWithRecord(cleanOwner, cleanRepo);
    if (!record) {
      await this.gh.getRepositoryMetadata(cleanOwner, cleanRepo);
    }

    return this.gh.getFileContent(cleanOwner, cleanRepo, cleanPath, ref);
  }

  async getRecentRepositories(limit = 10): Promise<RecentRepository[]> {
    const clampedLimit = Math.max(1, Math.min(limit, 50));

    const rows = await db
      .select({
        owner: repositories.owner,
        name: repositories.name,
        language: repositories.primaryLanguage,
        analyzedAt: analyses.analyzedAt,
        stars: repositories.stars,
      })
      .from(analyses)
      .innerJoin(repositories, eq(analyses.repositoryId, repositories.id))
      .orderBy(desc(analyses.analyzedAt))
      .limit(clampedLimit * 5);

    const seen = new Set<string>();
    const recents: RecentRepository[] = [];

    for (const r of rows) {
      const key = `${r.owner}/${r.name}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        recents.push({
          owner: r.owner,
          name: r.name,
          language: r.language,
          analyzedAt: r.analyzedAt.toISOString(),
          stars: r.stars,
        });
        if (recents.length >= clampedLimit) break;
      }
    }

    return recents;
  }
}

export const repositoryService = new RepositoryService();
