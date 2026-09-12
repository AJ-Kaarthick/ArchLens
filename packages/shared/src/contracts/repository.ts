import { z } from 'zod';

export const GITHUB_REPO_REGEX =
  /^(?:https?:\/\/github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\.git)?(?:\/.*)?$/;

export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const urlMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/
    );
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }
    return null;
  }
  const clean = trimmed.replace(/^(?:www\.)?github\.com\//, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    if (/^[a-zA-Z0-9_.-]+$/.test(owner) && /^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return { owner, repo };
    }
  }
  return null;
}

export const RepoInputSchema = z
  .object({
    url: z.string().min(1, 'Repository identifier is required').optional(),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.owner && data.repo) {
      return;
    }
    if (data.url) {
      const parsed = parseGitHubRepo(data.url);
      if (parsed) return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Invalid GitHub repository URL or format. Use 'owner/repo' or 'https://github.com/owner/repo'",
    });
  })
  .transform((data) => {
    if (data.owner && data.repo) {
      return { owner: data.owner, repo: data.repo };
    }
    const parsed = parseGitHubRepo(data.url!)!;
    return { owner: parsed.owner, repo: parsed.repo };
  });

export type RepoInput = z.infer<typeof RepoInputSchema>;

export const RepositoryMetadataSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  url: z.string().url(),
  defaultBranch: z.string(),
  description: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  primaryLanguage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RepositoryMetadata = z.infer<typeof RepositoryMetadataSchema>;

export const FileCategorySchema = z.enum([
  'source',
  'test',
  'config',
  'doc',
  'asset',
  'ci',
  'other',
]);

export type FileCategory = z.infer<typeof FileCategorySchema>;

export const FileTreeItemSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative(),
  extension: z.string(),
  category: FileCategorySchema,
  isLandmark: z.boolean(),
});

export type FileTreeItem = z.infer<typeof FileTreeItemSchema>;

export const TechCategorySchema = z.enum([
  'framework',
  'runtime',
  'build',
  'testing',
  'styling',
  'database',
  'ci',
  'language',
]);

export type TechCategory = z.infer<typeof TechCategorySchema>;

export const TechStackDetectionSchema = z.object({
  category: TechCategorySchema,
  name: z.string(),
  version: z.string().nullable(),
  confidence: z.enum(['high', 'medium']),
  evidence: z.string(),
});

export type TechStackDetection = z.infer<typeof TechStackDetectionSchema>;

export const LandmarkInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(['doc', 'config', 'entry', 'manifest']),
  description: z.string().optional(),
});

export type LandmarkInfo = z.infer<typeof LandmarkInfoSchema>;

export const ArchitectureOverviewSchema = z.object({
  isMonorepo: z.boolean(),
  monorepoTool: z.string().nullable(),
  workspaces: z.array(z.string()),
  detectedPatterns: z.array(z.string()),
  primaryEntrypoints: z.array(z.string()),
  keyLandmarks: z.array(LandmarkInfoSchema),
});

export type ArchitectureOverview = z.infer<typeof ArchitectureOverviewSchema>;

export const LanguageMetricSchema = z.object({
  bytes: z.number(),
  percentage: z.number(),
  fileCount: z.number(),
});

export const CategoryMetricSchema = z.object({
  bytes: z.number(),
  percentage: z.number(),
  fileCount: z.number(),
});

export const StructuralMetricsSchema = z.object({
  totalFiles: z.number(),
  totalBytes: z.number(),
  languages: z.record(LanguageMetricSchema),
  categories: z.record(CategoryMetricSchema),
  largestFiles: z.array(
    z.object({
      path: z.string(),
      size: z.number(),
    })
  ),
});

export type StructuralMetrics = z.infer<typeof StructuralMetricsSchema>;

export const AnalysisResultSchema = z.object({
  repository: RepositoryMetadataSchema,
  commitSha: z.string().nullable(),
  techStack: z.array(TechStackDetectionSchema),
  architecture: ArchitectureOverviewSchema,
  metrics: StructuralMetricsSchema,
  tree: z.array(FileTreeItemSchema),
  analyzedAt: z.string(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const LandmarkContentSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  content: z.string(),
  encoding: z.string().default('utf-8'),
  isTruncated: z.boolean().default(false),
});

export type LandmarkContent = z.infer<typeof LandmarkContentSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  isRateLimit: z.boolean().default(false),
  suggestedAction: z.string().nullable().default(null),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const RecentRepositorySchema = z.object({
  owner: z.string(),
  name: z.string(),
  language: z.string().nullable(),
  analyzedAt: z.string(),
  stars: z.number(),
});

export type RecentRepository = z.infer<typeof RecentRepositorySchema>;
