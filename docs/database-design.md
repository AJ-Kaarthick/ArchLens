# Database Design

ArchLens uses **PostgreSQL** as its persistence layer, managed through **Drizzle ORM** with the `postgres.js` driver and versioned migrations.

---

## Schema Overview (Phase 7)

```
┌────────────────────────────────────────┐
│              repositories              │
├────────────────────────────────────────┤
│ id: serial PK                          │
│ owner: text NOT NULL                   │
│ name: text NOT NULL                    │
│ url: text NOT NULL                     │
│ default_branch: text NOT NULL          │
│ description: text                      │
│ stars: integer NOT NULL DEFAULT 0      │
│ forks: integer NOT NULL DEFAULT 0      │
│ primary_language: text                 │
│ created_at: timestamptz NOT NULL       │
│ updated_at: timestamptz NOT NULL       │
└──────────────────┬─────────────────────┘
                   │ 1
                   ├─────────────────────────────────────────┐
                   │ N                                       │ N
┌──────────────────▼─────────────────────┐ ┌─────────────────▼─────────────────────┐
│                analyses                │ │        repository_executions        │
├────────────────────────────────────────┤ ├─────────────────────────────────────┤
│ id: serial PK                          │ │ id: serial PK                       │
│ repository_id: integer FK (cascade)   │ │ repository_id: integer FK (cascade)   │
│ commit_sha: text                       │ │ analysis_id: integer FK (set null)  │
│ tech_stack: jsonb NOT NULL             │ │ execution_id: text UNIQUE NOT NULL  │
│ architecture: jsonb NOT NULL           │ │ profile: text NOT NULL              │
│ metrics: jsonb NOT NULL                │ │ status: text NOT NULL               │
│ tree: jsonb NOT NULL                   │ │ exit_code: integer                  │
│ analyzed_at: timestamptz NOT NULL      │ │ duration_ms: integer NOT NULL (0)   │
└─────────┬──────────────────────┬───────┘ │ refusal_reason: text                │
          │ 1                    │ 1       │ created_at: timestamptz NOT NULL    │
          │                      │         └─────────────────────────────────────┘
          │ N                    │ N
┌─────────▼──────────────┐ ┌─────▼───────────────────────────────┐
│    ai_explanations     │ │                code_chunks          │
├────────────────────────┤ ├─────────────────────────────────────┤
│ id: serial PK          │ │ id: serial PK                       │
│ analysis_id: FK (casc) │ │ analysis_id: integer FK (cascade)   │
│ topic: text NOT NULL   │ │ file_path: text NOT NULL            │
│ target: text           │ │ chunk_index: integer NOT NULL       │
│ summary: text NOT NULL │ │ start_line: integer NOT NULL        │
│ explanation: text      │ │ end_line: integer NOT NULL          │
│ key_takeaways: jsonb   │ │ content: text NOT NULL              │
│ evidence: jsonb        │ │ language: text                      │
│ provider: text NOT NULL│ │ category: text NOT NULL             │
│ model: text NOT NULL   │ │ embedding: jsonb                    │
│ created_at: timestamptz│ │ embedding_vec: vector(768) (opt)    │
└────────────────────────┘ │ created_at: timestamptz NOT NULL    │
                           └─────────────────────────────────────┘
```

---

## Tables

### 1. `repositories`

Stores canonical repository metadata ingested from GitHub.

- **Unique Constraint / Index:**
  `CREATE UNIQUE INDEX IF NOT EXISTS repositories_owner_name_unique ON repositories (owner, name);`
- **Upsert Behavior:**
  When a repository is re-analyzed, its metadata (stars, forks, description, default branch, updated timestamp) is updated in-place using PostgreSQL's `ON CONFLICT (owner, name) DO UPDATE`. This guarantees that no duplicate repository records are created.

### 2. `analyses`

Stores historical analysis snapshots linked to a repository.

- **Foreign Key:** `repository_id` references `repositories(id)` with `ON DELETE CASCADE`.
- **Indices:**
  - `CREATE INDEX IF NOT EXISTS analyses_repo_analyzed_at_idx ON analyses (repository_id, analyzed_at DESC);` to ensure instant retrieval of the latest analysis for a given repository.
  - `CREATE INDEX IF NOT EXISTS analyses_analyzed_at_desc_idx ON analyses (analyzed_at DESC);` (Added in Milestone 7.2) to accelerate global recent-repository queries (`GET /api/repositories/recent`).
- **JSONB Payloads:** Structured analysis results (`tech_stack`, `architecture`, `metrics`, `tree`) are persisted as validated JSONB documents adhering to `@archlens/shared` Zod contracts.

### 3. `ai_explanations`

Stores grounded AI explanations linked to a specific analysis snapshot.

