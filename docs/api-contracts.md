# API Contracts

All ArchLens API endpoints are RESTful, hosted by `apps/api` (Fastify), and strictly validated using Zod schemas defined in `packages/shared`.

---

## Shared Schemas (`@archlens/shared`)

The shared package exports canonical Zod schemas and inferred TypeScript types:

- `RepoInputSchema`: Validates repository input (`url` or `owner` + `repo`) and normalizes to `{ owner: string, repo: string }`.
- `RepositoryMetadataSchema`: Canonical repository metadata (stars, forks, description, default branch, timestamps).
- `AnalysisResultSchema`: Complete analysis result including metadata, tech stack detections, architectural overview, structural metrics, and file tree items.
- `LandmarkContentSchema`: Bounded file preview data (`path`, `name`, `size`, `content`, `encoding`, `isTruncated`).
- `EvidenceTypeSchema`: Supported grounding evidence categories (`file`, `manifest`, `entrypoint`, `dependency`, `metric`, `pattern`).
- `EvidenceCitationSchema`: Individual evidence item (`type`, `label`, `reference`, `description`).
- `ExplainTopicSchema`: Valid AI explanation topics (`overview`, `architecture`, `tech-stack`, `entrypoints`).
- `ExplainRequestSchema`: Request payload for AI explanations (`topic`, optional `target`).
- `ExplainResponseSchema`: Complete grounded AI explanation payload with key takeaways, markdown explanation, citations, cache metadata, and provider info.
- `SearchQuerySchema`: Request payload for semantic search (`query`, `limit`, optional `pathPrefix`, optional `category`).
- `SearchResultItemSchema`: Single ranked chunk search result (`filePath`, `chunkIndex`, `startLine`, `endLine`, `content`, `score`, `language`, `category`).
- `SearchResponseSchema`: Complete semantic search response (`query`, `results`, `totalMatches`, `durationMs`, `fallback`).
- `ApiErrorSchema`: Standardized error envelope (`error`, `message`, `isRateLimit`, `suggestedAction`).

---

## Endpoints

### 1. `POST /api/analyze`

Ingests a repository via the GitHub REST API and performs synchronous deterministic analysis.

- **Request Body:**

  ```json
  {
    "url": "facebook/react"
  }
  ```

  _(Also accepts full URLs like `"https://github.com/facebook/react"` or separate `"owner"` and `"repo"` fields)._

- **Success Response (`200 OK`):**
  Returns `AnalysisResult`:

  ```json
  {
    "repository": {
      "id": "1",
      "owner": "facebook",
      "name": "react",
      "url": "https://github.com/facebook/react",
      "defaultBranch": "main",
      "description": "The library for web and native user interfaces.",
      "stars": 230000,
      "forks": 46000,
      "primaryLanguage": "JavaScript",
      "createdAt": "2013-05-24T16:15:54Z",
      "updatedAt": "2026-09-10T12:00:00Z"
    },
    "commitSha": "e4f8c...",
    "techStack": [
      {
        "category": "framework",
        "name": "React",
        "version": "18.3.0",
        "confidence": "high",
        "evidence": "package.json -> react"
      }
    ],
    "architecture": {
      "isMonorepo": true,
      "monorepoTool": "npm/yarn workspaces",
      "workspaces": ["packages/*"],
      "detectedPatterns": ["Monorepo Architecture", "Client-Server Separation"],
      "primaryEntrypoints": ["packages/react/index.js"],
      "keyLandmarks": [
        {
          "path": "README.md",
          "name": "README.md",
          "type": "doc",
          "description": "Primary repository documentation"
        }
      ]
    },
    "metrics": {
      "totalFiles": 1420,
      "totalBytes": 12450000,
      "languages": {
        "JavaScript": { "bytes": 9500000, "percentage": 76.3, "fileCount": 980 }
      },
      "categories": {
        "source": { "bytes": 9800000, "percentage": 78.7, "fileCount": 1020 }
      },
      "largestFiles": [{ "path": "build/react.js", "size": 125000 }]
    },
    "tree": [
      {
        "path": "README.md",
        "name": "README.md",
        "type": "file",
        "size": 4500,
        "extension": ".md",
        "category": "doc",
        "isLandmark": true
      }
    ],
    "analyzedAt": "2026-09-10T12:05:00.000Z"
  }
  ```

