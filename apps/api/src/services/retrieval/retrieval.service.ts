import { db, sql, hasPgVectorSupport } from '../../db/index.js';
import { codeChunks, analyses } from '../../db/schema.js';
import type { IEmbeddingProvider } from '../ai/embeddings/embedding.interface.js';
import { EmbeddingProviderFactory } from '../ai/embeddings/embedding-provider.factory.js';
import { CodeChunker, type ChunkInputFile } from './chunker.js';
import type {
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  FileCategory,
  IndexStatusResponse,
} from '@archlens/shared';
import { eq, and, count } from 'drizzle-orm';
import { GitHubService } from '../github.service.js';
import { RepositoryService } from '../repository.service.js';
import { sanitizeErrorMessage } from '../ai/sanitize-error.js';

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

export function computeLexicalScore(
  query: string,
  filePath: string,
  content: string
): number {
  if (!query || !query.trim()) return 0;

  const rawTokens = query
    .toLowerCase()
    .split(/[\s,._\-/\\:;()[\]{}'"]+/)
    .filter((t) => t.length > 1);
  const tokens = rawTokens.length > 0 ? rawTokens : [query.toLowerCase().trim()];

  const lowerPath = filePath.toLowerCase();
  const lowerContent = content.toLowerCase();
  const queryTrim = query.toLowerCase().trim();

  const exactInContent = lowerContent.includes(queryTrim);
  const exactInPath = lowerPath.includes(queryTrim);

  let pathMatches = 0;
  let contentMatches = 0;
  let contentOccurrences = 0;

  for (const token of tokens) {
    if (lowerPath.includes(token)) {
      pathMatches++;
    }
    if (lowerContent.includes(token)) {
      contentMatches++;
      let count = 0;
      let pos = 0;
      while ((pos = lowerContent.indexOf(token, pos)) !== -1 && count < 5) {
        count++;
        pos += token.length;
      }
      contentOccurrences += count;
    }
  }

  if (contentMatches === 0 && pathMatches === 0) {
    return 0;
  }

  const pathRatio = pathMatches / tokens.length;
  const contentRatio = contentMatches / tokens.length;

  let score = 0.35 * contentRatio + 0.35 * pathRatio;
  if (exactInPath) score += 0.15;
  if (exactInContent) score += 0.15;
  score += Math.min(0.05, contentOccurrences * 0.01);

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

export class RetrievalService {
  private static readonly MAX_CONCURRENT_INDEXING = 2;
  private embeddingProvider: IEmbeddingProvider;
  private chunker: CodeChunker;
  private githubService: GitHubService;
  private repoService: RepositoryService;

  private inFlightIndexAnalysis = new Map<
    string,
    Promise<{ indexedChunks: number; failedFetches?: number }>
  >();
  private inFlightIndexFiles = new Map<number, Promise<{ indexedChunks: number }>>();

  private activeIndexingCount = 0;
  private indexingQueue: Array<() => void> = [];
  private indexStatuses = new Map<string, IndexStatusResponse>();

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
   * Indexes a collection of files for a specific analysis snapshot with single-flighting.
   * If chunks already exist for this analysis, indexing is skipped (idempotent)
   * unless options?.force is true, which deletes existing chunks and re-indexes.
   */
  async indexFiles(
    analysisId: number,
    files: ChunkInputFile[],
    options?: { force?: boolean }
  ): Promise<{ indexedChunks: number }> {
    if (!options?.force) {
      const inFlight = this.inFlightIndexFiles.get(analysisId);
      if (inFlight) {
        return inFlight;
      }
    }

    const indexingPromise = (async () => {
      try {
        return await this.performIndexFiles(analysisId, files, options);
      } finally {
        this.inFlightIndexFiles.delete(analysisId);
      }
    })();

    this.inFlightIndexFiles.set(analysisId, indexingPromise);
    return indexingPromise;
  }

  private async performIndexFiles(
    analysisId: number,
    files: ChunkInputFile[],
    options?: { force?: boolean }
  ): Promise<{ indexedChunks: number }> {
    if (options?.force) {
      await db.delete(codeChunks).where(eq(codeChunks.analysisId, analysisId));
    } else {
      // Check if already indexed
      const existing = await db
        .select({ id: codeChunks.id })
        .from(codeChunks)
        .where(eq(codeChunks.analysisId, analysisId))
        .limit(1);

      if (existing.length > 0) {
        return { indexedChunks: existing.length };
      }
    }

    const chunks = this.chunker.chunkRepository(files);
    if (chunks.length === 0) {
      return { indexedChunks: 0 };
    }

    // Generate embeddings
    const contents = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embed(contents);

    const isVectorSupported = await hasPgVectorSupport();

    // Batch insert chunks (batches of 50)
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const slice = chunks.slice(i, i + BATCH_SIZE);
      const valuesToInsert = slice.map((chunk, sliceIdx) => {
        const globalIdx = i + sliceIdx;
        return {
          analysisId,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          language: chunk.language,
          category: chunk.category,
          embedding: embeddings[globalIdx] || null,
          createdAt: new Date(),
        };
      });

      await db.insert(codeChunks).values(valuesToInsert).onConflictDoNothing();
    }

    // If pgvector is supported, also store in vector column
    if (isVectorSupported) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (embedding && embedding.length > 0) {
          try {
            const vectorStr = `[${embedding.join(',')}]`;
            await sql`
              UPDATE code_chunks
              SET embedding_vec = ${vectorStr}::vector
              WHERE analysis_id = ${analysisId}
                AND file_path = ${chunk.filePath}
                AND chunk_index = ${chunk.chunkIndex};
            `;
          } catch (err: unknown) {
            // Graceful fallback with structured diagnostic warning if vector column update fails
            console.warn(
              `[RetrievalService] Failed to update pgvector column for ${chunk.filePath}#${chunk.chunkIndex}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }
    }

    return { indexedChunks: chunks.length };
  }

  /**
   * Automatically indexes landmark and entrypoint files for an existing analysis record with single-flighting.
   */
  async indexAnalysis(
    owner: string,
    repo: string,
    analysisId: number,
    options?: { force?: boolean }
  ): Promise<{ indexedChunks: number; failedFetches?: number }> {
    const flightKey = `${owner.toLowerCase()}/${repo.toLowerCase()}:${analysisId}:${options?.force ? 'force' : 'normal'}`;
    const inFlight = this.inFlightIndexAnalysis.get(flightKey);
    if (inFlight) {
      return inFlight;
    }

    const indexingPromise = (async () => {
      try {
        return await this.performIndexAnalysis(owner, repo, analysisId, options);
      } finally {
        this.inFlightIndexAnalysis.delete(flightKey);
      }
    })();

    this.inFlightIndexAnalysis.set(flightKey, indexingPromise);
    return indexingPromise;
  }

  private async performIndexAnalysis(
    owner: string,
    repo: string,
    analysisId: number,
    options?: { force?: boolean }
  ): Promise<{ indexedChunks: number; failedFetches?: number }> {
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
    const fetchFailures: { path: string; error: string }[] = [];

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
      } catch (err: unknown) {
        // Collect failure diagnostics; continue gracefully so partial repo issues don't crash indexing
        fetchFailures.push({
          path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (fetchFailures.length > 0) {
      const summary = fetchFailures.slice(0, 5).map((f) => `${f.path} (${f.error})`).join('; ');
      console.warn(
        `[RetrievalService] Notice: ${fetchFailures.length}/${candidatePaths.size} files failed to fetch during indexing of ${owner}/${repo}: ${summary}`
      );
    }

    const result = await this.indexFiles(analysisId, filesToChunk, options);
    return {
      indexedChunks: result.indexedChunks,
      failedFetches: fetchFailures.length,
    };
  }

  /**
   * Triggers or reports status for asynchronous background indexing of a repository.
   * Single-flighted per repository with bounded concurrency.
   */
  async startIndexing(
    owner: string,
    repo: string,
    options?: { force?: boolean }
  ): Promise<IndexStatusResponse> {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const record = await this.repoService.getLatestAnalysisWithRecord(owner, repo);
    if (!record) {
      throw new RepositoryNotAnalyzedError(
        `Repository '${owner}/${repo}' has not been analyzed yet. Run POST /api/analyze first.`
      );
    }

    const currentStatus = this.indexStatuses.get(key);
    if (currentStatus && currentStatus.status === 'indexing') {
      return currentStatus;
    }

    if (!options?.force) {
      const [countRow] = await db
        .select({ count: count() })
        .from(codeChunks)
        .where(eq(codeChunks.analysisId, record.analysisId));

      const chunkCount = countRow?.count ?? 0;
      if (chunkCount > 0) {
        const readyStatus: IndexStatusResponse = {
          status: 'ready',
          indexedChunks: chunkCount,
          updatedAt: record.analysis.analyzedAt,
        };
        this.indexStatuses.set(key, readyStatus);
        return readyStatus;
      }
    }

    const indexingStatus: IndexStatusResponse = {
      status: 'indexing',
      indexedChunks: 0,
      updatedAt: new Date().toISOString(),
    };
    this.indexStatuses.set(key, indexingStatus);

    this.runBackgroundIndexing(owner, repo, record.analysisId, options);
    return indexingStatus;
  }

  private runBackgroundIndexing(
    owner: string,
    repo: string,
    analysisId: number,
    options?: { force?: boolean }
  ): void {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;

    const execute = async () => {
      try {
        const result = await this.indexAnalysis(owner, repo, analysisId, options);
        this.indexStatuses.set(key, {
          status: 'ready',
          indexedChunks: result.indexedChunks,
          updatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        this.indexStatuses.set(key, {
          status: 'failed',
          indexedChunks: 0,
          error: sanitizeErrorMessage(err),
          updatedAt: new Date().toISOString(),
        });
        console.error(
          `[RetrievalService] Background indexing failed for ${owner}/${repo}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        this.activeIndexingCount--;
        if (this.indexingQueue.length > 0) {
          const next = this.indexingQueue.shift();
          if (next) next();
        }
      }
    };

    if (this.activeIndexingCount < RetrievalService.MAX_CONCURRENT_INDEXING) {
      this.activeIndexingCount++;
      execute();
    } else {
      this.indexingQueue.push(() => {
        this.activeIndexingCount++;
        execute();
      });
    }
  }

  /**
   * Retrieves the current semantic indexing status for a repository.
   */
  async getIndexStatus(owner: string, repo: string): Promise<IndexStatusResponse> {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const record = await this.repoService.getLatestAnalysisWithRecord(owner, repo);
    if (!record) {
      throw new RepositoryNotAnalyzedError(
        `Repository '${owner}/${repo}' has not been analyzed yet. Run POST /api/analyze first.`
      );
    }

    const memoryStatus = this.indexStatuses.get(key);
    if (memoryStatus && memoryStatus.status === 'indexing') {
      return memoryStatus;
    }

    const [countRow] = await db
      .select({ count: count() })
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, record.analysisId));

    const chunkCount = countRow?.count ?? 0;
    if (chunkCount > 0) {
      const readyStatus: IndexStatusResponse = {
        status: 'ready',
        indexedChunks: chunkCount,
        updatedAt: memoryStatus?.updatedAt || record.analysis.analyzedAt,
      };
      this.indexStatuses.set(key, readyStatus);
      return readyStatus;
    }

    if (memoryStatus && memoryStatus.status === 'failed') {
      return memoryStatus;
    }

    const notIndexedStatus: IndexStatusResponse = {
      status: 'not_indexed',
      indexedChunks: 0,
    };
    this.indexStatuses.set(key, notIndexedStatus);
    return notIndexedStatus;
  }

  private executeTreeLexicalSearch(
    analysisRow: typeof analyses.$inferSelect,
    queryInput: SearchQuery
  ): SearchResultItem[] {
    const candidates: Map<string, SearchResultItem> = new Map();
    const query = queryInput.query;

    // 1. Landmarks
    const landmarks = analysisRow.architecture?.keyLandmarks || [];
    for (const landmark of landmarks) {
      if (queryInput.pathPrefix && !landmark.path.startsWith(queryInput.pathPrefix)) {
        continue;
      }
      const score = computeLexicalScore(
        query,
        landmark.path,
        `${landmark.name || ''} ${landmark.description || ''} ${landmark.type || ''}`
      );
      if (score > 0) {
        const boostedScore = Math.min(1, Number((score + 0.1).toFixed(4)));
        candidates.set(landmark.path, {
          filePath: landmark.path,
          chunkIndex: 0,
          startLine: 1,
          endLine: 1,
          content: landmark.description || `Key landmark: ${landmark.path}`,
          score: boostedScore,
          language: null,
          category: 'source',
        });
      }
    }

    // 2. Primary entrypoints
    const entrypoints = analysisRow.architecture?.primaryEntrypoints || [];
    for (const ep of entrypoints) {
      if (queryInput.pathPrefix && !ep.startsWith(queryInput.pathPrefix)) {
        continue;
      }
      const score = computeLexicalScore(query, ep, 'entrypoint main application entry point');
      if (score > 0 && !candidates.has(ep)) {
        candidates.set(ep, {
          filePath: ep,
          chunkIndex: 0,
          startLine: 1,
          endLine: 1,
          content: `Primary application entrypoint: ${ep}`,
          score,
          language: null,
          category: 'source',
        });
      }
    }

    // 3. Tree items
    const tree = analysisRow.tree || [];
    for (const item of tree) {
      if (queryInput.pathPrefix && !item.path.startsWith(queryInput.pathPrefix)) {
        continue;
      }
      if (queryInput.category && item.category !== queryInput.category) {
        continue;
      }
      const score = computeLexicalScore(
        query,
        item.path,
        `${item.category || ''} ${item.extension || ''}`
      );
      if (score > 0) {
        const existing = candidates.get(item.path);
        if (!existing || score > existing.score) {
          candidates.set(item.path, {
            filePath: item.path,
            chunkIndex: 0,
            startLine: 1,
            endLine: 1,
            content: `Repository file: ${item.path} (${item.category || 'file'})`,
            score,
            language: item.extension || null,
            category: (item.category as FileCategory) || 'source',
          });
        }
      }
    }

    const items = Array.from(candidates.values());
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, queryInput.limit);
  }

  private async executeChunkLexicalSearch(
    analysisId: number,
    queryInput: SearchQuery
  ): Promise<SearchResultItem[]> {
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
      })
      .from(codeChunks)
      .where(and(...whereConditions));

    const filtered = queryInput.pathPrefix
      ? rows.filter((r) => r.filePath.startsWith(queryInput.pathPrefix!))
      : rows;

    const scored = filtered
      .map((r) => {
        const score = computeLexicalScore(queryInput.query, r.filePath, r.content);
        return {
          filePath: r.filePath,
          chunkIndex: r.chunkIndex,
          startLine: r.startLine,
          endLine: r.endLine,
          content: r.content,
          score,
          language: r.language,
          category: r.category as FileCategory,
        };
      })
      .filter((r) => r.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, queryInput.limit);
  }

  /**
   * Executes search against a repository's analysis. Strictly read-only; never triggers indexing.
   * Supports 'lexical', 'semantic', and 'hybrid' modes. Falls back gracefully when chunks are absent
   * or when embedding models are unavailable.
   */
  async search(
    owner: string,
    repo: string,
    queryInput: SearchQuery,
    providedAnalysisId?: number
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const mode = queryInput.mode || 'hybrid';

    // 1. Resolve analysis
    let analysisId: number;
    let analysisRow: typeof analyses.$inferSelect;

    if (providedAnalysisId) {
      analysisId = providedAnalysisId;
      const [row] = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, analysisId))
        .limit(1);
      if (!row) {
        throw new RepositoryNotAnalyzedError(
          `Analysis with ID ${analysisId} not found.`
        );
      }
      analysisRow = row;
    } else {
      const latest = await this.repoService.getLatestAnalysisWithRecord(owner, repo);
      if (!latest) {
        throw new RepositoryNotAnalyzedError(
          `Repository '${owner}/${repo}' has not been analyzed yet. Run POST /api/analyze first.`
        );
      }
      analysisId = latest.analysisId;
      const [row] = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, analysisId))
        .limit(1);
      if (!row) {
        throw new RepositoryNotAnalyzedError(
          `Analysis record not found for '${owner}/${repo}'.`
        );
      }
      analysisRow = row;
    }

    // Check if chunks exist in DB (STRICTLY READ-ONLY: never triggers indexing)
    const existingChunks = await db
      .select({ id: codeChunks.id })
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, analysisId))
      .limit(1);

    const hasChunks = existingChunks.length > 0;

    // Fastpath: if no chunks exist in DB, immediately fall back to tree/landmark lexical search (<10ms)
    if (!hasChunks) {
      const results = this.executeTreeLexicalSearch(analysisRow, queryInput);
      return {
        query: queryInput.query,
        results,
        totalMatches: results.length,
        durationMs: Date.now() - startTime,
        fallback: true,
        mode,
      };
    }

    // Chunks exist in DB
    if (mode === 'lexical') {
      const results = await this.executeChunkLexicalSearch(analysisId, queryInput);
      return {
        query: queryInput.query,
        results,
        totalMatches: results.length,
        durationMs: Date.now() - startTime,
        fallback: false,
        mode: 'lexical',
      };
    }

    // For 'semantic' and 'hybrid' modes, generate embedding vector
    let queryVector: number[] | null = null;
    let embeddingFailed = false;

    try {
      queryVector = await this.embeddingProvider.embedQuery(queryInput.query);
    } catch (err: unknown) {
      console.warn(
        `[RetrievalService] Query embedding failed, falling back to lexical search: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      embeddingFailed = true;
    }

    if (embeddingFailed || !queryVector) {
      const results = await this.executeChunkLexicalSearch(analysisId, queryInput);
      return {
        query: queryInput.query,
        results,
        totalMatches: results.length,
        durationMs: Date.now() - startTime,
        fallback: true,
        mode,
      };
    }

    const isVectorSupported = await hasPgVectorSupport();
    let results: SearchResultItem[] = [];
    let isFallback = false;

    if (isVectorSupported) {
      try {
        const vectorStr = `[${queryVector.join(',')}]`;
        const candidateLimit =
          mode === 'hybrid' ? Math.max(queryInput.limit * 3, 15) : queryInput.limit;

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
          LIMIT ${candidateLimit};
        `;

        if (mode === 'hybrid') {
          const scored = rawResults.map((r: any) => {
            const semScore = Math.max(0, Math.min(1, Number(r.score)));
            const lexScore = computeLexicalScore(queryInput.query, r.filePath, r.content);
            const combinedScore = Math.max(
              0,
              Math.min(1, Number((0.6 * semScore + 0.4 * lexScore).toFixed(4)))
            );
            return {
              filePath: r.filePath,
              chunkIndex: r.chunkIndex,
              startLine: r.startLine,
              endLine: r.endLine,
              content: r.content,
              score: combinedScore,
              language: r.language,
              category: r.category as FileCategory,
            };
          });
          scored.sort((a: SearchResultItem, b: SearchResultItem) => b.score - a.score);
          results = scored.slice(0, queryInput.limit);
        } else {
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
        }
      } catch {
        isFallback = true;
      }
    } else {
      isFallback = true;
    }

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
        let semScore = 0;
        if (row.embedding && Array.isArray(row.embedding)) {
          semScore = cosineSimilarity(queryVector!, row.embedding);
        } else {
          semScore = computeLexicalScore(queryInput.query, row.filePath, row.content);
        }

        let finalScore = semScore;
        if (mode === 'hybrid') {
          const lexScore = computeLexicalScore(queryInput.query, row.filePath, row.content);
          finalScore = 0.6 * semScore + 0.4 * lexScore;
        }

        return {
          filePath: row.filePath,
          chunkIndex: row.chunkIndex,
          startLine: row.startLine,
          endLine: row.endLine,
          content: row.content,
          score: Math.max(0, Math.min(1, Number(finalScore.toFixed(4)))),
          language: row.language,
          category: row.category as FileCategory,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      results = scored.slice(0, queryInput.limit);
    }

    return {
      query: queryInput.query,
      results,
      totalMatches: results.length,
      durationMs: Date.now() - startTime,
      fallback: isFallback,
      mode,
    };
  }
}
