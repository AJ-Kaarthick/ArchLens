import { describe, it, expect } from 'vitest';
import { CodeChunker, type ChunkInputFile } from './chunker.js';

describe('CodeChunker', () => {
  const chunker = new CodeChunker({
    linesPerChunk: 50,
    overlapLines: 10,
    maxChunksPerRepo: 500,
    maxFilesPerRepo: 100,
    maxFileSizeBytes: 256 * 1024,
  });

  it('chunks a small file into a single chunk with accurate line range', () => {
    const file: ChunkInputFile = {
      path: 'src/config.ts',
      content: 'export const PORT = 3000;\nexport const HOST = "0.0.0.0";',
      size: 58,
      category: 'source',
      language: 'TypeScript',
    };

    const chunks = chunker.chunkFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(2);
    expect(chunks[0].filePath).toBe('src/config.ts');
    expect(chunks[0].language).toBe('TypeScript');
    expect(chunks[0].category).toBe('source');
    expect(chunks[0].content).toBe(file.content);
  });

  it('chunks a large file with overlapping lines', () => {
    // Generate 120 lines
    const lines = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: code statement;`);
    const file: ChunkInputFile = {
      path: 'src/large.ts',
      content: lines.join('\n'),
      size: lines.join('\n').length,
      category: 'source',
      language: 'TypeScript',
    };

    const chunks = chunker.chunkFile(file);
    // 120 lines:
    // Chunk 0: lines 1-50
    // Chunk 1: lines 41-90 (step 40)
    // Chunk 2: lines 81-120 (step 40)
    expect(chunks).toHaveLength(3);

    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
    expect(chunks[0].chunkIndex).toBe(0);

    expect(chunks[1].startLine).toBe(41);
    expect(chunks[1].endLine).toBe(90);
    expect(chunks[1].chunkIndex).toBe(1);

    expect(chunks[2].startLine).toBe(81);
    expect(chunks[2].endLine).toBe(120);
    expect(chunks[2].chunkIndex).toBe(2);

    // Verify overlap content
    const chunk0Lines = chunks[0].content.split('\n');
    const chunk1Lines = chunks[1].content.split('\n');
    // Lines 41..50 (10 lines) should be at end of chunk0 and start of chunk1
    expect(chunk0Lines.slice(40)).toEqual(chunk1Lines.slice(0, 10));
  });

  it('skips lockfiles and package managers locks', () => {
    const lockfiles = [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'Cargo.lock',
      'poetry.lock',
    ];

    for (const name of lockfiles) {
      const file: ChunkInputFile = {
        path: name,
        content: 'lockfile content...',
        size: 500,
        category: 'config',
      };
      expect(chunker.shouldIndexFile(file)).toBe(false);
      expect(chunker.chunkFile(file)).toHaveLength(0);
    }
  });

  it('skips minified and bundled files', () => {
    const minFiles = [
      'dist/bundle.min.js',
      'assets/vendor.bundle.js',
      'styles/main.min.css',
      'dist/app.chunk.js',
    ];

    for (const path of minFiles) {
      const file: ChunkInputFile = {
        path,
        content: 'function a(){}',
        size: 200,
        category: 'source',
      };
      expect(chunker.shouldIndexFile(file)).toBe(false);
    }
  });

  it('skips binary, font, and media files', () => {
    const mediaFiles = [
      'logo.png',
      'banner.svg',
      'icon.ico',
      'archive.zip',
      'doc.pdf',
      'font.woff2',
      'bundle.js.map',
    ];

    for (const path of mediaFiles) {
      const file: ChunkInputFile = {
        path,
        content: 'raw data',
        size: 500,
        category: 'asset',
      };
      expect(chunker.shouldIndexFile(file)).toBe(false);
    }
  });

  it('skips files exceeding the 256 KB safety limit', () => {
    const file: ChunkInputFile = {
      path: 'src/huge.ts',
      content: 'a'.repeat(300 * 1024),
      size: 300 * 1024,
      category: 'source',
    };

    expect(chunker.shouldIndexFile(file)).toBe(false);
    expect(chunker.chunkFile(file)).toHaveLength(0);
  });

  it('skips empty and whitespace-only files', () => {
    const file1: ChunkInputFile = {
      path: 'src/empty.ts',
      content: '',
      size: 0,
      category: 'source',
    };
    const file2: ChunkInputFile = {
      path: 'src/blank.ts',
      content: '   \n\n\t  ',
      size: 6,
      category: 'source',
    };

    expect(chunker.shouldIndexFile(file1)).toBe(false);
    expect(chunker.shouldIndexFile(file2)).toBe(false);
  });

  it('enforces maximum chunk count bounds across repository', () => {
    const tinyChunker = new CodeChunker({
      linesPerChunk: 10,
      overlapLines: 0,
      maxChunksPerRepo: 5,
    });

    const files: ChunkInputFile[] = [
      {
        path: 'file1.ts',
        content: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'),
        size: 200,
        category: 'source',
      },
      {
        path: 'file2.ts',
        content: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
        size: 250,
        category: 'source',
      },
    ];

    const repoChunks = tinyChunker.chunkRepository(files);
    // file1 yields 3 chunks, file2 yields 4 chunks. But maxChunksPerRepo is 5.
    expect(repoChunks).toHaveLength(5);
  });

  it('enforces maximum files per repository bounds', () => {
    const tinyChunker = new CodeChunker({
      maxFilesPerRepo: 2,
    });

    const files: ChunkInputFile[] = Array.from({ length: 10 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `export const val${i} = ${i};`,
      size: 30,
      category: 'source',
    }));

    const repoChunks = tinyChunker.chunkRepository(files);
    const uniqueFiles = new Set(repoChunks.map((c) => c.filePath));
    expect(uniqueFiles.size).toBe(2);
  });
});
