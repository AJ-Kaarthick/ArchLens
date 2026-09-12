# ArchLens

> **Instant, deterministic architectural comprehension for GitHub repositories.**

ArchLens is an open-source platform that enables developers, contributors, and technical teams to explore and understand GitHub codebases quickly—without cloning, installing language runtimes, or manually configuring local environments.

---

## Project Status

**Current Status:** Phase 6 Complete (Client-Agnostic Sandboxed Repository Execution & Live Preview Subsystem).

ArchLens features a fully functional, deterministic repository analysis engine, paired with a grounded AI reasoning layer, intelligent code chunking with dual-mode vector search (PostgreSQL `pgvector` with relational cosine fallback), a refined, accessible React developer explorer, and a secure, client-agnostic sandboxed execution and live preview subsystem.

---

## The Problem ArchLens Solves

Gaining a quick, accurate mental model of a new or unfamiliar repository is traditionally painful:

- **Blind cloning overhead:** Downloading multi-gigabyte git histories just to inspect architecture or manifests.
- **Environment friction:** Requiring specific language toolchains, SDK versions, or container daemons just to evaluate a project.
- **AI hallucination risks:** Off-the-shelf LLMs routinely guess project dependencies, hallucinate outdated patterns, and misstate repository structures when ungrounded.

ArchLens solves this by establishing a **factual, deterministic baseline** first. It analyzes the actual repository tree, parses package manifests, extracts framework versions, detects monorepo layouts, categorizes file types, and calculates exact language metrics before any AI reasoning occurs. AI reasoning is strictly constrained to explaining verified facts with verifiable evidence citations. Semantic retrieval augments reasoning by locating relevant code slices without altering structural facts. For eligible repositories, sandboxed execution safely evaluates entrypoints without host compromise.

---

## What Works Today (Phase 1 through Phase 6)

