import type {
  ExecutionProfile,
  ExecutionStatus,
  RefusalReason,
  ExecutionRequest,
  ExecutionResult,
  ExecutionEligibility,
  PreviewInfo,
} from '@archlens/shared';

export type {
  ExecutionProfile,
  ExecutionStatus,
  RefusalReason,
  ExecutionRequest,
  ExecutionResult,
  ExecutionEligibility,
  PreviewInfo,
};

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface WorkspacePrepOptions {
  executionId: string;
  files: WorkspaceFile[];
  rootDir?: string;
}

export interface WorkspaceMeta {
  executionId: string;
  workspaceDir: string;
  fileCount: number;
  totalBytes: number;
  createdAt: Date;
  cleanup: () => Promise<void>;
}

export interface SandboxExecutionOptions {
  executionId: string;
  workspacePath: string;
  entrypoint: string;
  profile: ExecutionProfile;
  args: string[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface ISandboxRunner {
  execute(options: SandboxExecutionOptions): Promise<ExecutionResult>;
}
