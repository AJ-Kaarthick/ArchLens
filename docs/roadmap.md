# Roadmap

ArchLens follows a staged, milestone-driven development roadmap. Each phase delivers a functional, testable milestone before expanding complexity.

## Phase 1: Foundation — Completed

- Monorepo tooling (`pnpm` workspaces)
- TypeScript strict configuration
- Shared contracts package (`@archlens/shared`) with Zod schemas
- ESLint and Prettier setup

## Phase 2: Repository Ingestion & Deterministic Analysis — Completed

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

## Phase 3: Grounded AI Explanation Layer & Caching — Completed

- Backend AI provider abstraction (`IAIProvider`) in `apps/api`
- Google Gemini implementation (`GeminiAIProvider`) using `@google/genai` (default: `gemini-2.0-flash`)
- Deterministic mock provider (`MockAIProvider`) with dynamic multi-language grounding for offline development and testing
- Provider factory (`AIProviderFactory`) with automatic fallback when API keys are absent
- Prompt-injection defense: bounded context (2,000 chars) and delimiter-sanitized `<untrusted_content>` wrapping via `ContextBuilder`
- Grounded explanation topics: Overview, Architecture & Patterns, Tech Stack Synergy, Runtime Entrypoints
- Deterministic post-validation (`EvidenceValidator`): Audits all AI-generated citations against verified Phase 2 facts to prevent hallucinated references
- Citation-backed evidence ties claims directly to real manifests, files, patterns, and metrics
- PostgreSQL explanation caching (`ai_explanations`) keyed on `(analysis_id, topic, COALESCE(target, ''))` for zero-token replay
- Fastify route: `POST /api/repositories/:owner/:repo/explain` with structured error handling and rate-limit recovery
- Interactive React UI: `AIInsightsView` tab with topic controls, executive summary, takeaways, and evidence badges

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
