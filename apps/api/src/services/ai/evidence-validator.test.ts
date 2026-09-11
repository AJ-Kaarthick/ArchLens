import { describe, it, expect } from 'vitest';
import { EvidenceValidator } from './evidence-validator.js';
import type { AnalysisResult, EvidenceCitation } from '@archlens/shared';

describe('EvidenceValidator', () => {
  const pythonAnalysis: AnalysisResult = {
    repository: {
      id: '101',
      owner: 'pallets',
      name: 'flask',
      url: 'https://github.com/pallets/flask',
      defaultBranch: 'main',
      description: 'The Python micro framework for building web applications.',
      stars: 65000,
      forks: 16000,
      primaryLanguage: 'Python',
      createdAt: '2010-04-06T15:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    commitSha: 'sha-flask',
    techStack: [
      {
        category: 'framework',
        name: 'Flask',
        version: '3.0.0',
        confidence: 'high',
        evidence: 'pyproject.toml',
      },
      {
        category: 'database',
        name: 'SQLAlchemy',
        version: '2.0.0',
        confidence: 'high',
        evidence: 'pyproject.toml',
      },
    ],
    architecture: {
      isMonorepo: false,
      monorepoTool: null,
      workspaces: [],
      detectedPatterns: ['Microframework', 'Layered Architecture'],
      primaryEntrypoints: ['src/flask/__init__.py', 'src/flask/app.py'],
      keyLandmarks: [
        {
          path: 'pyproject.toml',
          name: 'pyproject.toml',
          type: 'manifest',
          description: 'Python project metadata',
        },
        {
          path: 'README.md',
          name: 'README.md',
          type: 'doc',
          description: 'Project documentation',
        },
      ],
    },
    metrics: {
      totalFiles: 45,
      totalBytes: 120000,
      languages: {
        Python: { bytes: 115000, percentage: 95.8, fileCount: 40 },
        Markdown: { bytes: 5000, percentage: 4.2, fileCount: 5 },
      },
      categories: {
        source: { bytes: 115000, percentage: 95.8, fileCount: 40 },
        doc: { bytes: 5000, percentage: 4.2, fileCount: 5 },
      },
      largestFiles: [{ path: 'src/flask/app.py', size: 25000 }],
    },
    tree: [
      {
        path: 'pyproject.toml',
        name: 'pyproject.toml',
        type: 'file',
        size: 1500,
        extension: '.toml',
        category: 'config',
        isLandmark: true,
      },
      {
        path: 'src/flask/app.py',
        name: 'app.py',
        type: 'file',
        size: 25000,
        extension: '.py',
        category: 'source',
        isLandmark: false,
      },
      {
        path: 'src/flask/__init__.py',
        name: '__init__.py',
        type: 'file',
        size: 1200,
        extension: '.py',
        category: 'source',
        isLandmark: false,
      },
    ],
    analyzedAt: '2024-01-01T00:00:00Z',
  };

  it('preserves valid citations referencing real repository facts', () => {
    const rawCitations: EvidenceCitation[] = [
      {
        type: 'manifest',
        label: 'Project Manifest',
        reference: 'pyproject.toml',
        description: 'Build manifest',
      },
      {
        type: 'entrypoint',
        label: 'App Entrypoint',
        reference: 'src/flask/app.py',
        description: 'Flask app entrypoint',
      },
      {
        type: 'dependency',
        label: 'Flask Framework',
        reference: 'Flask',
        description: 'Microframework dependency',
      },
      {
        type: 'metric',
        label: 'Language Share',
        reference: 'Python (95.8%)',
        description: 'Dominant language metric',
      },
      {
        type: 'pattern',
        label: 'Detected Architecture',
        reference: 'Microframework',
        description: 'Architecture pattern',
      },
    ];

    const validated = EvidenceValidator.validate(rawCitations, pythonAnalysis);
    expect(validated).toHaveLength(5);
    expect(validated.map((v) => v.reference)).toEqual([
      'pyproject.toml',
      'src/flask/app.py',
      'Flask',
      'Python (95.8%)',
      'Microframework',
    ]);
  });

  it('rejects fabricated file paths, dependencies, and entrypoints', () => {
    const rawCitations: EvidenceCitation[] = [
      {
        type: 'file',
        label: 'Fabricated Auth Controller',
        reference: 'src/controllers/auth.py', // DOES NOT EXIST
        description: 'Fake file hallucinated by LLM',
      },
      {
        type: 'dependency',
        label: 'Fabricated Dependency',
        reference: 'express', // Node framework in a Python repo!
        description: 'Fake dependency',
      },
      {
        type: 'entrypoint',
        label: 'Fabricated Entrypoint',
        reference: 'bin/start-server.sh', // DOES NOT EXIST
        description: 'Fake entrypoint',
      },
      {
        type: 'manifest',
        label: 'Real Manifest',
        reference: 'pyproject.toml', // REAL
        description: 'Real file',
      },
    ];

    const validated = EvidenceValidator.validate(rawCitations, pythonAnalysis);

    // Only the real pyproject.toml citation must be kept
    expect(validated).toHaveLength(1);
    expect(validated[0].reference).toBe('pyproject.toml');
  });

  it('synthesizes grounded citations when all citations are fabricated', () => {
    const fabricatedCitations: EvidenceCitation[] = [
      {
        type: 'file',
        label: 'Non-existent file',
        reference: 'non/existent/path.ts',
        description: 'Hallucination',
      },
    ];

    const validated = EvidenceValidator.validate(fabricatedCitations, pythonAnalysis);

    // Must not be empty; must contain real Python facts from Phase 2
    expect(validated.length).toBeGreaterThanOrEqual(2);
    for (const citation of validated) {
      if (citation.type === 'manifest' || citation.type === 'file') {
        expect(['pyproject.toml', 'README.md']).toContain(citation.reference);
      }
      if (citation.type === 'dependency') {
        expect(['Flask', 'SQLAlchemy']).toContain(citation.reference);
      }
      if (citation.type === 'metric') {
        expect(citation.reference).toContain('Python');
      }
    }
  });
});