- **Bounded GitHub Ingestion:** Fetches repository metadata and recursive file trees via the GitHub REST API v3 without git cloning.
- **Safety Bounds:** Enforces a strict 10,000-item tree bound, 256 KB landmark file preview bound, max 100 files, and max 500 code chunks per repository.
- **Rate-Limit Resilience:** Transparently detects GitHub API 403/429 limits, calculates exact reset timestamps from response headers, and returns structured recovery instructions.
- **Deterministic Tech Stack Detection:** Accurately extracts dependencies, build systems, styling engines, test runners, and database libraries from manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.) with confidence levels and source evidence.
- **Architecture Pattern Detection:** Automatically identifies monorepo tools (`pnpm`, `Turborepo`, `Nx`, `Lerna`), workspace packages, client-server separation, layered service directories, and primary entrypoints.
- **Hardened Entrypoint & Landmark Detection:** Explicitly excludes test fixtures, mocks, and test directories (`fixtures/`, `__fixtures__/`, `__mocks__/`, `tests/`) from being classified as primary entrypoints or production landmarks, ensuring monorepos like `facebook/react` accurately surface real package entrypoints (`packages/react/index.js`, etc.).
- **Structural Metrics:** Computes language breakdowns, file category distributions, total bytes, and identifies top 10 largest files.
- **Semantic Code Retrieval & Search:** Line-aware chunking engine (50 lines per chunk, 10-line overlap) for source, doc, and config files with metadata filtering (category and limit in the UI; pathPrefix at the API level), similarity score ranking, and execution timing—operating purely on indexed text slices without executing repository code.
- **Dual-Mode Vector Persistence:** PostgreSQL `code_chunks` table supporting native `pgvector` (HNSW cosine distance) when the extension is available, with an automatic, zero-crash relational and in-memory cosine similarity fallback.
- **Embedding Provider Abstraction:** Flexible backend interface (`IEmbeddingProvider`) supporting Google Gemini (`text-embedding-004` via `@google/genai`) and a deterministic `MockEmbeddingProvider` for 100% offline development and testing without API keys.
- **Grounded AI Explanation Layer:** Generates fact-backed architectural explanations across four distinct topics: Repository Overview, Architecture & Patterns, Tech Stack Synergy, and Runtime Entrypoints, augmented by relevant semantic code slices. `EvidenceValidator` remains strictly authoritative over all retrieved context and generated claims.
- **Evidence Citations:** Every AI explanation includes verifiable citations pointing directly to real manifests, landmark files, dependencies, entrypoints, and structural metrics with one-click modal previews.
- **Prompt-Injection Defense:** Untrusted repository content (README, description, and retrieved code chunks) is bounded, sanitized, and isolated inside `<untrusted_content>` tags, preventing malicious repository instructions from subverting AI reasoning.
- **AI Provider Abstraction:** Backend interface (`IAIProvider`) supporting Google Gemini (`gemini-2.0-flash`) and a deterministic `MockAIProvider`.
- **PostgreSQL Explanation Caching:** Explanations are cached in `ai_explanations` keyed on `(analysis_id, topic, target)` for instant, zero-token replay with transparent cache hit indicators.
- **Client-Agnostic Sandboxed Execution:** Reusable backend execution engine in `apps/api` and contracts in `packages/shared`, consumable identically by ArchLens Web, future VS Code extensions, and future browser extensions.
- **Initial Hardened Profiles:** Pluggable execution currently supporting `node-script` (standalone JavaScript/Node scripts) and `static-web` (HTML/CSS/JS frontend preview).
- **Zero Host Secret Leakage:** Child execution runs in a stripped, sanitized environment (`SAFE_ENV`: `PATH`, `NODE_ENV=production`, `HOME=/tmp`) that completely excludes all host credentials (`GITHUB_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`).
- **Process Group Termination & Hard Timeouts:** Spawns detached process groups; timeouts (max 10s) trigger full process tree termination via `process.kill(-child.pid, 'SIGKILL')`.
- **Bounded Output Buffering:** Standard output and standard error streams are collected up to a hard 64 KB limit with clear truncation notices (`OutputCollector`).
- **Ephemeral Workspaces & Filesystem Confinement:** Workspaces are generated under `/tmp/archlens-sandboxes/<uuid>` with restrictive `0o700`/`0o600` permissions and limits (max 25 files, max 500 KB per file, max 2 MB total), purged immediately after node execution.
- **Isolated Static Web Live Previews:** Serves static web previews with strict Content Security Policy (`default-src 'self'`), MIME type resolution, path traversal defense, and isolated iframe sandboxing.
- **Structured Refusal Taxonomy:** Deny-by-default execution policy that safely refuses unsupported languages (Python, Go, Rust, Java, etc.) or missing entrypoints with structured refusal reasons (`unsupported_runtime`, `missing_entrypoint`, etc.).
- **Execution History Logging:** PostgreSQL `repository_executions` logs execution ID, profile, status, exit code, duration, refusal reasons, and timestamps.
- **Fastify REST API:** Synchronous endpoints for analysis (`POST /api/analyze`), latest snapshot (`GET /api/repositories/:owner/:repo/latest`), landmark previews (`GET /api/repositories/:owner/:repo/landmark-content`), AI explanations (`POST /api/repositories/:owner/:repo/explain`), semantic search (`POST /api/repositories/:owner/:repo/search`), execution eligibility (`GET /api/repositories/:owner/:repo/eligibility`), execution (`POST /api/repositories/:owner/:repo/execute`), and live preview (`GET /api/preview/:executionId/*`).
- **Reusable UI Component System:** Clean, zero-dependency design primitives (`Button`, `Card`, `Badge`, `Input`, `Select`, `Skeleton`, `EmptyState`) built directly with Tailwind CSS and Lucide React.
- **Polished Developer Experience & Onboarding:** Persistent application shell, 3-pillar architectural onboarding guide for new visitors, and one-click quick presets (`fastify/fastify`, `facebook/react`, `gin-gonic/gin`, `tokio-rs/tokio`, `tiangolo/fastapi`).
- **Interactive Web Runner UI:** `Run & Preview` tab with real-time eligibility evaluation, profile selector, entrypoint dropdown, argument input, timeout selector, execution metadata bar, dark monospace console output, and responsive live iframe preview.
- **Refined Explorer Views:** Collapsible folder file tree with search filtering, accessible modal landmark viewer with background backdrop click and Escape-key dismiss, stacked language composition bar with tooltips, and categorized tech stack cards.
- **Semantic Search Polish & Transparency:** Query clear button, category filter dropdown, limit selector, snippet copy buttons, similarity score badges, and a collapsible disclosure drawer explaining the local "Relational Cosine Fallback" mode.
- **Accessible & Responsive Architecture:** Full WAI-ARIA tab semantics (`role="tablist"`, `role="tab"`, `role="tabpanel"`), visible focus rings, `prefers-reduced-motion` compliance, and smooth horizontal tab scrolling verified across mobile, tablet, and desktop viewports.

