import { describe, it, expect } from 'vitest';
import type { AnalysisResult, FileTreeItem } from '@archlens/shared';
import { detectExecutionEligibility } from './eligibility.js';

function createFileItem(filePath: string): FileTreeItem {
  const parts = filePath.split('/');
  const name = parts[parts.length - 1];
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return {
    path: filePath,
    name,
    type: 'file',
    size: 100,
    extension: ext,
    category: 'source',
    isLandmark: false,
  };
}

function createMockAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    repository: {
      id: '1',
      owner: 'test-owner',
      name: 'test-repo',
      url: 'https://github.com/test-owner/test-repo',
      defaultBranch: 'main',
      description: 'Test repository',
      stars: 10,
      forks: 2,
      primaryLanguage: 'JavaScript',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    commitSha: 'sha123',
    techStack: [
      {
        name: 'Node.js',
        category: 'runtime',
        version: '20.0.0',
        confidence: 'high',
        evidence: 'package.json',
      },
    ],
    architecture: {
      isMonorepo: false,
      monorepoTool: null,
      workspaces: [],
      detectedPatterns: [],
      primaryEntrypoints: ['index.js'],
      keyLandmarks: [],
    },
    metrics: {
      totalFiles: 5,
      totalBytes: 2048,
      languages: { JavaScript: { bytes: 2048, percentage: 100, fileCount: 5 } },
      categories: { source: { bytes: 2048, percentage: 100, fileCount: 5 } },
      largestFiles: [],
    },
    tree: [createFileItem('package.json'), createFileItem('index.js')],
    analyzedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Execution Eligibility Detector', () => {
  it('detects node-script eligibility when index.js is present', () => {
    const analysis = createMockAnalysis();
    const eligibility = detectExecutionEligibility(analysis);

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.recommendedProfile).toBe('node-script');
    expect(eligibility.supportedProfiles).toContain('node-script');
    expect(eligibility.detectedEntrypoints).toContain('index.js');
  });

  it('detects static-web eligibility when index.html is present', () => {
    const analysis = createMockAnalysis({
      repository: {
        ...createMockAnalysis().repository,
        primaryLanguage: 'HTML',
      },
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: [],
        keyLandmarks: [],
      },
      tree: [createFileItem('index.html'), createFileItem('style.css')],
    });

    const eligibility = detectExecutionEligibility(analysis);

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.recommendedProfile).toBe('static-web');
    expect(eligibility.supportedProfiles).toContain('static-web');
    expect(eligibility.detectedEntrypoints).toContain('index.html');
  });

  it('refuses unsupported runtimes like Python/FastAPI with structured reason', () => {
    const analysis = createMockAnalysis({
      repository: {
        ...createMockAnalysis().repository,
        primaryLanguage: 'Python',
      },
      techStack: [
        {
          name: 'Python',
          category: 'language',
          version: '3.11',
          confidence: 'high',
          evidence: 'runtime',
        },
        {
          name: 'FastAPI',
          category: 'framework',
          version: '0.100.0',
          confidence: 'high',
          evidence: 'requirements.txt',
        },
      ],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: ['main.py'],
        keyLandmarks: [],
      },
      tree: [createFileItem('main.py'), createFileItem('requirements.txt')],
    });

    const eligibility = detectExecutionEligibility(analysis);

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.refusalReason).toBe('unsupported_runtime');
    expect(eligibility.reasonMessage).toContain('Python');
    expect(eligibility.supportedProfiles).toHaveLength(0);
  });

  it('refuses repos with missing entrypoints with structured reason', () => {
    const analysis = createMockAnalysis({
      tree: [createFileItem('README.md'), createFileItem('data.csv')],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: [],
        keyLandmarks: [],
      },
    });

    const eligibility = detectExecutionEligibility(analysis);

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.refusalReason).toBe('missing_entrypoint');
  });

  it('adds bounded workspace warning when repo exceeds MAX_FILES (25) files', () => {
    const analysis = createMockAnalysis({
      metrics: {
        totalFiles: 120,
        totalBytes: 50000,
        languages: {},
        categories: {},
        largestFiles: [],
      },
    });

    const eligibility = detectExecutionEligibility(analysis);

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.warnings.length).toBeGreaterThan(0);
    expect(eligibility.warnings[0]).toContain('120 files');
  });
});
