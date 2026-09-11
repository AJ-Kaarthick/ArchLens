import { describe, it, expect } from 'vitest';
import { MockAIProvider } from './mock.provider.js';
import { ExplainTopicSchema } from '@archlens/shared';

describe('MockAIProvider', () => {
  const provider = new MockAIProvider();

  it('has correct provider name and model', () => {
    expect(provider.name).toBe('mock');
    expect(provider.model).toBeDefined();
  });

  const topics = ExplainTopicSchema.options;

  for (const topic of topics) {
    it(`generates a valid explanation result for topic: ${topic}`, async () => {
      const result = await provider.explain({
        topic,
        repoName: 'archlens/core',
        context: 'test context',
      });

      expect(result.summary).toBeTruthy();
      expect(result.explanation).toContain('###');
      expect(result.keyTakeaways.length).toBeGreaterThanOrEqual(3);
      expect(result.evidence.length).toBeGreaterThanOrEqual(2);
      expect(result.provider).toBe('mock');
      expect(result.model).toBe(provider.model);

      for (const citation of result.evidence) {
        expect(citation.type).toBeDefined();
        expect(citation.label).toBeTruthy();
        expect(citation.reference).toBeTruthy();
      }
    });
  }

  it('incorporates target into explanation when provided', async () => {
    const result = await provider.explain({
      topic: 'architecture',
      target: 'packages/shared',
      repoName: 'archlens/core',
      context: 'test context',
    });

    expect(result.explanation).toContain('packages/shared');
  });

  it('dynamically adapts to non-Node Python repositories from Phase 2 facts', async () => {
    const pythonAnalysis = {
      repository: {
        id: '1',
        owner: 'pallets',
        name: 'flask',
        url: 'https://github.com/pallets/flask',
        defaultBranch: 'main',
        description: 'Python web framework',
        stars: 65000,
        forks: 16000,
        primaryLanguage: 'Python',
        createdAt: '2010-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      commitSha: 'sha1',
      techStack: [
        { category: 'framework' as const, name: 'Flask', version: '3.0.0', confidence: 'high' as const, evidence: 'pyproject.toml' },
      ],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: ['Microframework'],
        primaryEntrypoints: ['src/flask/app.py'],
        keyLandmarks: [{ path: 'pyproject.toml', name: 'pyproject.toml', type: 'manifest' as const, description: 'Python config' }],
      },
      metrics: {
        totalFiles: 35,
        totalBytes: 80000,
        languages: { Python: { bytes: 80000, percentage: 100, fileCount: 35 } },
        categories: { source: { bytes: 80000, percentage: 100, fileCount: 35 } },
        largestFiles: [{ path: 'src/flask/app.py', size: 10000 }],
      },
      tree: [],
      analyzedAt: '2024-01-01T00:00:00Z',
    };

    const overview = await provider.explain({
      topic: 'overview',
      repoName: 'pallets/flask',
      context: 'context',
      analysis: pythonAnalysis,
    });

    expect(overview.summary).toContain('Python');
    expect(overview.summary).not.toContain('Fastify');
    expect(overview.summary).not.toContain('Node.js');
    expect(overview.explanation).toContain('Python');
    expect(overview.explanation).toContain('ArchLens Mock Heuristics');

    const techStack = await provider.explain({
      topic: 'tech-stack',
      repoName: 'pallets/flask',
      context: 'context',
      analysis: pythonAnalysis,
    });

    expect(techStack.summary).toContain('Flask');
    expect(techStack.summary).not.toContain('Postgres');
    expect(techStack.explanation).toContain('Flask');
    expect(techStack.evidence.some((e) => e.reference === 'Flask')).toBe(true);

    const entrypoints = await provider.explain({
      topic: 'entrypoints',
      repoName: 'pallets/flask',
      context: 'context',
      analysis: pythonAnalysis,
    });

    expect(entrypoints.summary).toContain('src/flask/app.py');
    expect(entrypoints.evidence.some((e) => e.reference === 'src/flask/app.py')).toBe(true);
  });

  it('dynamically adapts to Rust repositories from Phase 2 facts', async () => {
    const rustAnalysis = {
      repository: {
        id: '2',
        owner: 'tokio-rs',
        name: 'tokio',
        url: 'https://github.com/tokio-rs/tokio',
        defaultBranch: 'master',
        description: 'Asynchronous runtime for Rust',
        stars: 25000,
        forks: 2500,
        primaryLanguage: 'Rust',
        createdAt: '2016-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      commitSha: 'sha2',
      techStack: [
        { category: 'framework' as const, name: 'Tokio', version: '1.35.0', confidence: 'high' as const, evidence: 'Cargo.toml' },
      ],
      architecture: {
        isMonorepo: true,
        monorepoTool: 'cargo-workspace',
        workspaces: ['tokio', 'tokio-util', 'tokio-macros'],
        detectedPatterns: ['Async Runtime'],
        primaryEntrypoints: ['tokio/src/lib.rs'],
        keyLandmarks: [{ path: 'Cargo.toml', name: 'Cargo.toml', type: 'manifest' as const, description: 'Cargo workspace' }],
      },
      metrics: {
        totalFiles: 150,
        totalBytes: 500000,
        languages: { Rust: { bytes: 500000, percentage: 100, fileCount: 150 } },
        categories: { source: { bytes: 500000, percentage: 100, fileCount: 150 } },
        largestFiles: [{ path: 'tokio/src/lib.rs', size: 20000 }],
      },
      tree: [],
      analyzedAt: '2024-01-01T00:00:00Z',
    };

    const overview = await provider.explain({
      topic: 'overview',
      repoName: 'tokio-rs/tokio',
      context: 'context',
      analysis: rustAnalysis,
    });

    expect(overview.summary).toContain('Rust');
    expect(overview.explanation).toContain('cargo-workspace');
    expect(overview.summary).not.toContain('Fastify');

    const architecture = await provider.explain({
      topic: 'architecture',
      repoName: 'tokio-rs/tokio',
      context: 'context',
      analysis: rustAnalysis,
    });

    expect(architecture.summary).toContain('Async Runtime');
    expect(architecture.explanation).toContain('tokio-macros');
  });
});

