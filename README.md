# ArchLens

> **Instant, deterministic architectural comprehension for GitHub repositories.**

ArchLens is an open-source platform that enables developers, contributors, and technical teams to explore and understand GitHub codebases quickly—without cloning, installing language runtimes, or manually configuring local environments.

---

## Project Status

**Current Status:** Phase 2 Complete (Deterministic Ingestion & Architecture Analysis).

ArchLens currently features a fully functional, deterministic analysis engine and React explorer. AI-assisted capabilities, semantic search, and embeddings are planned for Phase 3+ and are **not** present in the current codebase.

---

## The Problem ArchLens Solves

Gaining a quick, accurate mental model of a new or unfamiliar repository is traditionally painful:

- **Blind cloning overhead:** Downloading multi-gigabyte git histories just to inspect architecture or manifests.
- **Environment friction:** Requiring specific language toolchains, SDK versions, or container daemons just to evaluate a project.
- **AI hallucination risks:** Off-the-shelf LLMs routinely guess project dependencies, hallucinate outdated patterns, and misstate repository structures when ungrounded.

ArchLens solves this by establishing a **factual, deterministic baseline** first. It analyzes the actual repository tree, parses package manifests, extracts framework versions, detects monorepo layouts, categorizes file types, and calculates exact language metrics before any secondary reasoning occurs.

---

## What Works Today (Phase 1 & Phase 2)

- **Bounded GitHub Ingestion:** Fetches repository metadata and recursive file trees via the GitHub REST API v3 without git cloning.
- **Safety Bounds:** Enforces a strict 10,000-item tree bound and a 256 KB landmark file preview bound to prevent denial-of-service and memory exhaustion.
- **Rate-Limit Resilience:** Transparently detects GitHub API 403/429 limits, calculates exact reset timestamps from response headers, and returns structured recovery instructions.
- **Deterministic Tech Stack Detection:** Accurately extracts dependencies, build systems, styling engines, test runners, and database libraries from manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.) with confidence levels and source evidence.
- **Architecture Pattern Detection:** Automatically identifies monorepo tools (`pnpm`, `Turborepo`, `Nx`, `Lerna`), workspace packages, client-server separation, layered service directories, and primary entrypoints.
- **Structural Metrics:** Computes language breakdowns, file category distributions, total bytes, and identifies top 10 largest files.
- **PostgreSQL + Drizzle Persistence:** Stores repositories and historical analysis runs with an idempotent schema and conflict-safe upserts on `(owner, name)`.
- **Fastify REST API:** Synchronous endpoints for on-demand analysis, cached analysis retrieval, and bounded landmark file fetching.
- **React Web Explorer:** Modern UI built with Tailwind CSS, Lucide icons, interactive collapsible file tree with real-time filtering, metric progress bars, and safe `react-markdown` document previewing.

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

| Layer                      | Technologies                                                   |
| -------------------------- | -------------------------------------------------------------- |
| **Frontend**               | React 18, Vite 4, Tailwind CSS, Lucide React, `react-markdown` |
| **Backend**                | Node.js 20+, Fastify 4, `@fastify/cors`, `postgres.js`         |
| **Database & ORM**         | PostgreSQL 16, Drizzle ORM, Drizzle Kit                        |
| **Contracts & Validation** | Zod 3, TypeScript 5 (Strict Mode, ESM)                         |
| **Workspace & Tooling**    | `pnpm` workspaces, Vitest, ESLint, Prettier                    |

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

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0` (`corepack enable` recommended)
- **PostgreSQL**: `>= 15` (Docker recommended)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/AJ-Kaarthick/ArchLens.git
cd ArchLens
pnpm install
```

### 2. Start PostgreSQL

Using Docker:

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  postgres:16-alpine
```

### 3. Configure Environment Variables

The backend accepts the following optional environment variables:

| Variable       | Description                                                                                                   | Default                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL` | PostgreSQL connection string                                                                                  | `postgres://postgres:postgres@localhost:5432/archlens` |
| `GITHUB_TOKEN` | Optional GitHub Personal Access Token (server-side only) to increase REST rate limits from 60 to 5,000 req/hr | _None_                                                 |
| `PORT`         | API server port                                                                                               | `3000`                                                 |
| `HOST`         | API server host interface                                                                                     | `0.0.0.0`                                              |

> [!NOTE]
> `GITHUB_TOKEN` is strictly consumed server-side inside `apps/api`. It is never bundled, passed, or exposed to `apps/web` or `packages/shared`.

### 4. Build Workspace Packages

```bash
pnpm -r run build
```

### 5. Run in Development Mode

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

### `GET /health`

Liveness check returning service status and shared contract version.

---

## Current Limits & Bounds

- **Tree Size Bound:** Max 10,000 items. Repositories exceeding this bound or returning a truncated tree are rejected to prevent memory pressure.
- **Landmark File Size Bound:** Max 256 KB. Files larger than 256 KB have their content truncated in previews.
- **Execution Model:** Synchronous REST execution. Asynchronous queue workers (BullMQ/Redis) are planned for Phase 6.

---

## Roadmap

- **[x] Phase 1:** Monorepo Foundation, shared Zod contracts, strict tooling.
- **[x] Phase 2:** Bounded GitHub REST ingestion, deterministic analysis, PostgreSQL persistence, React web explorer.
- **[ ] Phase 3:** _Planned_ — Provider-agnostic AI abstraction (Gemini, OpenAI, Anthropic), incremental UI.
- **[ ] Phase 4:** _Planned_ — Advanced semantic retrieval and structured code intelligence.
- **[ ] Phase 5:** _Planned_ — Product refinement, UX polish, and deep visualization.
- **[ ] Phase 6:** _Planned_ — Production hardening, caching, queue workers, and public deployment.
- **[ ] Phase 7+:** _Planned_ — Browser extensions and companion desktop applications.

---

## Security

- **No Secret Leakage:** GitHub credentials are never forwarded to the client or embedded in client bundles.
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
