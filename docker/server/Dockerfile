# ==========================================
# Stage 1: Builder
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install native compilation dependencies for node-gyp (e.g. argon2)
RUN apk add --no-cache python3 make g++

# Copy workspace configuration and server manifest
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# Install dependencies matching package-lock
RUN npm ci --workspace=@drivescale/server --include-workspace-root

# Copy server source code and TypeScript config
COPY server/ ./server/

# Compile TypeScript to JavaScript in server/dist
RUN npm run build --workspace=@drivescale/server

# Prune development dependencies to keep production image minimal
RUN npm prune --production --workspace=@drivescale/server

# ==========================================
# Stage 2: Production Runner
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for container health check
RUN apk add --no-cache curl

# Create application directories with non-root ownership
RUN mkdir -p /app/server/data/storage/chunks && chown -R node:node /app

# Copy production node_modules from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy built server artifacts and package definition
COPY --chown=node:node --from=builder /app/server/dist ./server/dist
COPY --chown=node:node --from=builder /app/server/package.json ./server/package.json
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Switch to non-root user
USER node
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Liveness probe
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=15s \
  CMD curl -f http://127.0.0.1:5000/api/v1/health/live || exit 1

# Start production API server directly using exec form
CMD ["node", "dist/server.js"]

