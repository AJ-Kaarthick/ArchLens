import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceManager } from './workspace-manager.js';

describe('WorkspaceManager', () => {
  const manager = new WorkspaceManager();

  afterAll(() => {
    manager.destroy();
  });

  it('prepares an isolated workspace and cleans it up', async () => {
    const executionId = `test_exec_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        { path: 'index.js', content: 'console.log("hello");' },
        { path: 'subdir/helper.js', content: 'export const x = 1;' },
      ],
    });

    expect(ws.executionId).toBe(executionId);
    expect(ws.fileCount).toBe(2);

    // Verify files physically exist on disk
    const mainContent = await fs.readFile(path.join(ws.workspaceDir, 'index.js'), 'utf-8');
    expect(mainContent).toBe('console.log("hello");');

    const helperContent = await fs.readFile(
      path.join(ws.workspaceDir, 'subdir/helper.js'),
      'utf-8'
    );
    expect(helperContent).toBe('export const x = 1;');

    // Cleanup
    await ws.cleanup();

    // Verify directory is deleted
    await expect(fs.stat(ws.workspaceDir)).rejects.toThrow();
  });

  it('rejects forbidden directory traversal attempts in file paths', async () => {
    const executionId = `test_traversal_${Date.now()}`;

    await expect(
      manager.prepareWorkspace({
        executionId,
        files: [{ path: '../evil.js', content: 'bad' }],
      })
    ).rejects.toThrow(/Forbidden file path traversal/);

    await expect(
      manager.prepareWorkspace({
        executionId,
        files: [{ path: '/etc/passwd', content: 'bad' }],
      })
    ).rejects.toThrow(/Forbidden file path traversal/);
  });

  it('rejects workspaces exceeding MAX_FILES limit (25)', async () => {
    const executionId = `test_max_files_${Date.now()}`;
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `file_${i}.js`,
      content: 'test',
    }));

    await expect(
      manager.prepareWorkspace({
        executionId,
        files,
      })
    ).rejects.toThrow(/exceeds maximum limit of 25/);
  });

  it('rejects workspaces exceeding single file limit (500 KB)', async () => {
    const executionId = `test_big_file_${Date.now()}`;
    const files = [{ path: 'huge.js', content: 'a'.repeat(501 * 1024) }];

    await expect(
      manager.prepareWorkspace({
        executionId,
        files,
      })
    ).rejects.toThrow(/exceeds maximum file size limit/);
  });

  it('registers preview workspaces and resolves static files safely', async () => {
    const executionId = `test_preview_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        { path: 'index.html', content: '<h1>Hello Preview</h1>' },
        { path: 'style.css', content: 'body { color: red; }' },
      ],
    });

    manager.registerPreviewWorkspace(ws);

    // Resolve index.html
    const htmlFile = await manager.resolvePreviewFile(executionId, 'index.html');
    expect(htmlFile).not.toBeNull();
    expect(htmlFile?.mimeType).toBe('text/html; charset=utf-8');

    // Resolve style.css
    const cssFile = await manager.resolvePreviewFile(executionId, 'style.css');
    expect(cssFile).not.toBeNull();
    expect(cssFile?.mimeType).toBe('text/css; charset=utf-8');

    // Reject traversal in preview file resolution
    const traversalAttempt = await manager.resolvePreviewFile(executionId, '../../etc/passwd');
    expect(traversalAttempt).toBeNull();

    // Reject non-existent file
    const missingFile = await manager.resolvePreviewFile(executionId, 'missing.png');
    expect(missingFile).toBeNull();

    await ws.cleanup();
  });
});
