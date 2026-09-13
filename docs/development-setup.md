# Development Setup

This guide walks through setting up the ArchLens monorepo locally.

---

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0` (Enable via `corepack enable` if needed)
- **PostgreSQL**: `>= 15` (Docker recommended)

---

## 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

---

## 2. Start PostgreSQL

Run a local PostgreSQL container:

**Option A: Standard PostgreSQL (Relational Cosine Fallback)**

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  postgres:16-alpine
```

**Option B: PostgreSQL with `pgvector` (Native HNSW Vector Search)**

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Verify readiness:

```bash
docker exec archlens-postgres pg_isready -U postgres
```

> [!IMPORTANT]
> **Local Development Fallback & Mock Embedding Notes:**
>
> - **Active Fallback Mode:** By default, the standard local Docker container (Option A) does not have the `pgvector` extension compiled or enabled. ArchLens will automatically activate the relational in-memory cosine fallback, and the web UI will display the status badge **"Relational Cosine Fallback"**.
> - **Intentional Graceful Degradation:** The relational fallback is an intentional development and graceful-degradation mechanism. It must **not** be considered computationally or architecturally equivalent to production `pgvector` retrieval with HNSW indexing.
> - **Mock Embedding Quality:** When `GEMINI_API_KEY` is omitted, ArchLens uses `MockEmbeddingProvider` (deterministic token/n-gram hashing). Its retrieval quality is **not** representative of production semantic-search quality, and low-confidence or unrelated queries may still match indexed chunks.
> - **Production Evaluation:** Evaluating production-quality semantic search requires starting PostgreSQL with `pgvector` (Option B) and configuring a real embedding model (`GEMINI_API_KEY` with `text-embedding-004`).
> - **Zero Code Execution:** ArchLens semantic retrieval indexes and queries static text slices only. Repository code is never executed.

---

## 3. Configure Environment Variables

For local development, copy the provided environment template:

```bash
cp apps/api/.env.example apps/api/.env
```

ArchLens automatically loads `apps/api/.env` at backend startup. In production or containerized environments, system environment variables take precedence.

The backend accepts configuration via environment variables:

| Variable                    | Description                                                                                                 | Default                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`              | PostgreSQL connection string                                                                                | `postgres://postgres:postgres@localhost:5432/archlens` |
| `DB_POOL_MAX`               | Maximum PostgreSQL connection pool size                                                                     | `10`                                                   |
| `DB_IDLE_TIMEOUT`           | Idle connection timeout in seconds                                                                          | `20`                                                   |
| `DB_CONNECT_TIMEOUT`        | Database connection timeout in seconds                                                                      | `10`                                                   |
| `DB_SSL`                    | Optional SSL mode (`require` or `prefer`) for cloud databases                                               | _None_                                                 |
| `GITHUB_TOKEN`              | Optional GitHub Personal Access Token (server-side only) to raise REST rate limits from 60 to 5,000 req/hr  | _None_                                                 |
| `GEMINI_API_KEY`            | Optional Google Gemini API key (server-side only). When omitted, ArchLens uses Mock providers gracefully    | _None_                                                 |
| `AI_PROVIDER`               | AI explanation provider override (`gemini` or `mock`). Defaults to `gemini` if API key present, else `mock` | `gemini` (if key set) / `mock`                         |
| `GEMINI_MODEL`              | Gemini model name                                                                                           | `gemini-2.0-flash`                                     |
| `EMBEDDING_PROVIDER`        | Embedding provider override (`gemini` or `mock`). Defaults to `gemini` if API key present, else `mock`      | `gemini` (if key set) / `mock`                         |
| `GEMINI_EMBEDDING_MODEL`    | Gemini text embedding model name                                                                            | `text-embedding-004`                                   |
| `PORT`                      | API server listen port                                                                                      | `3000`                                                 |
| `HOST`                      | API server host interface                                                                                   | `0.0.0.0`                                              |
| `LOG_LEVEL`                 | Structured Pino log level (`info`, `debug`, `warn`, `error`, `silent`)                                      | `info`                                                 |
| `RATE_LIMIT_TIME_WINDOW_MS` | Rate limiting rolling window in milliseconds                                                                | `60000` (1 min)                                        |
| `RATE_LIMIT_ANALYZE_MAX`    | In-memory maximum `POST /api/analyze` calls per window                                                      | `10`                                                   |
| `RATE_LIMIT_EXECUTE_MAX`    | In-memory maximum `POST /api/repositories/:owner/:repo/execute` calls per window                             | `10`                                                   |
| `RATE_LIMIT_EXPLAIN_MAX`    | In-memory maximum `POST /api/repositories/:owner/:repo/explain` calls per window                             | `20`                                                   |
| `RATE_LIMIT_SEARCH_MAX`     | In-memory maximum `POST /api/repositories/:owner/:repo/search` calls per window                              | `30`                                                   |
| `RATE_LIMIT_GENERAL_MAX`    | In-memory maximum general endpoint calls per window                                                         | `120`                                                  |
| `ENABLE_SANDBOX`            | Deployment toggle for execution (`true` or `false`). Defaults to `false` in production env                  | `true` in dev/test, `false` in prod                    |

