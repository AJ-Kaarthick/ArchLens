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

---

## 9. Local Production Simulation & Containerization

ArchLens provides Docker images and a Docker Compose configuration for local production simulation and deployment verification.

> [!NOTE]
> The Docker Compose configuration (`docker-compose.yml`) is provided strictly for **local full-stack simulation, developer testing, and release validation**. It is not a claim of production-grade cloud orchestration.

### Services Architecture

| Service | Image | Base Image | Non-Root User | Internal Port | Host Port | Purpose |
|---|---|---|---|---|---|---|
| **`postgres`** | `postgres:16-alpine` | Alpine | `postgres` (UID 70) | `5432` | `5433` (configurable) | Persistent database with named volume `archlens_pgdata`. |
| **`migrator`** | `archlens-api` | `node:20-alpine` | `node` (UID 1000) | N/A | N/A | One-shot migration runner. Runs `node apps/api/dist/db/migrate.js` to completion before API boots. |
| **`api`** | `archlens-api` | `node:20-alpine` | `node` (UID 1000) | `3000` | `3000` | Fastify backend with structured logging, rate limiting, and health probes. |
| **`web`** | `archlens-web` | `nginx:alpine` | `nginx` (UID 101) | `8080` | `8080` | Unprivileged Nginx serving compiled Vite static assets with SPA fallback and `/api/` reverse proxy. |

### Running the Production Simulation

```bash
# 1. Validate Docker Compose configuration
docker compose config

# 2. Build production images
docker compose build

# 3. Launch stack in background
docker compose up -d

# 4. Check services status & health
docker compose ps

# 5. View logs
docker compose logs -f api
docker compose logs -f migrator

# 6. Stop simulation stack (preserves named volume)
docker compose down
```

### Verifying Endpoints

```bash
# Verify API process liveness probe
curl http://localhost:3000/health/liveness

# Verify API database readiness probe
curl http://localhost:3000/health/readiness

# Verify Web frontend home page
curl -I http://localhost:8080/

# Verify SPA history fallback for direct deep links
curl -I http://localhost:8080/repos/facebook/react?tab=execution

# Verify Nginx reverse proxy to API
curl http://localhost:8080/api/repositories/recent
```

### Continuous Integration (GitHub Actions)

CI is configured under `.github/workflows/ci.yml` and triggers on pushes and pull requests to `main`:

1. **`validate` job**:
   - Boots a PostgreSQL 16 Alpine service container.
   - Installs pnpm with frozen lockfile.
   - Executes `pnpm -r run lint`.
   - Executes `pnpm -r run typecheck`.
   - Executes `pnpm -r run test` with real PostgreSQL connectivity.
   - Executes `pnpm -r run build`.
   - Checks git diff and formatting (`git diff --check`).
2. **`docker` job**:
   - Validates `apps/api/Dockerfile` multi-stage build.
   - Validates `apps/web/Dockerfile` multi-stage build.
   - Validates `docker compose config`.

### Architectural Boundaries & Future Work

- **Restricted Host-Process Sandbox**: The execution subsystem is a restricted host-process model (stripped environment, in-process memory bounds, path confinement, process-group `SIGKILL` termination), **not** a kernel-level microVM or container isolation boundary. In production configurations, `ENABLE_SANDBOX` defaults to `false`.
- **In-Memory Rate Limiting**: Rate limits are enforced per-process using `@fastify/rate-limit`. Horizontal scaling across multiple container instances would require ingress/gateway rate limiting or a shared store.
- **Intentionally Deferred Capabilities**:
  - Authentication and multi-tenant authorization (planned for post-Phase 7).
  - Distributed job queues (Redis/BullMQ) — current bounded synchronous workloads do not justify premature queue infrastructure.
  - Kubernetes manifests or distributed cloud orchestration.