---

## Architecture Overview

ArchLens is built as a TypeScript monorepo managed with `pnpm` workspaces:

```
ArchLens/
├── apps/
│   ├── api/          # Fastify backend service, Drizzle ORM, GitHub ingestion & analyzer
│   └── web/          # React 18 + Vite frontend explorer UI with Tailwind CSS
├── packages/
│   ├── shared/       # Zod contracts, schemas, and shared TypeScript domain types
│   ├── tsconfig/     # Base TypeScript compiler configuration
│   └── eslint-config/# Shared ESLint and Prettier rules
└── docs/             # Technical specifications, roadmap, and design docs
```

### Ingestion & Analysis Pipeline

```
GitHub Repository URL
       │
       ▼
[GitHub REST API] ──(Bounded Tree & Manifests)──► [Deterministic Analyzer]
                                                          │
       ┌──────────────────────────────────────────────────┴───────────────────────┐
       ▼                                                  ▼                       ▼
Categorization & Landmarks                         Tech Stack Detection            Metrics & Architecture
(source, test, config, etc.)                       (manifests & tree patterns)    (languages, patterns, monorepo)
       │                                                  │                       │
       └──────────────────────────────────────────────────┬───────────────────────┘
                                                          ▼
                                              [Analysis Result Payload]
                                                          │
                                     ┌────────────────────┴───────────────────┐
                                     ▼                                        ▼
                             [PostgreSQL DB]                          [React Web Client]
                       (Idempotent Upsert & History)             (Live Exploration & Markdown)
```

---

## Tech Stack

| Layer                      | Technologies                                                                      |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Frontend**               | React 18, Vite 4, Tailwind CSS, Lucide React, `react-markdown`                    |
| **Backend**                | Node.js 20+, Fastify 4, `@fastify/cors`, `postgres.js`                            |
| **Database & Vector**      | PostgreSQL 16 (`pgvector` + relational cosine fallback), Drizzle ORM, Drizzle Kit |
| **Embeddings & AI**        | `@google/genai` (`text-embedding-004`, `gemini-2.0-flash`), Mock Providers        |
| **Contracts & Validation** | Zod 3, TypeScript 5 (Strict Mode, ESM)                                            |
| **Workspace & Tooling**    | `pnpm` workspaces, Vitest, ESLint, Prettier                                       |

---

## Supported Analysis Capabilities (Current)

- **Manifest Parsing:**
  - JavaScript/TypeScript: `package.json` (dependencies, devDependencies, workspaces)
  - Rust: `Cargo.toml` (crates, runtimes, web frameworks)
  - Go: `go.mod` (modules, frameworks, ORMs)
  - Python: `pyproject.toml`, `requirements.txt`
