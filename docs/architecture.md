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
  - Holds all environment secrets (`GITHUB_TOKEN`, `DATABASE_URL`).
- **`packages/shared`**: Shared contract layer.
  - Canonical source of truth for Zod schemas (`RepoInputSchema`, `AnalysisResultSchema`, `LandmarkContentSchema`, `ApiErrorSchema`).
  - Inferred TypeScript domain types consumed identically by client and server.
  - Pure TypeScript with zero runtime overhead or dependencies beyond Zod.
- **`packages/tsconfig` & `packages/eslint-config`**: Shared build and linting foundations.

---

## Backend Subsystem Architecture (`apps/api`)

The backend is structured into decoupled, single-responsibility modules:

```
apps/api/src/
├── db/
│   ├── schema.ts          # Drizzle tables (repositories, analyses)
│   └── index.ts           # Postgres connection & idempotent initDb()
├── services/
│   ├── github.service.ts  # Bounded GitHub REST client & rate limit handling
│   ├── repository.service.ts # Ingestion orchestration & Postgres upserts
│   └── analyzer/
│       ├── categorizer.ts # File categorization & landmark detection
│       ├── tech-stack.ts  # Manifest & tree-based tech stack detection
│       ├── architecture.ts# Monorepo & pattern detection
│       ├── metrics.ts     # Structural and language metrics
│       └── index.ts       # Orchestrator producing AnalysisResult
├── routes/
│   └── repository.routes.ts # Fastify REST endpoints
└── server.ts              # App factory, CORS, and startup bootstrap
```

---

## Architectural Invariants

1. **No Blind Cloning:** Repositories are analyzed via bounded REST API ingestion of tree and manifest data. Full repository cloning is disabled by design.
2. **Deterministic Baseline:** All tech stack detections and metrics are calculated deterministically from verified source manifests and tree patterns.
3. **Idempotent Storage:** Repositories are keyed on `(owner, name)` with conflict-safe upserts, ensuring duplicate ingestion runs remain consistent.
4. **Isolated AI Layer (Phase 3):** When AI features are added in Phase 3, they will be confined to `apps/api` behind an `IAIProvider` interface, consuming already-verified Phase 2 analysis facts.
5. **Deferred Clients (Phase 7+):** Browser extensions and desktop clients will act as consumers of the existing `apps/api` and `@archlens/shared` layers without backend architectural modifications.