- **Error Responses:**
  - **`400 Bad Request`**: Validation error or repository exceeds the 10,000-file bound.
    ```json
    {
      "error": "TreeTooLarge",
      "message": "Repository tree has 14500 items, exceeding the maximum bounded limit of 10000 items.",
      "isRateLimit": false,
      "suggestedAction": "Repository exceeds bounded limit of 10,000 files."
    }
    ```
  - **`404 Not Found`**: Repository does not exist or is private.
    ```json
    {
      "error": "NotFound",
      "message": "GitHub repository 'foo/bar' was not found or is private.",
      "isRateLimit": false,
      "suggestedAction": "Ensure the repository exists, is public, and the name is spelled correctly."
    }
    ```
  - **`429 Too Many Requests`**: GitHub REST API rate limit reached.
    ```json
    {
      "error": "RateLimitExceeded",
      "message": "API rate limit exceeded.",
      "isRateLimit": true,
      "suggestedAction": "GitHub API rate limit exceeded for unauthenticated requests. Set GITHUB_TOKEN on the server or retry at 5:36:35 pm."
    }
    ```

---

### 2. `GET /api/repository/latest-analysis`

Retrieves the latest cached analysis for a given repository.

- **Query Parameters:**
  - `owner` & `repo` (e.g. `?owner=facebook&repo=react`)
  - OR `url` (e.g. `?url=facebook/react` or `?url=https://github.com/facebook/react`)
- **Success Response (`200 OK`):** `AnalysisResult`
- **Error Response (`404 Not Found`):** If no analysis exists yet for the given repository.

---

### 3. `GET /api/repositories/:owner/:repo/latest`

Route-parameter variant of latest analysis retrieval.

- **Parameters:**
  - `:owner`: Repository owner login
  - `:repo`: Repository name
- **Success Response (`200 OK`):** `AnalysisResult`

---

### 4. `GET /api/repositories/:owner/:repo/landmark-content`

Fetches bounded content for a specific landmark file (e.g. `README.md`, `package.json`).

- **Parameters:**
  - `:owner`: Repository owner login
  - `:repo`: Repository name
- **Query Parameters:**
  - `path` (required): Relative path within repository
  - `ref` (optional): Git commit SHA or branch name
- **Success Response (`200 OK`):**
  ```json
  {
    "path": "README.md",
    "name": "README.md",
    "size": 4200,
    "content": "# Project Title\n\nFull file text...",
    "encoding": "utf-8",
    "isTruncated": false
  }
  ```
- **Security:** Directory traversal attempts (paths containing `..`) are rejected with `400 Bad Request`.
- **Truncation:** Files exceeding 256 KB have `isTruncated: true` with a placeholder message.

### 5. `POST /api/repositories/:owner/:repo/explain`

Generates or retrieves a cached grounded AI explanation for a previously analyzed repository.

- **Parameters:**
  - `:owner`: Repository owner login
  - `:repo`: Repository name
- **Request Body (optional):**

  ```json
  {
    "topic": "overview",
    "target": "apps/api"
  }
  ```

  _(`topic` defaults to `"overview"`. Valid topics: `"overview"`, `"architecture"`, `"tech-stack"`, `"entrypoints"`. `target` is optional)._

