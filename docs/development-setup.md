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

| Variable                 | Description                                                                                                 | Default                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`           | PostgreSQL connection string                                                                                | `postgres://postgres:postgres@localhost:5432/archlens` |
| `DB_POOL_MAX`            | Maximum PostgreSQL connection pool size                                                                     | `10`                                                   |
| `DB_IDLE_TIMEOUT`        | Idle connection timeout in seconds                                                                          | `20`                                                   |
| `DB_CONNECT_TIMEOUT`     | Database connection timeout in seconds                                                                      | `10`                                                   |
| `DB_SSL`                 | Optional SSL mode (`require` or `prefer`) for cloud databases                                               | _None_                                                 |
| `GITHUB_TOKEN`           | Optional GitHub Personal Access Token (server-side only) to raise REST rate limits from 60 to 5,000 req/hr  | _None_                                                 |
| `GEMINI_API_KEY`         | Optional Google Gemini API key (server-side only). When omitted, ArchLens uses Mock providers gracefully    | _None_                                                 |
| `AI_PROVIDER`            | AI explanation provider override (`gemini` or `mock`). Defaults to `gemini` if API key present, else `mock` | `gemini` (if key set) / `mock`                         |
| `GEMINI_MODEL`           | Gemini model name                                                                                           | `gemini-2.0-flash`                                     |
| `EMBEDDING_PROVIDER`     | Embedding provider override (`gemini` or `mock`). Defaults to `gemini` if API key present, else `mock`      | `gemini` (if key set) / `mock`                         |
| `GEMINI_EMBEDDING_MODEL` | Gemini text embedding model name                                                                            | `text-embedding-004`                                   |
| `PORT`                   | API server listen port                                                                                      | `3000`                                                 |
| `HOST`                   | API server host interface                                                                                   | `0.0.0.0`                                              |

> [!NOTE]
> `GITHUB_TOKEN` and `GEMINI_API_KEY` are strictly consumed server-side in `apps/api`. They are never exposed to `apps/web` or `@archlens/shared`. If `GEMINI_API_KEY` is not provided, ArchLens runs 100% offline using `MockAIProvider` and `MockEmbeddingProvider`.

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

## 5. Build Workspace Packages

Build `@archlens/shared`, `@archlens/api`, and `@archlens/web`:

```bash
pnpm -r run build
```

---

## 6. Start Development Servers

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

## 7. Code Quality & Testing

```bash
# Run Vitest test suite (offline fixtures + integration tests)
pnpm -r run test

# Run TypeScript typechecks across packages
pnpm -r run typecheck

# Run ESLint across packages
pnpm -r run lint

# Check and format code with Prettier
pnpm run format
```