- **File Categorization:** Automated classification into `source`, `test`, `config`, `doc`, `asset`, `ci`, and `other`.
- **Landmark Recognition:** Identifies project documentation (`README.md`, `LICENSE`), configuration manifests, and primary entrypoints (`src/index.ts`, `main.go`, `server.ts`, `App.tsx`, etc.).
- **Monorepo Detection:** `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, and npm/yarn workspaces.
- **Semantic Code Search:** Line-aware chunk indexing with cosine similarity ranking, pathPrefix, and category filtering.

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0` (`corepack enable` recommended)
- **PostgreSQL**: `>= 15` (Docker recommended; `pgvector/pgvector:pg16` for native vector search)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/AJ-Kaarthick/ArchLens.git
cd ArchLens
pnpm install
```

### 2. Start PostgreSQL

Using Docker (Standard PostgreSQL with relational fallback):

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  postgres:16-alpine
```

_Or with native `pgvector` support:_

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

### 3. Configure Environment Variables

For local development, create your local environment file:

```bash
cp apps/api/.env.example apps/api/.env
```

ArchLens automatically loads `apps/api/.env` at backend startup. In production or containerized environments, system environment variables take precedence.

The backend accepts the following optional environment variables:

| Variable                 | Description                                                                                                   | Default                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`           | PostgreSQL connection string                                                                                  | `postgres://postgres:postgres@localhost:5432/archlens` |
| `GITHUB_TOKEN`           | Optional GitHub Personal Access Token (server-side only) to increase REST rate limits from 60 to 5,000 req/hr | _None_                                                 |
| `GEMINI_API_KEY`         | Optional Google Gemini API key (server-side only). When omitted, ArchLens uses Mock providers gracefully      | _None_                                                 |
| `AI_PROVIDER`            | AI explanation provider override (`gemini` or `mock`). Defaults to `gemini` if API key set, else `mock`       | `gemini` (if key set) / `mock`                         |
| `GEMINI_MODEL`           | Gemini generation model name                                                                                  | `gemini-2.0-flash`                                     |
| `EMBEDDING_PROVIDER`     | Embedding provider override (`gemini` or `mock`). Defaults to `gemini` if API key set, else `mock`            | `gemini` (if key set) / `mock`                         |
| `GEMINI_EMBEDDING_MODEL` | Gemini text embedding model name                                                                              | `text-embedding-004`                                   |
| `PORT`                   | API server port                                                                                               | `3000`                                                 |
| `HOST`                   | API server host interface                                                                                     | `0.0.0.0`                                              |

> [!NOTE]
> `GITHUB_TOKEN` and `GEMINI_API_KEY` are strictly consumed server-side inside `apps/api`. They are never bundled, passed, or exposed to `apps/web` or `packages/shared`. When `GEMINI_API_KEY` is omitted, ArchLens runs 100% offline with `MockAIProvider` and `MockEmbeddingProvider`.

### 4. Run Database Migrations

Apply versioned Drizzle migrations to initialize or update PostgreSQL:

```bash
pnpm --filter @archlens/api db:migrate
```

### 5. Build Workspace Packages

```bash
pnpm -r run build
```

### 6. Run in Development Mode

Run all services concurrently:

```bash
pnpm -r run dev
```

Or run individual apps:

```bash
# Terminal 1: Start API server (port 3000)
pnpm --filter @archlens/api dev

# Terminal 2: Start Web UI (port 5173, proxies /api to port 3000)
pnpm --filter @archlens/web dev
```

Visit **`http://localhost:5173`** in your browser.

---

## Verification & Code Quality

Run tests, typechecks, and code styling across all workspace packages:

```bash
# Run unit & integration tests (offline fixtures + DB tests)
pnpm -r run test

# Run TypeScript typechecks
pnpm -r run typecheck

# Run ESLint across packages
pnpm -r run lint

# Format code with Prettier
pnpm run format
```

---

## REST API Overview

All payloads and responses are validated via Zod contracts defined in `@archlens/shared`.

### `POST /api/analyze`

Synchronously ingests and analyzes a repository.

