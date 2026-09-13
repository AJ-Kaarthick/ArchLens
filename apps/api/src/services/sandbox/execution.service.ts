import { randomUUID } from 'node:crypto';
import type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionEligibility,
  ExecutionProfile,
} from '@archlens/shared';
import { db } from '../../db/index.js';
import { repositoryExecutions } from '../../db/schema.js';
import { repositoryService, RepositoryService } from '../repository.service.js';
import { detectExecutionEligibility } from './eligibility.js';
import { workspaceManager, WorkspaceManager } from './workspace-manager.js';
import { processSandboxRunner } from './process-runner.js';
import { clampTimeout, validateArgs, isSandboxEnabled } from './policy.js';
import type { ISandboxRunner, WorkspaceFile } from './types.js';

export class ExecutionService {
  private repoService: RepositoryService;
  private runner: ISandboxRunner;
  private wsManager: WorkspaceManager;

  constructor(
    customRepoService?: RepositoryService,
    customRunner?: ISandboxRunner,
    customWsManager?: WorkspaceManager
  ) {
    this.repoService = customRepoService || repositoryService;
    this.runner = customRunner || processSandboxRunner;
    this.wsManager = customWsManager || workspaceManager;
  }

  async getEligibility(owner: string, repo: string): Promise<ExecutionEligibility> {
    if (!isSandboxEnabled()) {
      return {
        eligible: false,
        recommendedProfile: null,
        detectedEntrypoints: [],
        supportedProfiles: [],
        refusalReason: 'disabled',
        reasonMessage:
          'Sandboxed code execution is disabled by deployment policy (ENABLE_SANDBOX=false).',
        warnings: ['Code execution is disabled in this deployment.'],
      };
    }

    const analysis = await this.repoService.getLatestAnalysis(owner, repo);
    if (!analysis) {
      return {
        eligible: false,
        recommendedProfile: null,
        detectedEntrypoints: [],
        supportedProfiles: [],
        refusalReason: 'missing_entrypoint',
        reasonMessage: 'Repository has not been analyzed yet. Please run an analysis first.',
        warnings: [],
      };
    }

    return detectExecutionEligibility(analysis);
  }

