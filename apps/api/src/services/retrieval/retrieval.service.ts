import { db, sql, hasPgVectorSupport } from '../../db/index.js';
import { codeChunks, analyses } from '../../db/schema.js';
import type { IEmbeddingProvider } from '../ai/embeddings/embedding.interface.js';
import { EmbeddingProviderFactory } from '../ai/embeddings/embedding-provider.factory.js';
import { CodeChunker, type ChunkInputFile } from './chunker.js';
import type { SearchQuery, SearchResponse, SearchResultItem, FileCategory } from '@archlens/shared';
import { eq, and } from 'drizzle-orm';
import { GitHubService } from '../github.service.js';
import { RepositoryService } from '../repository.service.js';

export class RepositoryNotAnalyzedError extends Error {
  constructor(message = 'Repository has not been analyzed yet.') {
    super(message);
    this.name = 'RepositoryNotAnalyzedError';
  }
}

export class RepositoryNotFoundError extends Error {
  constructor(message = 'Repository not found.') {
    super(message);
    this.name = 'RepositoryNotFoundError';
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return Math.max(0, Math.min(1, dot / denominator));
}

export class RetrievalService {
  private embeddingProvider: IEmbeddingProvider;
  private chunker: CodeChunker;
  private githubService: GitHubService;
  private repoService: RepositoryService;

  constructor(
    embeddingProvider?: IEmbeddingProvider,
    chunker?: CodeChunker,
    githubService?: GitHubService,
    repoService?: RepositoryService
  ) {
    this.embeddingProvider = embeddingProvider || EmbeddingProviderFactory.create();
    this.chunker = chunker || new CodeChunker();
    this.githubService = githubService || new GitHubService();
    this.repoService = repoService || new RepositoryService(this.githubService);
  }

  /**
   * Indexes a collection of files for a specific analysis snapshot.
   * If chunks already exist for this analysis, indexing is skipped (idempotent).
   */
  async indexFiles(
    analysisId: number,
    files: ChunkInputFile[]
  ): Promise<{ indexedChunks: number }> {
    // Check if already indexed
    const existing = await db
      .select({ id: codeChunks.id })
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, analysisId))
      .limit(1);

    if (existing.length > 0) {
      return { indexedChunks: existing.length };
    }

    const chunks = this.chunker.chunkRepository(files);
    if (chunks.length === 0) {
      return { indexedChunks: 0 };
    }

    // Generate embeddings
    const contents = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embed(contents);

