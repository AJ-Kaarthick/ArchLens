import type { AnalysisResult, RepositoryMetadata } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';
import { buildFileTreeItems } from './categorizer.js';
import { detectTechStack } from './tech-stack.js';
import { detectArchitecture } from './architecture.js';
import { calculateMetrics } from './metrics.js';

export { categorizePath, detectLandmark, buildFileTreeItems } from './categorizer.js';
export { detectTechStack } from './tech-stack.js';
export { detectArchitecture } from './architecture.js';
export { calculateMetrics } from './metrics.js';

export function analyzeRepositoryData(params: {
  repository: RepositoryMetadata;
  commitSha: string | null;
  rawTree: RawGitTreeItem[];
  manifestContents?: Record<string, string>;
  analyzedAt?: string;
}): AnalysisResult {
  const { repository, commitSha, rawTree, manifestContents = {}, analyzedAt } = params;

  const tree = buildFileTreeItems(rawTree);
  const techStack = detectTechStack(rawTree, manifestContents);
  const architecture = detectArchitecture(rawTree, manifestContents);
  const metrics = calculateMetrics(rawTree);

  return {
    repository,
    commitSha,
    techStack,
    architecture,
    metrics,
    tree,
    analyzedAt: analyzedAt || new Date().toISOString(),
  };
}
