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

Run a local PostgreSQL 16 container:

```bash
docker run -d \
  --name archlens-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=archlens \
  -p 5432:5432 \
  postgres:16-alpine
```

Verify readiness:

```bash
docker exec archlens-postgres pg_isready -U postgres
```

---

## 3. Configure Environment Variables

The backend accepts configuration via environment variables:

| Variable       | Description                                                                        | Default                                                |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL` | PostgreSQL connection string                                                       | `postgres://postgres:postgres@localhost:5432/archlens` |
| `GITHUB_TOKEN` | Optional GitHub Personal Access Token (server-side only) to raise REST rate limits | _None_                                                 |
| `PORT`         | API server listen port                                                             | `3000`                                                 |
| `HOST`         | API server host interface                                                          | `0.0.0.0`                                              |

If using the default local Docker container above, `DATABASE_URL` does not need to be set explicitly.

---

## 4. Build Workspace Packages

Build `@archlens/shared`, `@archlens/api`, and `@archlens/web`:

```bash
pnpm -r run build
```

---

## 5. Start Development Servers

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

## 6. Code Quality & Testing

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
