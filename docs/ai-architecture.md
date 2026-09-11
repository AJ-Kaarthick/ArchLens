# AI Architecture

> [!NOTE]
> **Status:** Phase 3 Complete — AI-Powered Repository Understanding grounded in deterministic Phase 2 facts.

---

## Core Philosophy

ArchLens implements an AI reasoning layer built strictly on the principle:

$$\text{Deterministic Analysis} \longrightarrow \text{Structured Facts} \longrightarrow \text{AI Reasoning} \longrightarrow \text{Grounded Explanation}$$

AI must enhance ArchLens's comprehension, not serve as an ungrounded, hallucinating source of truth for repository facts.

### Foundational Principles

1. **Grounded in Deterministic Facts:** Every claim, metric, framework detection, and architectural deduction is tied to facts already verified by Phase 2 (manifests, AST patterns, file trees, structural metrics).
2. **Zero Hallucination with Evidence Citations:** Explanations produce structured `evidence` citations referencing real repository files, manifests, entrypoints, dependencies, or metrics.
3. **Provider Agnostic Abstraction:** Model interactions are encapsulated behind the backend `IAIProvider` interface with factory dispatch (`GeminiAIProvider` and deterministic `MockAIProvider`).
4. **Security & Prompt-Injection Resistance:** Untrusted user input (repository descriptions and README excerpts) are bounded to 2,000 characters and stripped of `<untrusted_content>` delimiter tags before being isolated inside `<untrusted_content>` tags. The model is explicitly instructed never to execute instructions from untrusted content.
5. **Zero Client-Side Secrets:** All AI orchestration and API credentials (`GEMINI_API_KEY`) reside exclusively on the server in `apps/api`. `apps/web` receives only validated JSON contracts.
6. **Cost-Free Replay Caching:** Generated explanations are cached in PostgreSQL keyed on `(analysis_id, topic, COALESCE(target, ''))`. Re-requesting an explanation for a previously analyzed commit costs zero AI tokens and returns instantly.

---

## Architecture Flow

```
[apps/web] (React UI - AI Insights Tab)
       │
       ▼ (POST /api/repositories/:owner/:repo/explain)
[apps/api] (Fastify Route)
       │
       ▼
[AIService]
       ├─► 1. Check PostgreSQL `ai_explanations` Cache (analysis_id, topic, target)
       │      └─► Hit: Return cached explanation (cached: true, 0ms token latency)
       │
       ▼ Miss:
[ContextBuilder]
       ├─► Loads Phase 2 deterministic analysis facts (manifests, tree, metrics)
       ├─► Bounded & delimiter-sanitized README excerpt (<untrusted_content>)
       └─► Generates grounded prompt with strict JSON schema constraints
       │
       ▼
[IAIProvider Interface]
       ├─► GeminiAIProvider   (@google/genai, gemini-2.0-flash, 15s timeout)
       └─► MockAIProvider     (Deterministic, offline dynamic heuristic from AnalysisResult)
       │
       ▼
[EvidenceValidator] (Deterministic Grounding Audit)
       ├─► Validates files/manifests/entrypoints against indexed git tree & landmarks
       ├─► Validates dependencies against detected tech stack
       ├─► Validates patterns & metrics against Phase 2 results
       └─► Discards hallucinations; synthesizes verified fallbacks if needed
       │
       ▼
[PostgreSQL Cache] ── Stores in `ai_explanations` table
       │
       ▼
[ExplainResponse JSON] ── Returned to client
```

---

## Provider Abstraction (`IAIProvider`)

Located in `apps/api/src/services/ai/provider.interface.ts`:

```typescript
export class AIRateLimitError extends Error {
  readonly status = 429;
  readonly isRateLimit = true;
  readonly suggestedAction: string;
  // ...
}

export interface AIExplanationRequest {
  topic: ExplainTopic;
  target?: string | null;
  context: string;
  repoName: string;
  analysis?: AnalysisResult;
}

export interface AIExplanationResult {
  summary: string;
  explanation: string;
  keyTakeaways: string[];
  evidence: EvidenceCitation[];
  provider: string;
  model: string;
}

export interface IAIProvider {
  readonly name: string;
  readonly model: string;
  explain(request: AIExplanationRequest): Promise<AIExplanationResult>;
}
```

### Implementations

1. **`GeminiAIProvider` (`apps/api/src/services/ai/providers/gemini.provider.ts`):**
   - Utilizes the official `@google/genai` SDK.
   - Default model: `gemini-2.0-flash` (configurable via `GEMINI_MODEL`).
   - Enforces a 15-second request timeout with `AbortController`.
   - Structured JSON output with markdown fence stripping and Zod validation.
   - Maps quota and 429 status responses to `GeminiRateLimitError` (extending `AIRateLimitError`).

2. **`MockAIProvider` (`apps/api/src/services/ai/providers/mock.provider.ts`):**
   - Dynamically constructs grounded, structured explanations and verified citations directly from `request.analysis` facts.
   - Supports any language ecosystem (Rust, Python, Go, TypeScript, etc.) without network calls.
   - Enables 100% offline development, automated CI tests, and graceful fallback when `GEMINI_API_KEY` is not provided.

3. **`AIProviderFactory` (`apps/api/src/services/ai/provider.factory.ts`):**
   - Inspects `AI_PROVIDER` and `GEMINI_API_KEY`.
   - Automatically selects `GeminiAIProvider` when configured, or falls back to `MockAIProvider` gracefully.

---

## Evidence Grounding & Deterministic Validation (`EvidenceValidator`)

Located in `apps/api/src/services/ai/evidence-validator.ts`.

To maintain ArchLens's core invariant that **AI reasoning must never fabricate repository facts**, model outputs are deterministically validated before persistence:

- **File, Manifest, and Entrypoint Citations**: Must correspond to real files in the repository's indexed git tree or detected landmark set.
- **Dependency Citations**: Must match detected packages in `analysis.techStack`.
- **Pattern Citations**: Must correspond to detected architectural patterns in `analysis.architecture.detectedPatterns`.
- **Metric Citations**: Must correspond to calculated language metrics in `analysis.metrics`.

Any citation that fails cross-validation against the Phase 2 `AnalysisResult` is discarded. If all candidate citations are rejected, `EvidenceValidator.synthesizeGroundedCitations` generates verified citations directly from actual repository landmarks, manifests, and metrics.

---

## Supported Explanation Topics

- **`overview`**: High-level repository purpose, scale, structural layout, and core language breakdown.
- **`architecture`**: In-depth patterns (monorepo packages, service-repository layer, microservices, MVC) and cross-boundary responsibilities.
- **`tech-stack`**: Synergy analysis explaining how detected runtimes, frameworks, build systems, and databases interact.
- **`entrypoints`**: System boot sequences, server listeners, CLI entrypoints, and runtime execution flow.

---

## Evidence Citations

Every explanation response includes an `evidence` array citing factual sources:

```json
{
  "type": "manifest",
  "label": "Build Manifest",
  "reference": "package.json",
  "description": "Declares project dependencies and build lifecycle scripts."
}
```

Citation types include: `file`, `manifest`, `entrypoint`, `dependency`, `metric`, and `pattern`.
The web interface displays clickable evidence badges allowing direct inspection of referenced files.
