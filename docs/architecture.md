# Architecture

ArchLens is designed around a modular `pnpm` workspaces monorepo, enforcing strict boundary isolation between presentation, domain analysis, persistence, and shared validation contracts.

---

## Monorepo Structure & Boundaries

```
[apps/web] (React + Vite) ──┐
                            ├─► [@archlens/shared] (Zod Contracts & Domain Types)
[apps/api] (Fastify + ORM) ─┘
```

- **`apps/web`**: Lightweight client-side application.
  - Responsible for visualization, search, responsive layout, and document viewing.
  - Communicates with `apps/api` strictly through validated HTTP JSON contracts.
  - Contains zero backend secrets, database drivers, or direct GitHub API integrations.
- **`apps/api`**: Server-side engine and orchestration hub.
  - Ingests repository metadata and trees via bounded GitHub REST API calls.
  - Executes the deterministic analysis pipeline (categorization, manifests, tech stack, architecture, metrics).
  - Manages database persistence (PostgreSQL + Drizzle ORM).
  - Holds all environment secrets (`GITHUB_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`).
- **`packages/shared`**: Shared contract layer.
  - Canonical source of truth for Zod schemas (`RepoInputSchema`, `AnalysisResultSchema`, `LandmarkContentSchema`, `ExplainRequestSchema`, `ExplainResponseSchema`, `ApiErrorSchema`).
  - Inferred TypeScript domain types consumed identically by client and server.
  - Pure TypeScript with zero runtime overhead or dependencies beyond Zod.
- **`packages/tsconfig` & `packages/eslint-config`**: Shared build and linting foundations.

---

## Backend Subsystem Architecture (`apps/api`)

The backend is structured into decoupled, single-responsibility modules:

```
apps/api/src/
├── db/
│   ├── schema.ts          # Drizzle tables (repositories, analyses, ai_explanations, code_chunks, repository_executions)
│   ├── migrate.ts         # Dedicated Drizzle migration runner (pnpm db:migrate)
│   └── index.ts           # Connection pool configuration, checkDbConnection(), and pgvector detection
├── services/
│   ├── github.service.ts  # Bounded GitHub REST client & rate limit handling
│   ├── repository.service.ts # Ingestion orchestration & Postgres upserts
│   ├── analyzer/
│   │   ├── categorizer.ts # File categorization & landmark detection
│   │   ├── tech-stack.ts  # Manifest & tree-based tech stack detection
│   │   ├── architecture.ts# Monorepo & pattern detection
│   │   ├── metrics.ts     # Structural and language metrics
│   │   └── index.ts       # Orchestrator producing AnalysisResult
│   ├── ai/
│   │   ├── provider.interface.ts # IAIProvider & AIRateLimitError contracts
│   │   ├── provider.factory.ts   # Provider instantiation & fallback
│   │   ├── context-builder.ts    # Prompt construction & injection defense
│   │   ├── evidence-validator.ts # Deterministic citation validation
│   │   ├── ai.service.ts         # Orchestration & PostgreSQL caching
│   │   ├── embeddings/
│   │   │   ├── embedding.interface.ts # IEmbeddingProvider contract
│   │   │   ├── embedding-provider.factory.ts # Factory dispatch & fallback
│   │   │   ├── gemini-embedding.provider.ts # text-embedding-004
│   │   │   └── mock-embedding.provider.ts # Deterministic 768-dim L2 vector generator
│   │   └── providers/
│   │       ├── gemini.provider.ts# Google Gemini (@google/genai)
│   │       └── mock.provider.ts  # Deterministic offline heuristic
│   ├── retrieval/
│   │   ├── chunker.ts            # Line-aware code & doc chunking engine
│   │   └── retrieval.service.ts  # Dual-mode vector & relational search
│   └── sandbox/
│       ├── types.ts              # ISandboxRunner and execution options interfaces
│       ├── policy.ts             # Centralized sandbox limits, clampTimeout, SAFE_ENV
│       ├── output-collector.ts   # Bounded 64 KB stdout/stderr stream collector
│       ├── workspace-manager.ts  # Ephemeral /tmp workspace lifecycle & preview resolver
│       ├── eligibility.ts        # Execution eligibility & refusal taxonomy detector
│       ├── process-runner.ts     # ProcessSandboxRunner with process group SIGKILL
│       └── execution.service.ts  # Execution orchestration & DB logging
├── routes/
│   ├── repository.routes.ts # Analysis & landmark REST endpoints
│   ├── ai.routes.ts         # Grounded explanation endpoint (/explain)
│   ├── search.routes.ts     # Semantic repository search endpoint (/search)
│   └── execution.routes.ts  # Eligibility, execution, and sandboxed preview routes
└── server.ts              # App factory, CORS, and startup bootstrap
```

