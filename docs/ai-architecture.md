# AI Architecture

> [!IMPORTANT]
> **Current Status (Phase 2):** There is **no AI functionality, AI SDK, embedding pipeline, or model integration** in ArchLens today. The entire Phase 2 ingestion and analysis engine is 100% deterministic. This document defines the design and constraints for **Phase 3 (Planned)**.

---

## Core Philosophy for Phase 3

When AI capabilities are introduced in Phase 3, they will follow three foundational principles:

1. **Grounded in Deterministic Facts:** AI generation must never guess repository dependencies or structure. Prompts will strictly inject facts already verified by Phase 2 (parsed manifests, verified tech stack detections, architectural patterns, file metrics).
2. **Provider Agnostic:** Users and self-hosters must not be locked into a single AI provider. ArchLens will abstract model interactions through a clean interface.
3. **Zero Client-Side Secrets:** All AI orchestration, provider SDKs, and API credentials will reside exclusively in `apps/api`. `apps/web` will only consume processed responses or streams.

---

## Planned Architecture

```
[apps/web] (React)
       │
       ▼ (REST / Server-Sent Events)
[apps/api] (Fastify)
       │
       ▼
[AI Orchestrator] ── Reads ──► [PostgreSQL Analysis Records] (Phase 2 Facts)
       │
       ▼
[IAIProvider Interface]
       ├─► GeminiProvider   (Google GenAI / Vertex)
       ├─► OpenAIProvider   (GPT-4o / GPT-4o-mini)
       └─► AnthropicProvider(Claude 3.5 Sonnet)
```

---

## Planned Interface (`IAIProvider`)

Phase 3 will define a standardized provider interface in `apps/api`:

```typescript
export interface IAIProvider {
  readonly providerName: string;

  generateSummary(context: AnalysisResult): Promise<string>;
  streamExplanation(context: AnalysisResult, prompt: string): AsyncIterable<string>;
}
```

---

## Prompt Design & Grounding Pipeline

Instead of asking an LLM to "explain this repository" blindly:

1. ArchLens loads the deterministic `AnalysisResult` (monorepo status, entrypoints, top dependencies, language metrics).
2. ArchLens selects relevant landmark documents (e.g. `README.md`, key architecture guides).
3. A structured system prompt provides these facts as immutable context.
4. The model produces an architectural walkthrough that is verifiable against the repository's real files.

---

## Phasing & Evolution

| Phase           | Milestone                         | Scope                                                                               |
| --------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| **Phase 1 & 2** | Foundation & Deterministic Engine | **Current** — Zero AI, zero vendor SDKs.                                            |
| **Phase 3**     | AI Provider Abstraction           | **Planned** — `IAIProvider`, Gemini/OpenAI/Anthropic adapters, streaming summaries. |
| **Phase 4**     | Semantic Retrieval                | **Planned** — Code chunking, semantic search, evaluation of `pgvector`.             |
