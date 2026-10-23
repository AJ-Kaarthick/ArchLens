import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('initializes in CLOSED state with 0 failures', () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
  });

  it('remains CLOSED when failures are below threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure(true);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStatus().consecutiveFailures).toBe(1);

    breaker.recordFailure(true);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStatus().consecutiveFailures).toBe(2);
  });

  it('ignores non-transient failures from tripping breaker', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure(false);
    breaker.recordFailure(false);
    breaker.recordFailure(false);

    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
  });

  it('trips to OPEN upon reaching consecutive failure threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    breaker.recordFailure(true);

    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.isAvailable()).toBe(false);
  });

  it('resets failures and remains CLOSED on success', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    expect(breaker.getStatus().consecutiveFailures).toBe(2);

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
  });

  it('transitions to HALF_OPEN after cooldown period', () => {
    let simulatedTime = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60_000,
      nowFn: () => simulatedTime,
    });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    breaker.recordFailure(true);
    expect(breaker.getState()).toBe('OPEN');

    // Advance time within cooldown
    simulatedTime += 30_000;
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.isAvailable()).toBe(false);

    // Advance time past cooldown
    simulatedTime += 31_000;
    expect(breaker.getState()).toBe('HALF_OPEN');
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.isAvailable()).toBe(true);
  });

  it('re-opens immediately if a request fails during HALF_OPEN probe', () => {
    let simulatedTime = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60_000,
      nowFn: () => simulatedTime,
    });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    breaker.recordFailure(true);

    // Advance to HALF_OPEN
    simulatedTime += 61_000;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Probe fails
    breaker.recordFailure(true);
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.isOpen()).toBe(true);
  });

  it('recovers to CLOSED if a request succeeds during HALF_OPEN probe', () => {
    let simulatedTime = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60_000,
      nowFn: () => simulatedTime,
    });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    breaker.recordFailure(true);

    // Advance to HALF_OPEN
    simulatedTime += 61_000;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Probe succeeds
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
    expect(breaker.isAvailable()).toBe(true);
  });

  it('manual reset resets state to CLOSED', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure(true);
    expect(breaker.isOpen()).toBe(true);

    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.isOpen()).toBe(false);
  });
});
