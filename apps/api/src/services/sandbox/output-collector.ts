import { SANDBOX_LIMITS } from './policy.js';

export class OutputCollector {
  private stdoutBuffer: string = '';
  private stderrBuffer: string = '';
  private stdoutBytes: number = 0;
  private stderrBytes: number = 0;
  private stdoutTruncated: boolean = false;
  private stderrTruncated: boolean = false;
  private readonly maxBytes: number;

  constructor(maxBytes: number = SANDBOX_LIMITS.MAX_OUTPUT_BYTES) {
    this.maxBytes = maxBytes;
  }

  appendStdout(chunk: string | Buffer): void {
    if (this.stdoutTruncated) return;

    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const bytes = Buffer.byteLength(str, 'utf-8');

    if (this.stdoutBytes + bytes > this.maxBytes) {
      const allowedBytes = Math.max(0, this.maxBytes - this.stdoutBytes);
      const sub = Buffer.from(str, 'utf-8').subarray(0, allowedBytes).toString('utf-8');
      this.stdoutBuffer += sub + '\n[ArchLens: stdout truncated at 64 KB limit]';
      this.stdoutBytes = this.maxBytes;
      this.stdoutTruncated = true;
    } else {
      this.stdoutBuffer += str;
      this.stdoutBytes += bytes;
    }
  }

  appendStderr(chunk: string | Buffer): void {
    if (this.stderrTruncated) return;

    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const bytes = Buffer.byteLength(str, 'utf-8');

    if (this.stderrBytes + bytes > this.maxBytes) {
      const allowedBytes = Math.max(0, this.maxBytes - this.stderrBytes);
      const sub = Buffer.from(str, 'utf-8').subarray(0, allowedBytes).toString('utf-8');
      this.stderrBuffer += sub + '\n[ArchLens: stderr truncated at 64 KB limit]';
      this.stderrBytes = this.maxBytes;
      this.stderrTruncated = true;
    } else {
      this.stderrBuffer += str;
      this.stderrBytes += bytes;
    }
  }

  getStdout(): string {
    return this.stdoutBuffer;
  }

  getStderr(): string {
    return this.stderrBuffer;
  }

  isStdoutTruncated(): boolean {
    return this.stdoutTruncated;
  }

  isStderrTruncated(): boolean {
    return this.stderrTruncated;
  }
}
