# ------------------------------------------------------------------------------
# Stage 1: Base image with pnpm enabled
# ------------------------------------------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ------------------------------------------------------------------------------
# Stage 2: Build web static assets
# ------------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

# Install full dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/tsconfig ./packages/tsconfig
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build shared package first, then Web static assets
RUN pnpm --filter @archlens/shared build
RUN pnpm --filter @archlens/web build

# ------------------------------------------------------------------------------
# Stage 3: Minimal, unprivileged Nginx server for static assets
# ------------------------------------------------------------------------------
FROM nginx:alpine AS runner

# Remove default Nginx configuration and unprivileged user directive warning
RUN rm -rf /etc/nginx/conf.d/* \
    && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf

# Copy custom Nginx configuration with SPA history fallback and dynamic /api/ reverse proxy
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Grant unprivileged nginx user write access to runtime directories and PID file
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

# Run as non-root nginx user
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
