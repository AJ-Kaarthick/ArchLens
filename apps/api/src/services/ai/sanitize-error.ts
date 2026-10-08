/**
 * Redacts secrets, API keys, tokens, and credentials from error messages and telemetry.
 * Prevents credential leakage to API clients, database rows, and logs.
 */
export function sanitizeErrorMessage(message: unknown): string {
  if (message === null || message === undefined) {
    return 'Unknown error';
  }

  let text = typeof message === 'string' ? message : (message as any)?.message || String(message);

  // 1. Redact known active secrets from environment
  const knownSecrets = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_FALLBACK_API_KEY,
    process.env.GEMINI_TERTIARY_API_KEY,
    process.env.AI_FALLBACK_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.GITHUB_TOKEN,
  ];

  for (const secret of knownSecrets) {
    if (secret && secret.trim().length > 4) {
      text = text.split(secret.trim()).join('[REDACTED]');
    }
  }

  // 2. Redact Google API key patterns (AIza...)
  text = text.replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_API_KEY]');

  // 3. Redact GitHub token patterns (ghp_..., github_pat_...)
  text = text.replace(/ghp_[0-9A-Za-z]{36}/g, '[REDACTED_TOKEN]');
  text = text.replace(/github_pat_[0-9A-Za-z_]{82}/g, '[REDACTED_TOKEN]');

  // 4. Redact OpenAI / generic sk- patterns
  text = text.replace(/sk-[0-9A-Za-z]{20,}/g, '[REDACTED_API_KEY]');

  // 5. Redact Authorization / Bearer tokens
  text = text.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');

  // 6. Redact URL query parameters (e.g. ?key=..., &apiKey=...)
  text = text.replace(/([?&](?:api_?key|key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]');

  return text;
}
