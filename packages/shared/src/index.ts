export const ARCHLENS_VERSION = '0.1.0';

export * from './contracts/repository.js';

// Legacy placeholder interface maintained for backwards compatibility
export interface RepositoryOverview {
  id: string;
  name: string;
  description?: string;
  defaultBranch: string;
}