---

## Architectural Invariants

1. **No Blind Cloning:** Repositories are analyzed via bounded REST API ingestion of tree and manifest data. Full repository cloning is disabled by design.
2. **Deterministic Baseline:** All tech stack detections and metrics are calculated deterministically from verified source manifests and tree patterns.
3. **Idempotent Storage:** Repositories are keyed on `(owner, name)` with conflict-safe upserts, ensuring duplicate ingestion runs remain consistent.
4. **Isolated AI Layer (Phase 3 Complete):** The AI reasoning layer is strictly confined to `apps/api` behind the `IAIProvider` interface. AI consumes already-verified Phase 2 facts, validates every citation via `EvidenceValidator`, and caches results in PostgreSQL.
5. **Semantic Retrieval Augmentation (Phase 4 Complete):** Deterministic Phase 2 facts remain the sole authoritative source of truth. Vector similarity is used strictly for relevance ranking and localized context retrieval—never to invent or alter structural facts. `EvidenceValidator` remains authoritative over all retrieved context and AI claims. Ingested repository code is never executed. Search supports dual-mode persistence (`pgvector` HNSW with an automatic relational in-memory cosine fallback for local development).
6. **Product Refinement & Factual Integrity (Phase 5 Complete):** The web presentation layer enforces strict visual distinction between deterministic repository facts (Phase 2 manifests, metrics, file trees) and context-augmented AI reasoning (Phase 3 explanations, Phase 4 code slices). Hardened analyzer heuristics exclude test fixtures and mock directories from being detected as primary entrypoints or production landmarks. Transparent indicators inform users of operational retrieval modes ('Relational Cosine Fallback' vs 'pgvector HNSW Index'). All interactive components adhere to WAI-ARIA standards and responsive viewports (320px to 1440px).
7. **Client-Agnostic Sandboxed Execution (Phase 6 Complete):** Untrusted repository code evaluates exclusively inside ephemeral sandbox environments isolated from the host server. The child execution environment is stripped of all host environment variables and secrets (zero access to `GITHUB_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`). Workspaces are provisioned under `/tmp/archlens-sandboxes/<uuid>` with bounded limits (max 25 files, 500 KB per file, 2 MB total) and purged upon completion. Process group leaders terminate all spawned descendants on timeout (`process.kill(-pid, 'SIGKILL')`). Static HTML/CSS/JS previews are served with strict Content Security Policy (`default-src 'self'`) in sandboxed iframes with path traversal defense. The subsystem is 100% client-agnostic, consumable by Web, CLI, and future extensions.
8. **Deferred Clients (Phase 8+):** Browser extensions and VS Code extensions will act as consumers of the existing `apps/api` and `@archlens/shared` layers without backend architectural modifications.
9. **Decoupled Database Migrations (Phase 7):** Application startup does not perform schema-creation DDL or run migrations. Schema versioning is managed through formal, versioned Drizzle migrations (`apps/api/drizzle/`) executed via `pnpm --filter @archlens/api db:migrate` prior to release deployment. Startup performs fail-fast connectivity verification (`checkDbConnection()`) only.
