# AI Architecture

> [!NOTE]
> **Status:** Phase 4 Complete — AI-Powered Repository Understanding grounded in deterministic Phase 2 facts, augmented by Phase 4 Semantic Repository Retrieval.

---

## Core Philosophy

ArchLens implements an AI reasoning layer built strictly on the principle:

$$\text{Deterministic Analysis (Facts)} + \text{Semantic Retrieval (Relevance)} \longrightarrow \text{Context-Augmented Grounded Explanation}$$

AI must enhance ArchLens's comprehension, not serve as an ungrounded, hallucinating source of truth for repository facts.

### Foundational Principles

1. **Grounded in Deterministic Facts:** Every claim, metric, framework detection, and architectural deduction is tied to facts already verified by Phase 2 (manifests, AST patterns, file trees, structural metrics).
2. **Semantic Retrieval as Context Augmentation:** Semantic vector search locates relevant code and documentation chunks. These slices provide rich, localized context to the LLM but never override or invent structural repository facts.
3. **Zero Hallucination with Evidence Citations:** Explanations produce structured `evidence` citations referencing real repository files, manifests, entrypoints, dependencies, or metrics.
4. **Provider Agnostic Abstractions:** Model generation is encapsulated behind `IAIProvider` (`GeminiAIProvider` and deterministic `MockAIProvider`). Embeddings are encapsulated behind `IEmbeddingProvider` (`GeminiEmbeddingProvider` and deterministic `MockEmbeddingProvider`).
5. **Security & Prompt-Injection Resistance:** Untrusted user input (repository descriptions, README excerpts, and retrieved code chunks) are bounded, delimiter-sanitized, and isolated inside XML-style `<untrusted_content>` tags. The model is explicitly instructed never to execute instructions from untrusted content.
6. **Zero Client-Side Secrets:** All AI orchestration and API credentials (`GEMINI_API_KEY`) reside exclusively on the server in `apps/api`. `apps/web` receives only validated JSON contracts.
7. **Cost-Free Replay Caching:** Generated explanations are cached in PostgreSQL keyed on `(analysis_id, topic, COALESCE(target, ''))`. Re-requesting an explanation for a previously analyzed commit costs zero AI tokens and returns instantly.
8. **EvidenceValidator Supremacy:** `EvidenceValidator` remains strictly authoritative over all retrieved context and AI claims. The model cannot assert facts from retrieved code snippets unless those claims are verified against deterministic Phase 2 analysis facts.
9. **Zero Code Execution:** Repository code is never executed during semantic indexing or retrieval; chunks and manifests are processed strictly as static text slices.

---

## Architecture Flow

