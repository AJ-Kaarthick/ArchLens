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

  it('discards all citations and returns empty array when all citations are fabricated (no silent synthesis)', () => {
    const fabricatedCitations: EvidenceCitation[] = [
      {
        type: 'file',
        label: 'Non-existent file',
        reference: 'non/existent/path.ts',
        description: 'Hallucination',
      },
      {
        type: 'dependency',
        label: 'Non-existent dep',
        reference: 'nonexistent-lib',
        description: 'Hallucination',
      },
    ];

    const validated = EvidenceValidator.validate(fabricatedCitations, pythonAnalysis);
    expect(validated).toEqual([]);

    const detailed = EvidenceValidator.validateDetailed(fabricatedCitations, pythonAnalysis);
    expect(detailed.totalProvided).toBe(2);
    expect(detailed.validCount).toBe(0);
    expect(detailed.invalidCount).toBe(2);
    expect(detailed.verified).toEqual([]);
    expect(detailed.discarded).toHaveLength(2);
  });

  it('synthesizes grounded citations directly from verified facts on demand', () => {
    const grounded = EvidenceValidator.synthesizeGroundedCitations(pythonAnalysis);

    expect(grounded.length).toBeGreaterThanOrEqual(4);
    const references = grounded.map((g) => g.reference);
    expect(references).toContain('pyproject.toml');
    expect(references).toContain('src/flask/__init__.py');
    expect(references).toContain('Flask');
    expect(references).toContain('Python (95.8%)');
    expect(references).toContain('Microframework');
  });

  describe('Adversarial Tests', () => {
    it('rejects dependency substring tricks and partial matches', () => {
      const adversaryCitations: EvidenceCitation[] = [
        { type: 'dependency', label: 'Trap 1', reference: 're' }, // substring of React
        { type: 'dependency', label: 'Trap 2', reference: 'sql' }, // substring of SQLAlchemy
        { type: 'dependency', label: 'Trap 3', reference: 'fla' }, // substring of Flask
        { type: 'dependency', label: 'Trap 4', reference: 'flask-admin' }, // superstring of Flask
        { type: 'dependency', label: 'Trap 5', reference: 'fastapi' }, // other framework
        { type: 'dependency', label: 'Trap 6', reference: 'express' }, // node framework
        { type: 'dependency', label: 'Valid 1', reference: 'Flask 3.0.0' }, // valid with version
        { type: 'dependency', label: 'Valid 2', reference: 'sqlalchemy' }, // valid case-insensitive
      ];

      const validated = EvidenceValidator.validate(adversaryCitations, pythonAnalysis);
      expect(validated).toHaveLength(2);
      expect(validated.map((v) => v.label)).toEqual(['Valid 1', 'Valid 2']);
    });

    it('enforces exact normalized paths and rejects directory traversal or loose basenames', () => {
      const adversaryCitations: EvidenceCitation[] = [
        { type: 'file', label: 'Loose basename', reference: 'app.py' }, // Only src/flask/app.py exists
        { type: 'file', label: 'Traversal 1', reference: '../../etc/passwd' },
        { type: 'file', label: 'Traversal 2', reference: '../app.py' },
        { type: 'file', label: 'Empty path', reference: '' },
        { type: 'file', label: 'Non-existent', reference: 'src/flask/nonexistent.py' },
        { type: 'file', label: 'Valid with prefix slash', reference: '/src/flask/app.py' },
        { type: 'file', label: 'Valid with relative dot', reference: './src/flask/app.py' },
      ];

      const validated = EvidenceValidator.validate(adversaryCitations, pythonAnalysis);
      expect(validated).toHaveLength(2);
      expect(validated.map((v) => v.label)).toEqual([
        'Valid with prefix slash',
        'Valid with relative dot',
      ]);
    });

    it('validates actual metric values and rejects fabricated numbers or non-metric text', () => {
      const adversaryCitations: EvidenceCitation[] = [
        { type: 'metric', label: 'Fabricated count', reference: '1,000,000 files' },
        { type: 'metric', label: 'Fabricated language share', reference: 'Python (30%)' }, // Actual is 95.8%
        { type: 'metric', label: 'Hallucinated language', reference: 'Ruby (50%)' },
        { type: 'metric', label: 'Loose word trap 1', reference: 'file deleted' },
        { type: 'metric', label: 'Loose word trap 2', reference: 'arbitrary size metric' },
        { type: 'metric', label: 'Valid total files', reference: '45 files' },
        { type: 'metric', label: 'Valid language share', reference: 'Python (95.8%)' },
      ];

      const validated = EvidenceValidator.validate(adversaryCitations, pythonAnalysis);
      expect(validated).toHaveLength(2);
      expect(validated.map((v) => v.label)).toEqual([
        'Valid total files',
        'Valid language share',
      ]);
    });

    it('rejects architectural pattern hallucinations and loose substrings', () => {
      const adversaryCitations: EvidenceCitation[] = [
        { type: 'pattern', label: 'Loose substring trap', reference: 'micro' },
        { type: 'pattern', label: 'Hallucinated pattern 1', reference: 'Microservices' },
        { type: 'pattern', label: 'Hallucinated pattern 2', reference: 'Event-Driven' },
        { type: 'pattern', label: 'Hallucinated pattern 3', reference: 'CQRS' },
        { type: 'pattern', label: 'Valid pattern 1', reference: 'Microframework' },
        { type: 'pattern', label: 'Valid pattern 2', reference: 'layered-architecture' },
      ];

      const validated = EvidenceValidator.validate(adversaryCitations, pythonAnalysis);
      expect(validated).toHaveLength(2);
      expect(validated.map((v) => v.label)).toEqual(['Valid pattern 1', 'Valid pattern 2']);
    });

    it('rejects non-manifest files and ungrounded entrypoints', () => {
      const adversaryCitations: EvidenceCitation[] = [
        { type: 'manifest', label: 'Non-existent manifest', reference: 'package.json' },
        { type: 'manifest', label: 'Not a manifest file', reference: 'src/flask/app.py' },
        { type: 'entrypoint', label: 'Non-existent entrypoint', reference: 'src/flask/main.py' },
        { type: 'entrypoint', label: 'Not an entrypoint', reference: 'README.md' },
        { type: 'manifest', label: 'Valid manifest', reference: 'pyproject.toml' },
        { type: 'entrypoint', label: 'Valid entrypoint', reference: 'src/flask/app.py' },
      ];

      const validated = EvidenceValidator.validate(adversaryCitations, pythonAnalysis);
      expect(validated).toHaveLength(2);
      expect(validated.map((v) => v.label)).toEqual(['Valid manifest', 'Valid entrypoint']);
    });
  });
});
