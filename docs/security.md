# Security Strategy

ArchLens handles untrusted third-party repository data from GitHub. Security is built into every layer using a progressive safety model.

---

## Current Protections (Phase 2)

### 1. Secret Isolation

- **Server-Only Secrets:** Any credentials (such as the optional `GITHUB_TOKEN`) are loaded solely in `apps/api` via environment variables.
- **Zero Client Leakage:** No secrets are passed to `apps/web` or baked into static Vite build assets.
- **Shared Contract Isolation:** `@archlens/shared` contains purely data validation schemas and types, never handling secret values.

### 2. Bounded Ingestion & Resource Limits

To protect against Denial of Service (DoS) and memory exhaustion from massive repositories:

- **Tree Item Cap:** Analysis is hard-capped at **10,000 items**. If a repository tree exceeds this limit or returns truncated results from GitHub, ingestion is safely aborted with `GitHubTreeTooLargeError`.
- **File Size Cap:** Landmark content previews are capped at **256 KB**. Files larger than 256 KB are flagged with `isTruncated: true` and a placeholder message.
- **No Blind Cloning:** ArchLens never runs `git clone` or arbitrary shell commands on user-supplied repository inputs.

### 3. Path Traversal Mitigation

When requesting landmark file contents via `/api/repositories/:owner/:repo/landmark-content`:

- Input paths are sanitized to strip leading slashes and normalized.
- Any path containing directory traversal sequences (`..`) is strictly rejected with an error.

### 4. Safe Document Rendering

- Repository documentation (e.g. `README.md`) is rendered on the frontend using `react-markdown`.
- Embedded scripts and unescaped HTML execution are prevented by default.

---

## Progressive Safety Roadmap

| Phase                 | Security Focus                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Phase 2 (Current)** | Server-side secret isolation, 10k tree bound, 256 KB file bound, path traversal defense, safe markdown rendering. |
| **Phase 3 (Planned)** | AI token budget limits, cost ceilings, and prompt injection defenses when processing untrusted code context.      |
| **Phase 4 (Planned)** | Embedding generation rate controls and sanitization of ingested code chunks.                                      |
| **Phase 6 (Planned)** | Public rate limiting, IP abuse prevention, response caching, and edge firewall protections.                       |