- **Payload:** `{ "url": "owner/repo" }` or `{ "url": "https://github.com/owner/repo" }`
- **Response (200):** `AnalysisResult` (metadata, tech stack, architecture, metrics, file tree)
- **Error (429):** Structured `ApiError` with rate limit reset timestamp and actionable tip.
- **Error (404):** Repository not found or private.
- **Error (400):** Repository tree exceeds 10,000 files, or invalid input.

### `GET /api/repository/latest-analysis`

Retrieves the most recent analysis record.

- **Query Parameters:** `?owner=:owner&repo=:repo` or `?url=:url`
- **Response (200):** `AnalysisResult`
- **Error (404):** No analysis found.

### `GET /api/repositories/:owner/:repo/latest`

Path-parameter variant of latest analysis retrieval.

### `GET /api/repositories/:owner/:repo/landmark-content`

Safely reads bounded content for a specific repository file (e.g. `README.md`).

- **Query Parameters:** `?path=:filePath&ref=:branchOrSha`
- **Response (200):** `{ path, name, size, content, encoding, isTruncated }`
- **Security:** Directory traversal (`..`) is strictly blocked.

### `POST /api/repositories/:owner/:repo/explain`

Generates or retrieves a cached grounded AI explanation for an analyzed repository.

- **Payload:** `{ "topic": "overview" | "architecture" | "tech-stack" | "entrypoints", "target": "optional/target/path" }`
- **Response (200):** `ExplainResponse` (summary, markdown explanation, key takeaways, grounded evidence citations, cache status)
- **Caching:** Automatically cached in PostgreSQL; repeated requests return immediately at zero token cost.

### `POST /api/repositories/:owner/:repo/search`

Executes semantic search over repository code chunks with vector or cosine similarity ranking.

- **Payload:**
  ```json
  {
    "query": "postgres connection pool drizzle",
    "limit": 5,
    "pathPrefix": "apps/api",
    "category": "source"
  }
  ```
- **Response (200):** `SearchResponse`
  ```json
  {
    "query": "postgres connection pool drizzle",
    "results": [
      {
        "filePath": "apps/api/src/db/index.ts",
        "chunkIndex": 0,
        "startLine": 1,
        "endLine": 15,
        "content": "...",
        "score": 0.8421,
        "language": "ts",
        "category": "source"
      }
    ],
    "totalMatches": 1,
    "durationMs": 18,
    "fallback": false
  }
  ```
- **Dual-Mode:** Returns native `pgvector` HNSW distance when available, or relational in-memory cosine ranking fallback transparently.
- **UI vs. API Capabilities:** The REST API supports `pathPrefix` filtering (e.g. `apps/api`), whereas the current web UI provides query input, category filtering (`source`, `doc`, `config`), and result limit controls (`3`, `5`, `10`, `20`).

### `GET /health`

Liveness check returning service status and shared contract version.

---

## Current Limits & Bounds

- **Tree Size Bound:** Max 10,000 items. Repositories exceeding this bound or returning a truncated tree are rejected to prevent memory pressure.
- **Landmark File Size Bound:** Max 256 KB. Files larger than 256 KB have their content truncated in previews.
- **Chunking Bounds:** Max 100 candidate files and max 500 chunks per repository snapshot. Chunks are 50 lines with 10-line overlap.
- **Execution Model:** Synchronous REST execution. Asynchronous queue workers (BullMQ/Redis) are planned for Phase 6.

### Semantic Retrieval & Operational Limitations

