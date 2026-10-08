export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number; // default: 3
  cooldownMs?: number; // default: 60_000 (60s)
  nowFn?: () => number;
}

export interface CircuitBreakerStatus {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}

/**
 * Lightweight in-memory circuit breaker.
 * Protects downstream services and prevents futile API calls during upstream outages.
 *
 * State transitions:
 * - CLOSED: Normal operation. Increments consecutiveFailures on transient errors (5xx/503/timeout).
 *   Trips to OPEN when consecutiveFailures >= failureThreshold (default 3).
 * - OPEN: Requests are skipped/rejected without network call. Remains OPEN for cooldownMs (default 60s).
 *   Transitions to HALF_OPEN once cooldownMs has elapsed.
 * - HALF_OPEN: Allows a probe request. Success closes breaker; failure returns immediately to OPEN.
 */
export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private nextAttemptTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.nowFn = options.nowFn || (() => Date.now());
  }

  /**
   * Returns current effective circuit state, evaluating cooldown if currently OPEN.
   */
  getState(): CircuitState {
    if (this.state === 'OPEN') {
      if (this.nowFn() >= this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  /**
   * Returns true if circuit is strictly OPEN (cannot accept requests).
   */
  isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  /**
   * Returns true if circuit is available to process a request (CLOSED or HALF_OPEN probe).
   */
  isAvailable(): boolean {
    return this.getState() !== 'OPEN';
  }

  /**
   * Records a successful request, resetting failures and closing the circuit.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.nextAttemptTime = 0;
  }

  /**
   * Records a failed request.
   * Only transient 5xx, 503, network, or timeout failures trip the breaker.
   */
  recordFailure(isTransient = true): void {
    if (!isTransient) {
      return;
    }

    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = this.nowFn() + this.cooldownMs;
    }
  }

  /**
   * Manually resets breaker to CLOSED with 0 failures.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.nextAttemptTime = 0;
  }

  getStatus(): CircuitBreakerStatus {
    const currentState = this.getState();
    const remaining =
      currentState === 'OPEN' ? Math.max(0, this.nextAttemptTime - this.nowFn()) : 0;

    return {
      name: this.name,
      state: currentState,
      consecutiveFailures: this.consecutiveFailures,
      cooldownRemainingMs: remaining,
    };
  }
}