> [!NOTE]
> `GITHUB_TOKEN` and `GEMINI_API_KEY` are strictly consumed server-side in `apps/api`. They are never exposed to `apps/web` or `@archlens/shared`. If `GEMINI_API_KEY` is not provided, ArchLens runs 100% offline using `MockAIProvider` and `MockEmbeddingProvider`.

> [!WARNING]
> **Sandbox Model Disclosure:** The sandbox execution subsystem is a **restricted host-process runner** with a stripped environment, in-process V8 heap limits, path traversal defenses, and process-group termination (`SIGKILL`). It is **NOT** a kernel-level microVM or container isolation sandbox. In production environments, `ENABLE_SANDBOX` defaults to `false` in `.env.example`.

If using the default local Docker container above, `DATABASE_URL` does not need to be set explicitly.

---

## 4. Run Database Migrations

Apply versioned Drizzle migrations to initialize or update the PostgreSQL database schema:

```bash
pnpm --filter @archlens/api db:migrate
```

> [!NOTE]
> Application startup does not execute schema DDL. Schema creation and indexing are managed exclusively through formal Drizzle migrations. Running `db:migrate` is safe for both fresh databases and existing populated databases.

---

## 5. Health Probes & Graceful Shutdown

The API server exposes standardized health endpoints for orchestration and monitoring:

- **Liveness Probe (`GET /health/liveness`)**: Returns HTTP 200 `{ status: "ok", check: "liveness", version: "0.1.0", uptime: ... }`. Verifies that the Node process is running. Does not touch the database.
- **Readiness Probe (`GET /health/readiness`)**: Executes `SELECT 1` via `checkDbConnection()`. Returns HTTP 200 `{ status: "ready", check: "readiness", database: "connected", version: "0.1.0" }` when reachable, or HTTP 503 `{ status: "unavailable", database: "disconnected" }` when unavailable (without exposing internal connection errors).
- **Legacy Health Probe (`GET /health`)**: Returns HTTP 200 `{ status: "ok", version: "0.1.0" }`.

Rate limiting is disabled on all health probes.

**Graceful Termination**: On `SIGTERM` or `SIGINT`, the server gracefully stops accepting incoming requests, cleans up ephemeral preview workspaces, terminates active sandbox child processes, closes the PostgreSQL connection pool, and exits within a bounded 10-second grace period.

---

## 6. Build Workspace Packages

Build `@archlens/shared`, `@archlens/api`, and `@archlens/web`:

```bash
pnpm -r run build
```

---

## 7. Start Development Servers

Start all workspaces concurrently:

```bash
pnpm -r run dev
```

Or start components independently:

```bash
# Terminal 1: Backend API (Fastify with tsx watch on port 3000)
pnpm --filter @archlens/api dev

# Terminal 2: Frontend Client (Vite on port 5173, proxying /api to 3000)
pnpm --filter @archlens/web dev
```

Open `http://localhost:5173` to access the ArchLens Web Explorer.

---

## 8. Code Quality & Testing

```bash
# Run Vitest test suite (offline fixtures + integration tests)
pnpm -r run test

# Run TypeScript typechecks across packages
pnpm -r run typecheck

# Run ESLint across packages
pnpm -r run lint
```
