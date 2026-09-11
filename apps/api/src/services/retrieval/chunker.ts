import type { FileCategory } from '@archlens/shared';

export interface ChunkInputFile {
  path: string;
  content: string;
  size: number;
  category: FileCategory;
  language?: string | null;
}

export interface CodeChunk {
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  language: string | null;
  category: FileCategory;
}

export interface ChunkerOptions {
  linesPerChunk?: number;
  overlapLines?: number;
  maxChunksPerRepo?: number;
  maxFilesPerRepo?: number;
  maxFileSizeBytes?: number;
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  linesPerChunk: 50,
  overlapLines: 10,
  maxChunksPerRepo: 500,
  maxFilesPerRepo: 100,
  maxFileSizeBytes: 256 * 1024, // 256 KB
};

const SKIPPED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
]);

const SKIPPED_EXTENSIONS = new Set([
  // Binaries and archives
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.iso',
  // Media and images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.bmp',
  '.tiff',
  '.mp4',
  '.mp3',
  '.wav',
  '.ogg',
  '.pdf',
  // Fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  // Source maps
  '.map',
]);

export class CodeChunker {
  private readonly options: Required<ChunkerOptions>;

  constructor(options: ChunkerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Evaluates whether a file should be indexed for semantic retrieval.
   */
  shouldIndexFile(file: ChunkInputFile): boolean {
    // 1. File size bound (Phase 2 safety limit: 256 KB)
    if (file.size > this.options.maxFileSizeBytes) {
      return false;
    }

    const normalizedPath = file.path.toLowerCase();
    const fileName = normalizedPath.split('/').pop() || '';

    // 2. Skip lockfiles
    if (SKIPPED_FILE_NAMES.has(fileName)) {
      return false;
    }

    // 3. Skip minified / bundled files
    if (
      normalizedPath.endsWith('.min.js') ||
      normalizedPath.endsWith('.min.css') ||
      normalizedPath.endsWith('.bundle.js') ||
      normalizedPath.endsWith('.chunk.js')
    ) {
      return false;
    }

    // 4. Skip binary/media/font extensions
    for (const ext of SKIPPED_EXTENSIONS) {
      if (normalizedPath.endsWith(ext)) {
        return false;
      }
    }

    // 5. Only index relevant categories: source, doc, config
    if (file.category === 'asset' || file.category === 'other') {
      return false;
    }

    // 6. Skip empty or whitespace-only files
    if (!file.content || file.content.trim().length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Chunks a single file into line-aware chunks with overlap.
   */
  chunkFile(file: ChunkInputFile): CodeChunk[] {
    if (!this.shouldIndexFile(file)) {
      return [];
    }

    const lines = file.content.split('\n');
    const totalLines = lines.length;

    if (totalLines === 0) {
      return [];
    }

    const chunks: CodeChunk[] = [];
    const step = Math.max(1, this.options.linesPerChunk - this.options.overlapLines);
    let chunkIndex = 0;

    for (let startIdx = 0; startIdx < totalLines; startIdx += step) {
      const endIdx = Math.min(totalLines, startIdx + this.options.linesPerChunk);
      const chunkLines = lines.slice(startIdx, endIdx);
      const content = chunkLines.join('\n');

      // Only push non-empty chunks
      if (content.trim().length > 0) {
        chunks.push({
          filePath: file.path,
          chunkIndex,
          startLine: startIdx + 1, // 1-indexed
          endLine: endIdx, // 1-indexed inclusive
          content,
          language: file.language || null,
          category: file.category,
        });
        chunkIndex++;
      }

      // If this slice reached the very end of the file, break early
      if (endIdx >= totalLines) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Chunks a collection of repository files, enforcing repository-wide safety bounds:
   * - Max files per repo (default 100)
   * - Max total chunks per repo (default 500)
   */
  chunkRepository(files: ChunkInputFile[]): CodeChunk[] {
    // Filter indexable files
    const eligibleFiles = files.filter((f) => this.shouldIndexFile(f));

    // Sort files to prioritize documentation landmarks (README) and core sources over configs
    const prioritizedFiles = eligibleFiles.sort((a, b) => {
      const priority = (f: ChunkInputFile) => {
        const p = f.path.toLowerCase();
        if (p === 'readme.md') return 0;
        if (f.category === 'doc') return 1;
        if (f.category === 'source') return 2;
        if (f.category === 'config') return 3;
        return 4;
      };
      return priority(a) - priority(b);
    });

    const boundedFiles = prioritizedFiles.slice(0, this.options.maxFilesPerRepo);
    const allChunks: CodeChunk[] = [];

    for (const file of boundedFiles) {
      const fileChunks = this.chunkFile(file);
      for (const chunk of fileChunks) {
        if (allChunks.length >= this.options.maxChunksPerRepo) {
          return allChunks;
        }
        allChunks.push(chunk);
      }
    }

    return allChunks;
  }
}
