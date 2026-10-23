import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { AIExplanationResultSchema } from '../packages/shared/src/index.js';
import { ContextBuilder } from '../apps/api/src/services/ai/context-builder.js';
import {
  extractErrorStatus,
  classifyGeminiError,
  redactSecrets,
} from '../apps/api/src/services/ai/providers/gemini.provider.js';
import { OpenAICompatibleProvider } from '../apps/api/src/services/ai/providers/openai-compatible.provider.js';
import type { AnalysisResult } from '../packages/shared/src/index.js';

// Resolve directory and load environment variables from apps/api/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiEnvPath = path.resolve(__dirname, '../apps/api/.env');
dotenv.config({ path: apiEnvPath });
dotenv.config(); // fallback to current process env

// Canonical and alias configuration resolution
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const geminiFallbackKey = process.env.GEMINI_FALLBACK_API_KEY;
const geminiTertiaryKey = process.env.GEMINI_TERTIARY_API_KEY;

// Independent Fallback Provider Configuration (Canonical with supported aliases)
const fallbackApiKey = process.env.AI_FALLBACK_API_KEY || process.env.OPENAI_API_KEY;
const fallbackBaseUrl =
  process.env.AI_FALLBACK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const fallbackModel =
  process.env.AI_FALLBACK_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Representative ArchLens repository analysis facts (Fastify)
const mockAnalysis: AnalysisResult = {
  repository: {
    id: '1',
    owner: 'fastify',
    name: 'fastify',
    url: 'https://github.com/fastify/fastify',
    defaultBranch: 'main',
    description: 'Fast and low overhead web framework, for Node.js',
    stars: 32000,
    forks: 2400,
    primaryLanguage: 'JavaScript',
    createdAt: '2016-10-18T10:00:00Z',
    updatedAt: new Date().toISOString(),
  },
  commitSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
  analyzedAt: new Date().toISOString(),
  techStack: [
    {
      category: 'framework',
      name: 'Fastify',
      version: '4.26.0',
      confidence: 'high',
      evidence: 'package.json',
    },
    {
      category: 'runtime',
      name: 'Node.js',
      version: '>=14.0.0',
      confidence: 'high',
      evidence: 'package.json',
    },
  ],
  architecture: {
    isMonorepo: false,
    monorepoTool: null,
    workspaces: [],
    detectedPatterns: ['Layered Architecture', 'Plugin Architecture'],
    primaryEntrypoints: ['fastify.js', 'lib/server.js'],
    keyLandmarks: [
      {
        path: 'fastify.js',
        name: 'fastify.js',
        type: 'entry',
        description: 'Fastify application root and factory constructor',
      },
    ],
  },
  metrics: {
    totalFiles: 120,
    totalBytes: 489000,
    languages: {
      JavaScript: { bytes: 450000, percentage: 92, fileCount: 110 },
      TypeScript: { bytes: 39000, percentage: 8, fileCount: 10 },
    },
    categories: {
      source: { bytes: 420000, percentage: 86, fileCount: 85 },
      test: { bytes: 60000, percentage: 12, fileCount: 25 },
      config: { bytes: 9000, percentage: 2, fileCount: 10 },
    },
    largestFiles: [{ path: 'fastify.js', size: 45000 }],
  },
  tree: [
    {
      path: 'fastify.js',
      name: 'fastify.js',
      type: 'file',
      category: 'source',
      size: 45000,
      extension: 'js',
      isLandmark: true,
    },
  ],
};

const readmeExcerpt = `
# Fastify
Fastify is a web framework highly focused on providing the best developer experience with the least overhead and a powerful plugin architecture.
`;

const retrievedChunks = [
  {
    filePath: 'fastify.js',
    startLine: 1,
    endLine: 20,
    content: `
'use strict'
const { createServer } = require('http')
function fastify(options) {
  return { get: () => {} }
}
module.exports = fastify
`,
  },
];

// Generate representative context with ContextBuilder
const groundedContext = ContextBuilder.build({
  analysis: mockAnalysis,
  topic: 'overview',
  readmeExcerpt,
  retrievedChunks,
});

