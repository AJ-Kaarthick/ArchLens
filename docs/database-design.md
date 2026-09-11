# Database Design

ArchLens uses **PostgreSQL** as its persistence layer, managed through **Drizzle ORM** with the `postgres.js` driver.

---

## Schema Overview (Phase 3)

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
└──────────────────┬─────────────────────┘
                   │ 1
                   │
                   │ N
┌──────────────────▼─────────────────────┐
│            ai_explanations             │
├────────────────────────────────────────┤
│ id: serial PK                          │
│ analysis_id: integer FK (cascade)     │
│ topic: text NOT NULL                   │
│ target: text                           │
│ summary: text NOT NULL                 │
│ explanation: text NOT NULL             │
│ key_takeaways: jsonb NOT NULL          │
│ evidence: jsonb NOT NULL               │
│ provider: text NOT NULL                │
│ model: text NOT NULL                   │
│ created_at: timestamptz NOT NULL       │
└────────────────────────────────────────┘
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

---

## Initialization & Migrations

- **Idempotent Bootstrapping (`initDb`):**
  On server startup, `initDb()` executes idempotent `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` DDL statements. This eliminates manual database migration friction for local development and self-hosting.
- **Drizzle Kit Tooling:**
  Commands `pnpm --filter @archlens/api db:generate` and `pnpm --filter @archlens/api db:push` are available for schema generation and inspection.

---

## Future Considerations (Phase 4+)

Phase 3 uses purely structured relational + JSONB persistence. When semantic search and AI retrieval are developed in Phase 4, `pgvector` will be evaluated to store code chunk embeddings directly within PostgreSQL, maintaining an operationally simple single-database architecture.
