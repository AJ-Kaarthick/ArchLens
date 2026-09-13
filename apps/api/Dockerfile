# ------------------------------------------------------------------------------
# Stage 1: Base image with pnpm enabled
# ------------------------------------------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ------------------------------------------------------------------------------
# Stage 2: Install dependencies and build shared + API packages
# ------------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install full dependencies (including devDependencies required for compiling TypeScript)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/tsconfig ./packages/tsconfig
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package first, then API
RUN pnpm --filter @archlens/shared build
RUN pnpm --filter @archlens/api build

# Prune devDependencies to keep production runtime footprint minimal
RUN pnpm prune --prod --no-optional

# ------------------------------------------------------------------------------
# Stage 3: Minimal, unprivileged production runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Pre-create scratch directory for sandbox with restricted permissions
RUN mkdir -p /tmp/archlens-sandboxes \
    && chown -R node:node /tmp/archlens-sandboxes /app \
    && chmod 700 /tmp/archlens-sandboxes

# Switch to standard unprivileged Node user
USER node

# Copy workspace configuration and pruned dependencies
COPY --chown=node:node --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy compiled shared package
COPY --chown=node:node --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy compiled API package & Drizzle SQL migration files
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY --chown=node:node --from=builder /app/apps/api/node_modules ./apps/api/node_modules

EXPOSE 3000

# Container healthcheck targeting process liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/liveness').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