interface AttemptRecord {
  model: string;
  attempt: number;
  httpStatus: number;
  latencyMs: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  jsonParsed?: boolean;
}

interface ModelSummary {
  model: string;
  attempts: number;
  twoHundred: number;
  fourTwentyNine: number;
  fiveHundredThree: number;
  timeout: number;
  other: number;
  p50: number;
  p95: number;
  finishReasons: string;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

async function runModelAttempt(
  client: GoogleGenAI,
  model: string,
  attemptNumber: number,
  timeoutMs = 30000
): Promise<AttemptRecord> {
  const abortController = new AbortController();
  const startTime = Date.now();

  const timer = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await client.models.generateContent({
      model,
      contents: groundedContext.combinedContext,
      config: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingLevel: 'LOW' as any,
        },
        abortSignal: abortController.signal,
        httpOptions: {
          retryOptions: { attempts: 1 },
        },
      },
    });

    const latencyMs = Date.now() - startTime;
    clearTimeout(timer);

    const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP';
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount;
    const outputTokens = usage?.candidatesTokenCount;
    const thinkingTokens = (usage as any)?.candidatesTokensDetails?.[0]?.thinkingTokenCount;

    let jsonParsed = false;
    const text = response.text || '';
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      const validation = AIExplanationResultSchema.safeParse(parsed);
      jsonParsed = validation.success;
    } catch {
      jsonParsed = false;
    }

    return {
      model,
      attempt: attemptNumber,
      httpStatus: 200,
      latencyMs,
      finishReason,
      inputTokens,
      outputTokens,
      thinkingTokens,
      jsonParsed,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    clearTimeout(timer);

    const isTimeout = abortController.signal.aborted;
    const { status, code } = extractErrorStatus(err);
    const category = isTimeout ? 'timeout' : classifyGeminiError(err);
    const httpStatus = status ?? (isTimeout ? 408 : 500);

    const rawMsg = err instanceof Error ? err.message : String(err);
    const sanitizedMsg = redactSecrets(rawMsg, [geminiApiKey || '']);

    return {
      model,
      attempt: attemptNumber,
      httpStatus,
      latencyMs,
      errorCategory: category,
      errorCode: code,
      errorMessage: sanitizedMsg.slice(0, 120),
    };
  }
}

