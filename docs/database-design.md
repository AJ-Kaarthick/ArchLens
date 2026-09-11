# Database Design

ArchLens uses **PostgreSQL** as its persistence layer, managed through **Drizzle ORM** with the `postgres.js` driver.

---

## Schema Overview (Phase 4)

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
                   │
                   │ N
┌──────────────────▼─────────────────────┐
│                analyses                │
├────────────────────────────────────────┤
│ id: serial PK                          │
│ repository_id: integer FK (cascade)   │
│ commit_sha: text                       │
│ tech_stack: jsonb NOT NULL             │
│ architecture: jsonb NOT NULL           │
│ metrics: jsonb NOT NULL                │
│ tree: jsonb NOT NULL                   │
│ analyzed_at: timestamptz NOT NULL      │
└─────────┬──────────────────────┬───────┘
          │ 1                    │ 1
          │                      │
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
- **Index:** `CREATE INDEX IF NOT EXISTS analyses_repo_analyzed_at_idx ON analyses (repository_id, analyzed_at DESC);` to ensure instant retrieval of the latest analysis.
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

---

## Initialization & Migrations

- **Idempotent Bootstrapping (`initDb`):**
  On server startup, `initDb()` executes idempotent `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` DDL statements.
- **Dynamic pgvector Detection (`hasPgVectorSupport`):**
  Before attempting vector DDL, `initDb()` inspects `pg_available_extensions` for the `vector` extension. If available, it executes `CREATE EXTENSION IF NOT EXISTS vector` and adds the `embedding_vec vector(768)` column and HNSW index. If absent, it gracefully skips vector DDL without errors.
- **Drizzle Kit Tooling:**
  Commands `pnpm --filter @archlens/api db:generate` and `pnpm --filter @archlens/api db:push` are available for schema generation and inspection.

---

## Future Considerations (Phase 5+)

In Phase 5 and Phase 6, as codebase scale expands, chunking may be enhanced with AST-aware boundary detection, and background worker queues (Redis/BullMQ) will handle asynchronous batch embedding generation for repositories with hundreds of source files.