1. **Local Development Environment (`Relational Cosine Fallback`):** The default local Docker development environment (`postgres:16-alpine`) does not have the `pgvector` extension compiled or enabled. As designed, ArchLens automatically activates the relational in-memory cosine fallback, and the web UI displays the status badge **"Relational Cosine Fallback"**.
2. **Intentional Graceful Degradation:** The relational fallback is an intentional development and graceful-degradation mechanism. It must **not** be characterized as computationally or architecturally equivalent to production `pgvector` retrieval with HNSW indexing.
3. **Deterministic Mock Embeddings:** In offline development, automated CI suites, or when `GEMINI_API_KEY` is omitted, ArchLens uses `MockEmbeddingProvider`. This provider produces deterministic 768-dimensional normalized vectors via token and n-gram hashing. Its retrieval quality is **not** representative of production semantic-search quality.
4. **Known Retrieval-Quality Limitation:** Under the mock embedding provider and relational cosine fallback, low-confidence, broad, or unrelated search queries may still return results from the indexed chunk set. We make no claim of high semantic accuracy or deep language comprehension under the mock/fallback configuration.
5. **Production Evaluation Requirement:** Rigorous semantic retrieval quality evaluation requires running a PostgreSQL instance with native `pgvector` (e.g., `pgvector/pgvector:pg16`) and configuring a real embedding model (`GEMINI_API_KEY` with `text-embedding-004`).
6. **Deterministic Baseline Remains Source of Truth:** Phase 2 deterministic analysis (package manifests, verified git trees, entrypoints, and metrics) remains the sole authoritative source of repository facts. Semantic retrieval serves strictly as a relevance and context-augmentation mechanism—never as a source of truth.
7. **Evidence Grounding Authority:** `EvidenceValidator` remains strictly authoritative over retrieved context; citations must pass Phase 2 grounding checks before persistence or client presentation.
8. **UI Filtering Controls:** The web UI currently exposes category filtering and result-limit controls. It does **not** expose a dedicated Path Prefix input, even though `pathPrefix` is supported by the backend API.
9. **Zero Code Execution:** Repository code is never executed during semantic indexing or retrieval; chunking and vector indexing operate purely on static text slices.

---

## Roadmap

- **[x] Phase 1:** Monorepo Foundation, shared Zod contracts, strict tooling.
- **[x] Phase 2:** Bounded GitHub REST ingestion, deterministic analysis, PostgreSQL persistence, React web explorer.
- **[x] Phase 3:** Grounded AI repository understanding, provider abstraction (Gemini & Mock), deterministic evidence validation, PostgreSQL caching, and interactive AI Insights UI.
- **[x] Phase 4:** Semantic Repository Retrieval (intelligent line-aware chunking, dual-mode pgvector + relational fallback, embeddings, search API & UI).
- **[ ] Phase 5:** _Planned_ — Product refinement, UX polish, and deep visualization.
- **[ ] Phase 6:** _Planned_ — Production hardening, caching, queue workers, and public deployment.
- **[ ] Phase 7+:** _Planned_ — Browser extensions and companion desktop applications.

---

## Security

- **No Secret Leakage:** GitHub credentials (`GITHUB_TOKEN`) and AI provider keys (`GEMINI_API_KEY`) are strictly loaded server-side in `apps/api` and are never forwarded to the client or embedded in client bundles.
- **Prompt-Injection Defense:** Untrusted repository content (README and description) is bounded to 2,000 characters, stripped of delimiter tags (`</?untrusted_content[^>]*>`), and isolated inside `<untrusted_content>` tags with strict system instructions prohibiting execution of untrusted instructions.
- **Deterministic Evidence Validation:** All AI-generated citations are audited post-generation against verified Phase 2 analysis facts by `EvidenceValidator` before persistence or client delivery.
- **Input Sanitization:** URL parsing and path parameters are validated via Zod schemas and normalized to prevent path traversal (`../`) attacks.
- **Sanitized Document Rendering:** Markdown files (`README.md`, docs) are rendered safely using React Markdown without executing embedded scripts.

---

## Contributing

Contributions are welcome! Please follow these standards:

1. Ensure all new code adheres to TypeScript strict typing.
2. Run `pnpm -r run lint` and `pnpm -r run typecheck`.
3. Add offline unit tests for new analyzer detection heuristics.
4. Format code using `pnpm run format`.

---

## License

This project is licensed under the [MIT License](LICENSE).