function printConfigurationDiagnosis() {
  console.log('='.repeat(70));
  console.log('🔍 ARCHLENS AI PROVIDER CONFIGURATION DIAGNOSIS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Env File:  ${apiEnvPath}`);
  console.log('-'.repeat(70));

  console.log('\n[Primary Provider: Google Gemini]');
  console.log(`  GEMINI_API_KEY:          ${geminiApiKey ? `[CONFIGURED, length=${geminiApiKey.length}]` : '[NOT SET]'}`);
  console.log(`  GEMINI_MODEL:            ${process.env.GEMINI_MODEL || '[DEFAULT: gemini-3.8-flash]'}`);
  console.log(`  GEMINI_FALLBACK_API_KEY: ${geminiFallbackKey ? `[CONFIGURED, length=${geminiFallbackKey.length}]` : '[NOT SET]'}`);
  console.log(`  GEMINI_TERTIARY_API_KEY: ${geminiTertiaryKey ? `[CONFIGURED, length=${geminiTertiaryKey.length}]` : '[NOT SET]'}`);

  console.log('\n[Independent Fallback Provider: OpenAI-Compatible]');
  const hasFallbackKey = Boolean(fallbackApiKey);
  console.log(`  AI_FALLBACK_API_KEY:     ${process.env.AI_FALLBACK_API_KEY ? `[CONFIGURED, length=${process.env.AI_FALLBACK_API_KEY.length}]` : '[NOT SET]'}`);
  console.log(`  OPENAI_API_KEY (alias):  ${process.env.OPENAI_API_KEY ? `[CONFIGURED, length=${process.env.OPENAI_API_KEY.length}]` : '[NOT SET]'}`);
  console.log(`  Effective Fallback Key:  ${hasFallbackKey ? `[CONFIGURED, length=${fallbackApiKey!.length}]` : '[NOT SET]'}`);
  console.log(`  AI_FALLBACK_BASE_URL:    ${fallbackBaseUrl}`);
  console.log(`  AI_FALLBACK_MODEL:       ${fallbackModel}`);

  console.log('\n[Live Test Capabilities]');
  if (hasFallbackKey) {
    console.log('  ✅ Independent fallback credentials ARE configured.');
    console.log('     Run with --live-fallback to send 1 bounded request to the independent provider.');
  } else {
    console.log('  ⚠️  Independent fallback credentials are NOT configured.');
    console.log('     To configure, set in apps/api/.env:');
    console.log('       AI_FALLBACK_API_KEY=<your-key>  (or OPENAI_API_KEY)');
    console.log('       AI_FALLBACK_BASE_URL=<endpoint> (optional, e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1)');
    console.log('       AI_FALLBACK_MODEL=<model>       (optional, defaults to gpt-4o-mini)');
  }

  if (geminiApiKey) {
    console.log('  ✅ Gemini primary credentials ARE configured.');
    console.log('     Run with --live-gemini to run the Gemini multi-model diagnostic.');
  }

  console.log('\n' + '='.repeat(70));
}

async function runLiveFallbackSmoke(): Promise<void> {
  console.log('='.repeat(70));
  console.log('🚀 ARCHLENS LIVE INDEPENDENT PROVIDER SMOKE TEST');
  console.log('='.repeat(70));

  if (!fallbackApiKey) {
    console.error('❌ Error: Cannot run --live-fallback: No independent fallback API key configured.');
    console.error('Missing configuration:');
    console.error('  - AI_FALLBACK_API_KEY (or OPENAI_API_KEY)');
    console.error('  - AI_FALLBACK_BASE_URL (defaults to https://api.openai.com/v1)');
    console.error('  - AI_FALLBACK_MODEL (defaults to gpt-4o-mini)');
    process.exit(1);
  }

  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Base URL:  ${fallbackBaseUrl}`);
  console.log(`Model:     ${fallbackModel}`);
  console.log(`API Key:   [CONFIGURED - length ${fallbackApiKey.length}]`);
  console.log(`Timeout:   15,000ms bounded boundary`);
  console.log('-'.repeat(70));

  const provider = new OpenAICompatibleProvider({
    apiKey: fallbackApiKey,
    baseUrl: fallbackBaseUrl,
    model: fallbackModel,
    perAttemptTimeoutMs: 15_000,
    maxRetries: 1,
  });

  const startTime = Date.now();
  try {
    process.stdout.write(`Sending 1 bounded request to ${fallbackModel} at ${fallbackBaseUrl}... `);
    const result = await provider.explain({
      topic: 'overview',
      context: groundedContext.combinedContext,
      repoName: 'fastify/fastify',
    });

    const latencyMs = Date.now() - startTime;
    console.log(`✅ SUCCESS (${latencyMs}ms)`);
    console.log('-'.repeat(70));
    console.log('Outcome:');
    console.log(`  Provider:     ${result.provider}`);
    console.log(`  Model:        ${result.model}`);
    console.log(`  Summary:      ${result.summary}`);
    console.log(`  Takeaways:    ${result.keyTakeaways.length} items`);
    console.log(`  Evidence:     ${result.evidence.length} items`);
    console.log('='.repeat(70));
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    console.log(`❌ FAILED (${latencyMs}ms)`);
    console.log('-'.repeat(70));
    const rawMsg = err instanceof Error ? err.message : String(err);
    const sanitized = redactSecrets(rawMsg, [fallbackApiKey, geminiApiKey || '']);
    console.error(`Error: ${sanitized}`);
    console.log('='.repeat(70));
    process.exit(1);
  }
}

async function runGeminiSmoke(): Promise<void> {
  if (!geminiApiKey) {
    console.error('❌ Error: Cannot run --live-gemini: GEMINI_API_KEY is not set.');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('🔍 ARCHLENS REAL GEMINI PROVIDER SMOKE DIAGNOSTIC');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`API Key: [CONFIGURED - length ${geminiApiKey.length}]`);
  console.log(`Context Size: ~${groundedContext.combinedContext.length} chars (~${Math.round(groundedContext.combinedContext.length / 4)} tokens)`);
  console.log(`Attempt Timeout: 30,000ms`);
  console.log(`Runs Per Model: 5`);
  console.log('-'.repeat(70));

  const client = new GoogleGenAI({ apiKey: geminiApiKey });
  const models = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];
  const allResults: AttemptRecord[] = [];
  const modelSummaries: ModelSummary[] = [];

  for (const model of models) {
    console.log(`\n▶ Testing Model: ${model}`);
    const modelAttempts: AttemptRecord[] = [];

    for (let i = 1; i <= 5; i++) {
      process.stdout.write(`  [${i}/5] Requesting ${model}... `);
      const rec = await runModelAttempt(client, model, i, 30000);
      modelAttempts.push(rec);
      allResults.push(rec);

      if (rec.httpStatus === 200) {
        console.log(
          `✅ 200 OK (${rec.latencyMs}ms) | tokens: ${rec.inputTokens}in/${rec.outputTokens}out | finish: ${rec.finishReason} | jsonValid: ${rec.jsonParsed}`
        );
      } else {
        console.log(
          `❌ HTTP ${rec.httpStatus} (${rec.latencyMs}ms) | errorClass: ${rec.errorCategory} | msg: ${rec.errorMessage}`
        );
      }

      if (i < 5) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    const twoHundred = modelAttempts.filter((a) => a.httpStatus >= 200 && a.httpStatus < 300).length;
    const fourTwentyNine = modelAttempts.filter((a) => a.httpStatus === 429).length;
    const fiveHundredThree = modelAttempts.filter((a) => a.httpStatus === 503).length;
    const timeout = modelAttempts.filter((a) => a.httpStatus === 408 || a.errorCategory === 'timeout').length;
    const other = modelAttempts.length - twoHundred - fourTwentyNine - fiveHundredThree - timeout;

    const latencies = modelAttempts.map((a) => a.latencyMs);
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);

    const reasons = Array.from(
      new Set(modelAttempts.map((a) => a.finishReason || a.errorCategory || 'UNKNOWN'))
    ).join(',');

    modelSummaries.push({
      model,
      attempts: modelAttempts.length,
      twoHundred,
      fourTwentyNine,
      fiveHundredThree,
      timeout,
      other,
      p50,
      p95,
      finishReasons: reasons,
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 GEMINI SMOKE TEST SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log(
    '| Model            | Attempts | 2xx | 429 | 503 | Timeout | Other | p50 (ms) | p95 (ms) | FinishReason |'
  );
  console.log(
    '|------------------|----------|-----|-----|-----|---------|-------|----------|----------|--------------|'
  );

  for (const s of modelSummaries) {
    const pad = (v: any, n: number) => String(v).padEnd(n);
    console.log(
      `| ${pad(s.model, 16)} | ${pad(s.attempts, 8)} | ${pad(s.twoHundred, 3)} | ${pad(s.fourTwentyNine, 3)} | ${pad(s.fiveHundredThree, 3)} | ${pad(s.timeout, 7)} | ${pad(s.other, 5)} | ${pad(s.p50, 8)} | ${pad(s.p95, 8)} | ${pad(s.finishReasons, 12)} |`
    );
  }
  console.log('='.repeat(70));
}

async function main() {
  const isLiveFallback = process.argv.includes('--live-fallback');
  const isLiveGemini = process.argv.includes('--live-gemini') || process.argv.includes('--gemini');

  if (isLiveFallback) {
    await runLiveFallbackSmoke();
  } else if (isLiveGemini) {
    await runGeminiSmoke();
  } else {
    printConfigurationDiagnosis();
  }
}

main().catch((err) => {
  console.error('Fatal smoke test runner error:', err);
  process.exit(1);
});