  async execute(
    owner: string,
    repo: string,
    request: ExecutionRequest = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${randomUUID().slice(0, 8)}`;

    if (!isSandboxEnabled()) {
      return {
        executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startTime,
        profile: request.profile || 'node-script',
        refusalReason: 'disabled',
        refusalMessage:
          'Sandboxed code execution is disabled on this server deployment.',
        timestamp: new Date().toISOString(),
      };
    }

    // 1. Fetch latest analysis & repository records
    const record = await this.repoService.getLatestAnalysisWithRecord(owner, repo);
    if (!record) {
      return {
        executionId,
        status: 'error',
        exitCode: null,
        stdout: '',
        stderr: 'Repository has not been analyzed yet. Run analysis before executing.',
        durationMs: 0,
        profile: request.profile || 'node-script',
        refusalReason: 'missing_entrypoint',
        refusalMessage: 'Repository has not been analyzed yet.',
        timestamp: new Date().toISOString(),
      };
    }

    const { analysis, repositoryId, analysisId } = record;

    // 2. Check eligibility
    const eligibility = detectExecutionEligibility(analysis);

    const profile: ExecutionProfile =
      request.profile || eligibility.recommendedProfile || 'node-script';

    // If caller provided no inline code and repository is not eligible for this profile
    if (!request.inlineCode && (!eligibility.eligible || !eligibility.supportedProfiles.includes(profile))) {
      const refusalResult: ExecutionResult = {
        executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startTime,
        profile,
        refusalReason: eligibility.refusalReason || 'unsupported_runtime',
        refusalMessage: eligibility.reasonMessage || 'Repository is not eligible for sandboxed execution.',
        timestamp: new Date().toISOString(),
      };

      await this.logExecution(repositoryId, analysisId, refusalResult);
      return refusalResult;
    }

    // 3. Determine entrypoint
    let entrypoint = request.entrypoint;
    if (!entrypoint) {
      if (profile === 'static-web') {
        entrypoint = eligibility.detectedEntrypoints.find((p) => p.endsWith('.html')) || 'index.html';
      } else {
        entrypoint = eligibility.detectedEntrypoints.find((p) => p.endsWith('.js') || p.endsWith('.mjs')) || 'index.js';
      }
    }

    // 4. Gather workspace files
    const files: WorkspaceFile[] = [];

    if (request.inlineCode) {
      files.push({
        path: entrypoint,
        content: request.inlineCode,
      });
    } else {
      try {
        const entrypointContent = await this.repoService.getLandmarkContent(
          owner,
          repo,
          entrypoint,
          analysis.commitSha || undefined
        );
        files.push({
          path: entrypoint,
          content: entrypointContent.content,
        });

        // For static-web, attempt to fetch associated static assets in the same directory
        if (profile === 'static-web') {
          const entryDir = entrypoint.includes('/') ? entrypoint.slice(0, entrypoint.lastIndexOf('/')) : '';
          const candidateAssets = analysis.tree.filter((item) => {
            if (item.type !== 'file' || item.path === entrypoint) return false;
            const matchesDir = entryDir ? item.path.startsWith(entryDir + '/') : !item.path.includes('/');
            return (
              matchesDir &&
              /\.(css|js|json|svg|png|jpg|jpeg|gif|webp)$/i.test(item.path)
            );
          });

          // Fetch up to 10 companion static assets
          for (const asset of candidateAssets.slice(0, 10)) {
            try {
              const fileContent = await this.repoService.getLandmarkContent(
                owner,
                repo,
                asset.path,
                analysis.commitSha || undefined
              );
              files.push({
                path: asset.path,
                content: fileContent.content,
              });
            } catch {
              // Non-critical: continue even if companion asset fails
            }
          }
        }
      } catch (err) {
        const failureResult: ExecutionResult = {
          executionId,
          status: 'error',
          exitCode: null,
          stdout: '',
          stderr: (err as Error).message || 'Failed to retrieve repository files for execution.',
          durationMs: Date.now() - startTime,
          profile,
          refusalReason: 'missing_entrypoint',
          refusalMessage: `Failed to load entrypoint "${entrypoint}".`,
          timestamp: new Date().toISOString(),
        };
        await this.logExecution(repositoryId, analysisId, failureResult);
        return failureResult;
      }
    }

    // 5. Prepare ephemeral sandbox workspace
    let ws;
    try {
      ws = await this.wsManager.prepareWorkspace({
        executionId,
        files,
      });
    } catch (err) {
      const errorResult: ExecutionResult = {
        executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startTime,
        profile,
        refusalReason: 'exceeded_bounds',
        refusalMessage: (err as Error).message || 'Workspace preparation bounds exceeded.',
        timestamp: new Date().toISOString(),
      };
      await this.logExecution(repositoryId, analysisId, errorResult);
      return errorResult;
    }

    // 6. Execute based on profile
    try {
      if (profile === 'static-web') {
        // Register workspace for live preview endpoint
        this.wsManager.registerPreviewWorkspace(ws);
        const previewUrl = `/api/preview/${executionId}/${entrypoint}`;

        const successResult: ExecutionResult = {
          executionId,
          status: 'success',
          exitCode: 0,
          stdout: `Static web preview prepared successfully with entrypoint: ${entrypoint}`,
          stderr: '',
          durationMs: Date.now() - startTime,
          profile: 'static-web',
          preview: {
            type: 'static-html',
            entrypoint,
            previewUrl,
          },
          timestamp: new Date().toISOString(),
        };

        await this.logExecution(repositoryId, analysisId, successResult);
        return successResult;
      }

      // Profile: node-script
      const result = await this.runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint,
        profile: 'node-script',
        args: validateArgs(request.args),
        timeoutMs: clampTimeout(request.timeoutMs),
      });

      // Cleanup ephemeral workspace immediately for node scripts
      await ws.cleanup();

      await this.logExecution(repositoryId, analysisId, result);
      return result;
    } catch (err) {
      await ws.cleanup();
      const errorResult: ExecutionResult = {
        executionId,
        status: 'error',
        exitCode: null,
        stdout: '',
        stderr: (err as Error).message || 'Execution error occurred.',
        durationMs: Date.now() - startTime,
        profile,
        timestamp: new Date().toISOString(),
      };
      await this.logExecution(repositoryId, analysisId, errorResult);
      return errorResult;
    }
  }

  private async logExecution(
    repositoryId: number,
    analysisId: number,
    result: ExecutionResult
  ): Promise<void> {
    try {
      await db.insert(repositoryExecutions).values({
        repositoryId,
        analysisId,
        executionId: result.executionId,
        profile: result.profile,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        refusalReason: result.refusalReason || null,
        createdAt: new Date(result.timestamp),
      });
    } catch {
      // Non-critical: failure to log execution history does not block execution response
    }
  }
}

export const executionService = new ExecutionService();
