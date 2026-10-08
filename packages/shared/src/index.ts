export const ARCHLENS_VERSION = '1.0.0';

export * from './contracts/repository.js';
export * from './contracts/ai.js';
export * from './contracts/search.js';
export * from './contracts/execution.js';
export * from './contracts/system.js';

// Legacy placeholder interface maintained for backwards compatibility
export interface RepositoryOverview {
  id: string;
  name: string;
  description?: string;
  defaultBranch: string;
}
