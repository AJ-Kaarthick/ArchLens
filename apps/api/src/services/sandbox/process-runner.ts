import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ISandboxRunner, SandboxExecutionOptions, ExecutionResult } from './types.js';
import { SAFE_ENV, SANDBOX_LIMITS, clampTimeout, isPathSafe } from './policy.js';
import { OutputCollector } from './output-collector.js';

export class ProcessSandboxRunner implements ISandboxRunner {
  private activeProcesses = new Set<ReturnType<typeof spawn>>();

  async execute(options: SandboxExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = clampTimeout(options.timeoutMs);

    // 1. Path safety check on entrypoint
    if (!isPathSafe(options.entrypoint)) {
      return {
        executionId: options.executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        profile: options.profile,
        refusalReason: 'unsafe_project',
        refusalMessage: `Entrypoint path "${options.entrypoint}" is unsafe or attempts directory traversal.`,
        timestamp: new Date().toISOString(),
      };
    }

    const fullEntrypointPath = path.resolve(options.workspacePath, options.entrypoint);
    if (
      !fullEntrypointPath.startsWith(options.workspacePath + path.sep) &&
      fullEntrypointPath !== options.workspacePath
    ) {
      return {
        executionId: options.executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        profile: options.profile,
        refusalReason: 'unsafe_project',
        refusalMessage: 'Entrypoint resolves outside the isolated workspace directory.',
        timestamp: new Date().toISOString(),
      };
    }

    // Verify entrypoint exists
    try {
      const stats = await fs.stat(fullEntrypointPath);
      if (!stats.isFile()) {
        return {
          executionId: options.executionId,
          status: 'refused',
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: 0,
          profile: options.profile,
          refusalReason: 'missing_entrypoint',
          refusalMessage: `Entrypoint "${options.entrypoint}" is not a valid file.`,
          timestamp: new Date().toISOString(),
        };
      }
    } catch {
      return {
        executionId: options.executionId,
        status: 'refused',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        profile: options.profile,
        refusalReason: 'missing_entrypoint',
        refusalMessage: `Entrypoint "${options.entrypoint}" does not exist in the workspace.`,
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Prepare Node runtime arguments and stripped environment
    const nodeArgs = [
      '--no-addons',
      '--no-warnings',
      `--max-old-space-size=${SANDBOX_LIMITS.NODE_MAX_OLD_SPACE_SIZE_MB}`,
      fullEntrypointPath,
      ...(options.args || []),
    ];

    // Strictly stripped environment: zero host secrets inherited
    const childEnv = {
      ...SAFE_ENV,
      ...(options.env || {}),
    };

    const collector = new OutputCollector(SANDBOX_LIMITS.MAX_OUTPUT_BYTES);

    return new Promise<ExecutionResult>((resolve) => {
      let isTimedOut = false;
      let hasResolved = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      let child: ReturnType<typeof spawn>;

      try {
        child = spawn(process.execPath, nodeArgs, {
          cwd: options.workspacePath,
          env: childEnv,
          detached: true, // Creates a new process group to allow killing entire child tree
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.activeProcesses.add(child);
      } catch (err) {
        const durationMs = Date.now() - startTime;
        return resolve({
          executionId: options.executionId,
          status: 'error',
          exitCode: null,
          stdout: '',
          stderr: (err as Error).message || 'Failed to spawn child process.',
          durationMs,
          profile: options.profile,
          refusalReason: 'unsafe_project',
          refusalMessage: 'Spawn execution failed.',
          timestamp: new Date().toISOString(),
        });
      }

      const finish = (result: Partial<ExecutionResult>) => {
        this.activeProcesses.delete(child);
        if (hasResolved) return;
        hasResolved = true;

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        const durationMs = Date.now() - startTime;

        resolve({
          executionId: options.executionId,
          status: result.status || (result.exitCode === 0 ? 'success' : 'failed'),
          exitCode: result.exitCode ?? null,
          stdout: collector.getStdout(),
          stderr: collector.getStderr(),
          durationMs,
          profile: options.profile,
          refusalReason: result.refusalReason,
          refusalMessage: result.refusalMessage,
          timestamp: new Date().toISOString(),
        });
      };

      // Set hard execution timeout
      timer = setTimeout(() => {
        isTimedOut = true;
        collector.appendStderr(
          `\n[ArchLens: execution timed out after ${timeoutMs}ms and was terminated]\n`
        );

        // Terminate the entire process group if PID is available
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore if already exited
            }
          }
        }

        finish({
          status: 'timeout',
          exitCode: null,
          refusalReason: 'timeout',
          refusalMessage: `Process exceeded maximum timeout limit of ${timeoutMs}ms.`,
        });
      }, timeoutMs);

      if (child.stdout) {
        child.stdout.on('data', (data) => collector.appendStdout(data));
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => collector.appendStderr(data));
      }

      child.on('error', (err) => {
        if (isTimedOut) return;
        collector.appendStderr(`\nProcess error: ${err.message}\n`);
        finish({
          status: 'error',
          exitCode: null,
          refusalReason: 'unsafe_project',
          refusalMessage: err.message,
        });
      });

      child.on('close', (code) => {
        if (isTimedOut) return;
        finish({
          status: code === 0 ? 'success' : 'failed',
          exitCode: code,
        });
      });
    });
  }

  /**
   * Gracefully/forcefully terminates all actively running sandbox child processes.
   * Used during graceful shutdown.
   */
  async terminateAllProcesses(): Promise<void> {
    for (const child of this.activeProcesses) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process may have already exited
          }
        }
      }
    }
    this.activeProcesses.clear();
  }
}

export const processSandboxRunner = new ProcessSandboxRunner();
