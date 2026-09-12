import { describe, it, expect } from 'vitest';
import { OutputCollector } from './output-collector.js';

describe('OutputCollector', () => {
  it('collects small chunks correctly', () => {
    const collector = new OutputCollector(1024);
    collector.appendStdout('Hello ');
    collector.appendStdout('World\n');
    collector.appendStderr('Warning: low memory\n');

    expect(collector.getStdout()).toBe('Hello World\n');
    expect(collector.getStderr()).toBe('Warning: low memory\n');
    expect(collector.isStdoutTruncated()).toBe(false);
    expect(collector.isStderrTruncated()).toBe(false);
  });

  it('truncates stdout when exceeding limit and appends notice', () => {
    const maxBytes = 100;
    const collector = new OutputCollector(maxBytes);

    const chunk = 'x'.repeat(150);
    collector.appendStdout(chunk);

    expect(collector.isStdoutTruncated()).toBe(true);
    expect(collector.getStdout()).toContain('[ArchLens: stdout truncated at 64 KB limit]');
    expect(collector.getStdout().startsWith('x'.repeat(100))).toBe(true);

    // Further appends should be discarded
    collector.appendStdout('more data');
    expect(collector.getStdout()).not.toContain('more data');
  });

  it('truncates stderr when exceeding limit and appends notice', () => {
    const maxBytes = 50;
    const collector = new OutputCollector(maxBytes);

    const chunk = 'err-'.repeat(20); // 80 bytes
    collector.appendStderr(chunk);

    expect(collector.isStderrTruncated()).toBe(true);
    expect(collector.getStderr()).toContain('[ArchLens: stderr truncated at 64 KB limit]');
  });
});
