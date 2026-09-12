import fs from 'node:fs/promises';
import path from 'node:path';
import { BASE_SANDBOX_DIR, SANDBOX_LIMITS, isPathSafe } from './policy.js';
import type { WorkspaceMeta, WorkspacePrepOptions } from './types.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export class WorkspaceManager {
  private activeWorkspaces = new Map<string, { meta: WorkspaceMeta; expiresAt: number }>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic sweep every 2 minutes for expired workspaces
    this.sweepTimer = setInterval(() => {
      this.sweepExpiredWorkspaces().catch(() => {});
    }, 2 * 60 * 1000);
    // Unref so it doesn't hold open process in tests
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Cleans up the background interval. Useful for graceful shutdown in test suites.
   */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async prepareWorkspace(options: WorkspacePrepOptions): Promise<WorkspaceMeta> {
    const { executionId, files } = options;

    if (!executionId || !/^[a-zA-Z0-9_-]+$/.test(executionId)) {
      throw new Error('Invalid executionId format.');
    }

    if (files.length > SANDBOX_LIMITS.MAX_FILES) {
      throw new Error(
        `Workspace file count (${files.length}) exceeds maximum limit of ${SANDBOX_LIMITS.MAX_FILES}.`
      );
    }

    let totalBytes = 0;
    for (const file of files) {
      if (!isPathSafe(file.path)) {
        throw new Error(`Forbidden file path traversal detected: "${file.path}".`);
      }
      const fileBytes = Buffer.byteLength(file.content, 'utf-8');
      if (fileBytes > SANDBOX_LIMITS.MAX_FILE_BYTES) {
        throw new Error(
          `File "${file.path}" exceeds maximum file size limit of ${SANDBOX_LIMITS.MAX_FILE_BYTES} bytes.`
        );
      }
      totalBytes += fileBytes;
    }

    if (totalBytes > SANDBOX_LIMITS.MAX_TOTAL_WORKSPACE_BYTES) {
      throw new Error(
        `Total workspace size (${totalBytes} bytes) exceeds maximum limit of ${SANDBOX_LIMITS.MAX_TOTAL_WORKSPACE_BYTES} bytes.`
      );
    }

    const workspaceDir = path.join(BASE_SANDBOX_DIR, executionId);
    await fs.mkdir(workspaceDir, { recursive: true, mode: 0o700 });

    for (const file of files) {
      const fullPath = path.join(workspaceDir, file.path);
      const parentDir = path.dirname(fullPath);
      await fs.mkdir(parentDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(fullPath, file.content, { encoding: 'utf-8', mode: 0o600 });
    }

    const cleanup = async () => {
      this.activeWorkspaces.delete(executionId);
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors if directory is already removed
      }
    };

    const meta: WorkspaceMeta = {
      executionId,
      workspaceDir,
      fileCount: files.length,
      totalBytes,
      createdAt: new Date(),
      cleanup,
    };

    return meta;
  }

  /**
   * Registers a workspace for static web preview with TTL.
   */
  registerPreviewWorkspace(meta: WorkspaceMeta, ttlMs: number = SANDBOX_LIMITS.PREVIEW_TTL_MS): void {
    this.activeWorkspaces.set(meta.executionId, {
      meta,
      expiresAt: Date.now() + ttlMs,
    });
  }

  getPreviewWorkspace(executionId: string): WorkspaceMeta | null {
    const item = this.activeWorkspaces.get(executionId);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      item.meta.cleanup().catch(() => {});
      this.activeWorkspaces.delete(executionId);
      return null;
    }
    return item.meta;
  }

  /**
   * Safely resolves a requested static file within a preview workspace,
   * enforcing strict path confinement and determining the appropriate MIME type.
   */
  async resolvePreviewFile(
    executionId: string,
    relativeRequestedPath: string
  ): Promise<{ absolutePath: string; mimeType: string } | null> {
    const ws = this.getPreviewWorkspace(executionId);
    if (!ws) return null;

    let targetRelPath = relativeRequestedPath.replace(/^\/+/, '');
    if (!targetRelPath || targetRelPath.endsWith('/')) {
      targetRelPath += 'index.html';
    }

    if (!isPathSafe(targetRelPath)) {
      return null;
    }

    const resolvedPath = path.resolve(ws.workspaceDir, targetRelPath);
    if (!resolvedPath.startsWith(ws.workspaceDir + path.sep) && resolvedPath !== ws.workspaceDir) {
      return null;
    }

    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        return null;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      return {
        absolutePath: resolvedPath,
        mimeType,
      };
    } catch {
      return null;
    }
  }

  private async sweepExpiredWorkspaces(): Promise<void> {
    const now = Date.now();
    for (const [id, item] of this.activeWorkspaces.entries()) {
      if (now > item.expiresAt) {
        this.activeWorkspaces.delete(id);
        await item.meta.cleanup().catch(() => {});
      }
    }
  }
}

export const workspaceManager = new WorkspaceManager();