- **Foreign Key:** `analysis_id` references `analyses(id)` with `ON DELETE CASCADE`.
- **Unique Constraint / Index:**
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_explanations_unique ON ai_explanations (analysis_id, topic, COALESCE(target, ''));`
- **Zero-Token Latency Caching:** When an explanation for `(analysis_id, topic, target)` is requested, the cached record is returned immediately without invoking external AI providers. If a repository is re-analyzed via `POST /api/analyze`, a new `analysis_id` is created, naturally invalidating stale cache entries.
- **JSONB Payloads:** `key_takeaways` (array of bullet points) and `evidence` (array of typed citations) are persisted as validated JSONB documents.

### 4. `code_chunks`

Stores chunked source code and documentation slices for semantic retrieval.

- **Foreign Key:** `analysis_id` references `analyses(id)` with `ON DELETE CASCADE`.
- **Indices:**
  - `CREATE INDEX IF NOT EXISTS code_chunks_analysis_idx ON code_chunks (analysis_id);`
  - `CREATE UNIQUE INDEX IF NOT EXISTS code_chunks_analysis_file_chunk_unique ON code_chunks (analysis_id, file_path, chunk_index);`
  - `CREATE INDEX IF NOT EXISTS code_chunks_embedding_hnsw_idx ON code_chunks USING hnsw (embedding_vec vector_cosine_ops);` (Created conditionally when `pgvector` extension is available).
- **Dual-Mode Vector Persistence:**
  - `embedding_vec vector(768)`: Stores native embeddings for fast in-database approximate nearest neighbor search via HNSW cosine distance (`<=>`).
  - `embedding jsonb`: Stores serialized `number[]` embeddings for relational fallback and environments running standard PostgreSQL without vector extensions.
  - _Operational Note:_ The relational JSONB fallback is an intentional local development and graceful-degradation path ensuring zero crashes in standard PostgreSQL environments. It is not computationally or architecturally equivalent to production `pgvector` indexing. Production setups should use a `pgvector`-enabled container (`pgvector/pgvector:pg16`).

### 5. `repository_executions`

Stores sandboxed process and live preview execution logs.

- **Foreign Keys:**
  - `repository_id` references `repositories(id)` with `ON DELETE CASCADE`.
  - `analysis_id` references `analyses(id)` with `ON DELETE SET NULL`.
- **Indices:**
  - `CREATE UNIQUE INDEX IF NOT EXISTS repository_executions_execution_id_unique ON repository_executions (execution_id);`
  - `CREATE INDEX IF NOT EXISTS repository_executions_repo_idx ON repository_executions (repository_id);`
- **Audit Columns:** Records `profile` (`node-script` or `static-web`), `status` (`completed`, `timed_out`, `failed`, `refused`), `exit_code`, `duration_ms`, `refusal_reason`, and timestamps.

---

## Production Database Configuration & Connection Pooling

The PostgreSQL connection is configured through `postgres.js` with production-grade pooling and timeout settings managed via environment variables:

| Variable             | Default | Description                                                     |
| -------------------- | ------- | --------------------------------------------------------------- |
| `DATABASE_URL`       | Local   | Canonical PostgreSQL connection URI                             |
| `DB_POOL_MAX`        | `10`    | Maximum active connections in the connection pool               |
| `DB_IDLE_TIMEOUT`    | `20`    | Idle connection close timeout in seconds                        |
| `DB_CONNECT_TIMEOUT` | `10`    | Socket connection establishment timeout in seconds              |
| `DB_SSL`             | _None_  | Optional SSL mode (`require` or `prefer` for cloud databases)   |

---

## Versioned Migrations & Migration Runner

In Phase 7, schema-creation DDL has been completely removed from application startup. Schema definitions are now version-controlled through formal Drizzle migrations under `apps/api/drizzle/`.

### Migration Runner (`pnpm db:migrate`)

Run migrations against the target database:

```bash
pnpm --filter @archlens/api db:migrate
```

The migration runner (`apps/api/src/db/migrate.ts`):
- Connects using a dedicated single-connection client (`max: 1`) to eliminate concurrency races.
- Locates migration files in `apps/api/drizzle/` via `meta/_journal.json`.
- Uses Drizzle's PostgreSQL migrator tracking applied migration hashes in `drizzle.__drizzle_migrations`.
- Runs idempotently and transactionally.

### Migration Safety & Upgrade Strategies

1. **Fresh Database Setup:**
   On a new, empty database, running `pnpm db:migrate` creates all tables, foreign keys, and indexes from scratch.

2. **Existing Populated Database Upgrade:**
   ArchLens development and production databases created during Phase 1–6 already contain data and tables. The baseline migration (`0000_initial_schema.sql`) uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and exception-handled foreign key checks. When run against an existing populated database, it:
   - Preserves all existing tables and rows completely untouched.
   - Creates any missing indexes (such as `analyses_analyzed_at_desc_idx`).
   - Safely records the baseline in `drizzle.__drizzle_migrations`.

3. **Application Startup Decoupling:**
   On API boot, `apps/api/src/server.ts` calls `checkDbConnection()` to verify database connectivity with a lightweight `SELECT 1`. The server **no longer** issues `CREATE TABLE IF NOT EXISTS` DDL, avoiding migration races in clustered or multi-container deployments. Production deployments must run `pnpm db:migrate` prior to release deployment.