- **Success Response (`200 OK`):**
  Returns `ExplainResponse`:

  ```json
  {
    "topic": "overview",
    "target": null,
    "summary": "High-level summary of the repository architecture.",
    "explanation": "### Architectural Overview\n\nDetailed markdown walkthrough...",
    "keyTakeaways": [
      "Modular monorepo architecture",
      "Strict type boundaries across layers",
      "PostgreSQL persistence with Drizzle ORM"
    ],
    "evidence": [
      {
        "type": "manifest",
        "label": "Root Manifest",
        "reference": "package.json",
        "description": "Declares workspace packages and dependencies"
      },
      {
        "type": "entrypoint",
        "label": "Backend Entrypoint",
        "reference": "apps/api/src/server.ts",
        "description": "Primary Fastify server bootstrap"
      }
    ],
    "generatedAt": "2026-09-11T00:30:00.000Z",
    "provider": "gemini",
    "model": "gemini-2.0-flash",

    "cached": true
  }
  ```

- **Error Responses:**
  - `400 Bad Request`: When `topic` is invalid or request body fails schema validation.
  - `404 Not Found`: When the repository has not been analyzed yet via `POST /api/analyze`.
  - `429 Too Many Requests`: When the configured AI provider rate limit or quota is exceeded (returns structured `ApiError` with `isRateLimit: true` and recovery action).
  - `500 Internal Server Error`: Returns a sanitized user-facing error message (`"An internal error occurred while generating the AI explanation."`) to prevent exposing internal exception details or stack traces.

---

### 6. `POST /api/repositories/:owner/:repo/search`

Executes semantic search over indexed code chunks for an analyzed repository.

- **Path Parameters:**
  - `owner`: Repository owner login.
  - `repo`: Repository name.

- **Request Body:**

  ```json
  {
    "query": "drizzle connection pool postgres",
    "limit": 5,
    "pathPrefix": "apps/api",
    "category": "source"
  }
  ```

- **Query Options:**
  - `query` (required, string, 2-300 chars): Search term or semantic description.
  - `limit` (optional, integer, 1-20, default: 5): Maximum number of top matches to return.
  - `pathPrefix` (optional, string): Filter results strictly to files matching this path prefix (e.g. `apps/web/src/`).
  - `category` (optional, enum): Filter by file category (`source`, `test`, `config`, `doc`, `ci`, `asset`, `other`).

- **Success Response (`200 OK`):**
  Returns `SearchResponse`:

  ```json
  {
    "query": "drizzle connection pool postgres",
    "results": [
      {
        "filePath": "apps/api/src/db/index.ts",
        "chunkIndex": 0,
        "startLine": 1,
        "endLine": 15,
        "content": "import postgres from 'postgres';\nimport { drizzle } from 'drizzle-orm/postgres-js';...",
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

- **Dual-Mode Search & Fallback Semantics:**
  - When `fallback: false`: Results are ranked using native `pgvector` HNSW vector cosine distance (`<=>`).
  - When `fallback: true`: Results are computed using an exact in-memory vector cosine similarity ranking over serialized embeddings stored in PostgreSQL.
  - _Operational Note:_ The standard local development container (`postgres:16-alpine`) lacks `pgvector`, so responses in local dev return `fallback: true`. This fallback is an intentional development and graceful-degradation mechanism, not equivalent to production `pgvector` HNSW retrieval. When combined with `MockEmbeddingProvider`, retrieval quality is suitable for offline testing, but broad or low-confidence queries may still return results. Production semantic evaluation requires real embeddings and a `pgvector`-enabled database.
- **UI vs. API Capabilities:** The REST API accepts optional `pathPrefix` filtering (e.g. `"apps/api"`). The current web UI exposes controls for `query`, `category`, and `limit`, but does not currently expose a dedicated Path Prefix input.
- **Zero Code Execution:** Semantic search operates purely on indexed static text slices and embeddings. Repository code is never executed.

- **Error Responses:**
  - `400 Bad Request`: When `query` is invalid, empty, or exceeds 300 characters.
  - `404 Not Found`: When the repository has not been analyzed yet via `POST /api/analyze`.
  - `429 Too Many Requests`: When the embedding provider rate limit is exceeded.
  - `500 Internal Server Error`: Sanitized error message on unexpected server failures.

---

### 7. `GET /health`

Liveness and version check.

- **Success Response (`200 OK`):**
  ```json
  {
    "status": "ok",
    "version": "0.1.0"
  }
  ```
