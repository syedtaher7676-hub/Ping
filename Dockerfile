# ─────────────────────────────────────────────────────────────
# Ping - Production Multi-Stage Dockerfile
# ─────────────────────────────────────────────────────────────

# Stage 1: Install & Prune Dependencies
FROM node:20-alpine AS dependencies

WORKDIR /app

# Install system utilities needed for building native modules if required
RUN apk add --no-cache libc6-compat

# Copy package manifests
COPY package.json package-lock.json* ./

# Install production dependencies only and clean cache
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# ─────────────────────────────────────────────────────────────
# Stage 2: Production Runner
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

LABEL org.opencontainers.image.title="Ping" \
      org.opencontainers.image.description="Real-time anonymous 1-on-1 chat app" \
      org.opencontainers.image.version="1.0.0"

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production \
    PORT=3000

# Ensure data directory exists with non-root node ownership
RUN mkdir -p /app/data && chown -R node:node /app

# Copy production node_modules from dependencies stage
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copy application source code with non-root ownership
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data

# Switch to standard unprivileged user provided by node image
USER node

# Expose HTTP port
EXPOSE 3000

# Container healthcheck targeting Express /health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Production startup command
CMD ["node", "src/server.js"]
