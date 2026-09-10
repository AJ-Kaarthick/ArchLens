# Roadmap

ArchLens follows a staged, milestone-driven development roadmap. Each phase delivers a functional, testable milestone before expanding complexity.

## Phase 1: Foundation — Completed

- Monorepo tooling (`pnpm` workspaces)
- TypeScript strict configuration
- Shared contracts package (`@archlens/shared`) with Zod schemas
- ESLint and Prettier setup

## Phase 2: Repository Ingestion & Deterministic Analysis — Current / Completed

- Bounded GitHub REST API ingestion (recursive Git Trees, no cloning)
- 10,000-item tree bound and 256 KB landmark file size bound
- Rate-limit detection and user recovery guidance
- Deterministic file categorizer and landmark detector
- Manifest analysis for tech stack detection (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`)
- Monorepo and architectural pattern detection
- Structural metrics calculation (languages, file categories, file size distribution)
- PostgreSQL storage with Drizzle ORM and idempotent upserts on `(owner, name)`
- Synchronous REST API in Fastify
- Interactive React web explorer UI with real-time tree filter and safe `react-markdown` preview

## Phase 3: AI Provider Abstraction & Incremental Frontend — Planned

- Provider-agnostic AI interface (`IAIProvider`) in `apps/api`
- Implementations for Gemini, OpenAI, and Anthropic
- Grounded summaries generated strictly from deterministic Phase 2 analysis facts
- Streaming AI responses to the frontend client

## Phase 4: Advanced Semantic Retrieval — Planned

- Intelligent chunking for code and documentation
- Structured semantic retrieval and code search
- Evaluation of vector persistence (`pgvector`)

## Phase 5: Product Refinement & UI/UX Quality — Planned

- Architecture diagram visualizations
- Deep cross-file navigation and dependency visualization
- Polished responsive layouts and theme refinements

## Phase 6: Production Hardening, Deployment & Public Release — Planned

- Asynchronous task queues (Redis/BullMQ) for large analysis runs
- Response caching layer
- Public deployment configuration, telemetry, and rate limit defense

## Phase 7+: Future Clients — Planned

- Browser extension for inline GitHub repository exploration
- Cross-platform desktop client