    const isVectorSupported = await hasPgVectorSupport();

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i] || null;

      await db
        .insert(codeChunks)
        .values({
          analysisId,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          language: chunk.language,
          category: chunk.category,
          embedding,
          createdAt: new Date(),
        })
        .onConflictDoNothing();

      // If pgvector is supported, also store in vector column
      if (isVectorSupported && embedding && embedding.length > 0) {
        try {
          const vectorStr = `[${embedding.join(',')}]`;
          await sql`
            UPDATE code_chunks
            SET embedding_vec = ${vectorStr}::vector
            WHERE analysis_id = ${analysisId}
              AND file_path = ${chunk.filePath}
              AND chunk_index = ${chunk.chunkIndex};
          `;
        } catch {
          // Graceful fallback if vector column update fails
        }
      }
    }

    return { indexedChunks: chunks.length };
  }

  /**
   * Automatically indexes landmark and entrypoint files for an existing analysis record.
   */
  async indexAnalysis(
    owner: string,
    repo: string,
    analysisId: number
  ): Promise<{ indexedChunks: number }> {
    const analysisRow = await db.query.analyses.findFirst({
      where: eq(analyses.id, analysisId),
    });

    if (!analysisRow) {
      throw new RepositoryNotAnalyzedError(`Analysis with ID ${analysisId} not found.`);
    }

    // Collect candidate files from analysis landmarks and top tree items
    const candidatePaths = new Set<string>();

    // 1. Landmarks
    for (const landmark of analysisRow.architecture.keyLandmarks) {
      candidatePaths.add(landmark.path);
    }

    // 2. Primary entrypoints
    for (const ep of analysisRow.architecture.primaryEntrypoints) {
      candidatePaths.add(ep);
    }

    // 3. Top source and doc files from tree
    for (const item of analysisRow.tree) {
      if (candidatePaths.size >= 50) break;
      if (item.category === 'source' || item.category === 'doc') {
        candidatePaths.add(item.path);
      }
    }

    const filesToChunk: ChunkInputFile[] = [];

    for (const path of candidatePaths) {
      try {
        const contentData = await this.githubService.getFileContent(
          owner,
          repo,
          path,
          analysisRow.commitSha || undefined
        );

        if (contentData && contentData.content) {
          // Find category and language from tree if available
          const treeItem = analysisRow.tree.find((t) => t.path === path);
          const category: FileCategory = (treeItem?.category as FileCategory) || 'source';

          filesToChunk.push({
            path,
            content: contentData.content,
            size: contentData.size,
            category,
            language: treeItem?.extension || null,
          });
        }
      } catch {
        // Continue if single landmark fetch fails
      }
    }

    return this.indexFiles(analysisId, filesToChunk);
  }

  /**
   * Executes semantic search against a repository's latest analysis.
   */
  async search(
    owner: string,
    repo: string,
    queryInput: SearchQuery,
    providedAnalysisId?: number
  ): Promise<SearchResponse> {
    const startTime = Date.now();

    // 1. Resolve analysis
    let analysisId: number;
    if (providedAnalysisId) {
      analysisId = providedAnalysisId;
    } else {
      const latest = await this.repoService.getLatestAnalysisWithRecord(owner, repo);
      if (!latest) {
        throw new RepositoryNotAnalyzedError(
          `Repository '${owner}/${repo}' has not been analyzed yet. Run POST /api/analyze first.`
        );
      }
      analysisId = latest.analysisId;
    }

    // Check if repository has chunks indexed; if not, index landmarks automatically
    const existingChunks = await db
      .select({ id: codeChunks.id })
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, analysisId))
      .limit(1);

    if (existingChunks.length === 0) {
      await this.indexAnalysis(owner, repo, analysisId);
    }

    // 2. Generate query embedding
    const queryVector = await this.embeddingProvider.embedQuery(queryInput.query);

    const isVectorSupported = await hasPgVectorSupport();
    let results: SearchResultItem[] = [];
    let isFallback = false;

    if (isVectorSupported) {
      try {
        const vectorStr = `[${queryVector.join(',')}]`;
        const limit = queryInput.limit;

        // Vector cosine distance search
        const rawResults = await sql`
          SELECT
            file_path as "filePath",
            chunk_index as "chunkIndex",
            start_line as "startLine",
            end_line as "endLine",
            content,
            language,
            category,
            1 - (embedding_vec <=> ${vectorStr}::vector) as score
          FROM code_chunks
          WHERE analysis_id = ${analysisId}
            ${queryInput.pathPrefix ? sql`AND file_path LIKE ${queryInput.pathPrefix + '%'}` : sql``}
            ${queryInput.category ? sql`AND category = ${queryInput.category}` : sql``}
            AND embedding_vec IS NOT NULL
          ORDER BY embedding_vec <=> ${vectorStr}::vector ASC
          LIMIT ${limit};
        `;

        results = rawResults.map((r: any) => ({
          filePath: r.filePath,
          chunkIndex: r.chunkIndex,
          startLine: r.startLine,
          endLine: r.endLine,
          content: r.content,
          score: Math.max(0, Math.min(1, Number(Number(r.score).toFixed(4)))),
          language: r.language,
          category: r.category,
        }));
      } catch {
        // Fallback to relational / in-memory cosine ranking
        isFallback = true;
      }
    } else {
      isFallback = true;
    }

    // Relational / in-memory cosine ranking fallback
    if (isFallback) {
      const whereConditions = [eq(codeChunks.analysisId, analysisId)];
      if (queryInput.category) {
        whereConditions.push(eq(codeChunks.category, queryInput.category));
      }

      const rows = await db
        .select({
          filePath: codeChunks.filePath,
          chunkIndex: codeChunks.chunkIndex,
          startLine: codeChunks.startLine,
          endLine: codeChunks.endLine,
          content: codeChunks.content,
          language: codeChunks.language,
          category: codeChunks.category,
          embedding: codeChunks.embedding,
        })
        .from(codeChunks)
        .where(and(...whereConditions));

      const filtered = queryInput.pathPrefix
        ? rows.filter((r) => r.filePath.startsWith(queryInput.pathPrefix!))
        : rows;

      const scored = filtered.map((row) => {
        let score = 0;
        if (row.embedding && Array.isArray(row.embedding)) {
          score = cosineSimilarity(queryVector, row.embedding);
        } else {
          // Text match heuristic if embedding is absent
          const terms = queryInput.query.toLowerCase().split(/\s+/);
          const matchCount = terms.filter((t) => row.content.toLowerCase().includes(t)).length;
          score = matchCount / terms.length;
        }

        return {
          filePath: row.filePath,
          chunkIndex: row.chunkIndex,
          startLine: row.startLine,
          endLine: row.endLine,
          content: row.content,
          score: Number(score.toFixed(4)),
          language: row.language,
          category: row.category as FileCategory,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      results = scored.slice(0, queryInput.limit);
    }

    const durationMs = Date.now() - startTime;

    return {
      query: queryInput.query,
      results,
      totalMatches: results.length,
      durationMs,
      fallback: isFallback,
    };
  }
}