```
[apps/web] (React UI - AI Insights & Semantic Search)
       │
       ├─► (POST /api/repositories/:owner/:repo/search) ──► [RetrievalService]
       │                                                          │
       │                                     ┌────────────────────┴────────────────────┐
       │                                     ▼                                         ▼
       │                              [pgvector HNSW]                        [In-Memory Cosine Fallback]
       │                              (if extension present)                 (relational code_chunks)
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
       ├─► 2. Semantic Retrieval via [RetrievalService.search()] for localized context
       │
       ▼
[ContextBuilder]
       ├─► Loads Phase 2 deterministic analysis facts (manifests, tree, metrics)
       ├─► Bounded & delimiter-sanitized README excerpt (<untrusted_content source="readme">)
       ├─► Relevant retrieved code chunks (<untrusted_content source="semantic_retrieval">)
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

---

## Embedding Provider Abstraction (`IEmbeddingProvider`)

Located in `apps/api/src/services/ai/embeddings/embedding.interface.ts`:

```typescript
export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embedText(text: string): Promise<number[]>;
  embedQuery(query: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### Implementations

1. **`GeminiEmbeddingProvider` (`apps/api/src/services/ai/embeddings/gemini-embedding.provider.ts`):**
   - Uses `@google/genai` with `client.models.embedContent`.
   - Default model: `text-embedding-004` (768 dimensions).
   - Configurable via `GEMINI_EMBEDDING_MODEL` environment variable.
   - Enforces 15-second timeout and maps HTTP 429 quota exhaustion to `AIRateLimitError`.

2. **`MockEmbeddingProvider` (`apps/api/src/services/ai/embeddings/mock-embedding.provider.ts`):**
   - Deterministic 768-dimensional normalized L2 vector generator based on token/n-gram hashing.
   - Requires zero external network calls or credentials.
   - Enables offline testing, CI verification, and graceful fallback when `GEMINI_API_KEY` is omitted.

3. **`EmbeddingProviderFactory` (`apps/api/src/services/ai/embeddings/embedding-provider.factory.ts`):**
   - Dispatches `GeminiEmbeddingProvider` if `GEMINI_API_KEY` is set and provider is not forced to mock.
   - Falls back to `MockEmbeddingProvider` seamlessly.

---

## Code Chunking Engine (`CodeChunker`)

Located in `apps/api/src/services/retrieval/chunker.ts`:

- **Line-Aware Slicing:** Splits files into 50-line chunks with a 10-line sliding overlap, preserving line number references (`startLine`, `endLine`) for source navigation.
- **Safety Filters:**
  - Skips lockfiles (`pnpm-lock.yaml`, `package-lock.json`, etc.).
  - Skips minified, compiled, binary, asset, and font files.
  - Skips vendor directories (`node_modules`, `dist`, `build`, etc.).
- **Bounded Invariants:**
  - Max 256 KB per individual file.
  - Max 100 candidate files per repository snapshot.
  - Max 500 total chunks per repository snapshot.

---

## Dual-Mode Semantic Retrieval (`RetrievalService`)

Located in `apps/api/src/services/retrieval/retrieval.service.ts`:

1. **Native `pgvector` Mode:**
   - If PostgreSQL has the `vector` extension installed, queries execute using HNSW cosine distance (`<=>`) in SQL:
     ```sql
     SELECT ..., 1 - (embedding_vec <=> $vector::vector) as score
     FROM code_chunks
     WHERE analysis_id = $analysisId
     ORDER BY embedding_vec <=> $vector::vector ASC
     LIMIT $limit;
     ```
2. **Relational In-Memory Cosine Fallback:**
   - If the `vector` extension is not present (e.g. standard Alpine Postgres container), `RetrievalService` automatically reads JSON-serialized embeddings from `code_chunks.embedding` and computes exact vector cosine similarities in memory:
     $$\cos(\mathbf{q}, \mathbf{d}) = \frac{\mathbf{q} \cdot \mathbf{d}}{\|\mathbf{q}\| \|\mathbf{d}\|}$$
   - Zero crashes, zero database driver errors, and transparent `fallback: true` annotation in API responses.

---

## Semantic Retrieval Limitations & Operational Nuances

1. **Local Development Environment (`Relational Cosine Fallback`):**
   - The local PostgreSQL development container (`postgres:16-alpine`) does not have the `pgvector` extension enabled.
   - The UI correctly displays the status badge: `"Relational Cosine Fallback"`.
2. **Intentional Graceful-Degradation Path:**
   - The relational fallback is an intentional local development and graceful-degradation mechanism designed to keep ArchLens functional without native C extensions.
   - It must **not** be described or treated as computationally or architecturally equivalent to production `pgvector` retrieval with HNSW indexing.
3. **Deterministic Mock Embeddings:**
   - `MockEmbeddingProvider` is designed strictly for offline development, deterministic testing, and CI verification when `GEMINI_API_KEY` is omitted.
   - Its retrieval quality is **not** representative of production semantic-search quality.
4. **Known Retrieval-Quality Limitation:**
   - Under the mock/fallback path, low-confidence, broad, or unrelated queries may still return results from the indexed chunk set.
   - We make no claim of high semantic accuracy or perfect relevance under the mock embedding and relational fallback configuration.
5. **Production Evaluation Requirements:**
   - Evaluating production-grade retrieval quality requires a PostgreSQL database with native `pgvector` support (e.g., `pgvector/pgvector:pg16`) and real embeddings from `GeminiEmbeddingProvider` (`text-embedding-004`).
6. **Deterministic Baseline as Authoritative Source of Truth:**
   - Phase 2 repository analysis (manifests, trees, metrics, framework detection) remains the sole authoritative source of repository facts.
   - Semantic retrieval is an assistive context-augmentation mechanism, never the source of structural truth.
7. **EvidenceValidator Supremacy Over Retrieved Context:**
   - `EvidenceValidator` evaluates all claims and citations generated by the AI model.
   - Retrieved code snippets provide context, but any factual assertions derived from them must pass strict deterministic grounding against Phase 2 data before being delivered to the user.
8. **UI Controls vs. API Capabilities:**
   - The current web UI exposes natural language query input, quick example suggestions, category dropdown (`source`, `doc`, `config`), and result limit selector (`3`, `5`, `10`, `20`).
   - The REST API contract additionally supports `pathPrefix` filtering, but the current UI does **not** expose a dedicated Path Prefix input field.
9. **Zero Code Execution:**
   - Semantic search operates exclusively on static text slices and embeddings; ingested repository code is never executed, evaluated, or run in any runtime environment.
