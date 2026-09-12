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

## Phase 4: Semantic Repository Retrieval — Completed

- Line-aware chunking engine (`CodeChunker`): 50-line chunks, 10-line overlap, skips binary/vendor/lockfiles/minified files, strict caps (max 100 files, max 500 chunks, 256 KB file cap)
- Dual-mode vector persistence: PostgreSQL `code_chunks` table supporting native `pgvector` HNSW vector distance search with an automatic in-memory cosine fallback when the extension is unavailable
- Embedding provider abstraction (`IEmbeddingProvider`) in `apps/api`
- Google Gemini embedding provider (`GeminiEmbeddingProvider`) using `text-embedding-004` via `@google/genai` (15s timeout, rate limit mapping)
- Deterministic mock embedding provider (`MockEmbeddingProvider`) generating 768-dimensional normalized L2 vectors for 100% offline development and testing
- Embedding provider factory (`EmbeddingProviderFactory`) with automatic fallback when API keys are absent
- Retrieval Service (`RetrievalService`): Repository-scoped and analysis-scoped semantic indexing and search with metadata filtering (`pathPrefix`, `category`), score ranking, and execution timing
- AI Explanation enhancement: Semantic retrieval feeds relevant code slices into AI explanation prompts (`ContextBuilder`) inside delimiter-sanitized `<untrusted_content>` tags while preserving deterministic fact supremacy
- Evidence grounding: `EvidenceValidator` remains strictly authoritative over all retrieved context and AI claims
- Zero code execution: Repository code is never executed during semantic indexing or retrieval
- Fastify search route: `POST /api/repositories/:owner/:repo/search` with structured error handling and validation
- Interactive React UI: `SemanticSearchView` tab with query bar, example suggestions, category dropdown, limit selector, score badges, line ranges, and direct navigation to file contents
- Operational fallback path: Default local dev environment uses standard PostgreSQL with relational in-memory cosine fallback; production evaluation requires `pgvector`-enabled PostgreSQL and real Gemini embeddings

## Phase 5: Product Refinement & UI/UX Quality — Completed

- Reusable design token and UI primitive component system (`Button`, `Card`, `Badge`, `Input`, `Select`, `Skeleton`, `EmptyState`) in `apps/web/src/components/ui/` with zero external component library bloat
- Developer onboarding shell featuring a 3-pillar architectural overview for first-time visitors, system status indicators, and 5 curated quick presets (`fastify/fastify`, `facebook/react`, `gin-gonic/gin`, `tokio-rs/tokio`, `tiangolo/fastapi`)
- Refined deterministic Explorer: collapsible folder file tree with search filter and match counter, accessible modal landmark viewer with Escape-key / backdrop dismiss and clipboard copy feedback, stacked language composition bar with tooltips, and categorized tech stack grid with confidence and manifest evidence
- Grounded AI Insights refinement: prominent fact-supremacy disclaimer banner, 4 topic selector buttons with descriptions, target path input with Enter-key trigger, multi-card skeleton loaders, PostgreSQL cache hit badge vs freshly generated badge, and grounded evidence citations with direct landmark view links
- Semantic Search refinement: natural language query input with clear button, category filter dropdown, limit selector, snippet copy buttons, similarity score badges, and a collapsible disclosure drawer explaining the local "Relational Cosine Fallback" behavior
- Accessibility and responsive engineering: tested at 320px, 375px, 768px, 1024px, and 1440px viewports; full WAI-ARIA tab semantics (`role="tablist"`, `role="tab"`, `role="tabpanel"` with `tabIndex={0}`), focus visibility rings, `prefers-reduced-motion` compliance, and smooth horizontal tab scrolling with `scrollbar-none`
- Hardened analyzer entrypoint discovery: updated `TEST_PATTERNS` to include `fixtures/`, `__fixtures__/`, and `__mocks__/`, and updated `detectLandmark` to reject test fixtures from being detected as primary entrypoints or production landmarks, ensuring monorepos like `facebook/react` surface genuine package entrypoints (`packages/react/index.js`, etc.)

## Phase 6: Production Hardening, Deployment & Public Release — Planned

- Asynchronous task queues (Redis/BullMQ) for large analysis runs
- Response caching layer
- Public deployment configuration, telemetry, and rate limit defense

## Phase 7+: Future Clients — Planned

- Browser extension for inline GitHub repository exploration
- Cross-platform desktop client
