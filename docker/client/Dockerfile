# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configuration and client package files
COPY package.json package-lock.json ./
COPY client/package.json ./client/

# Install dependencies strictly matching package-lock
RUN npm ci --workspace=@drivescale/client --include-workspace-root

# Copy client source code and configuration
COPY client/ ./client/

# Build production bundle using Vite
RUN npm run build --workspace=@drivescale/client

# ==========================================
# Stage 2: Production Nginx Serving Layer
# ==========================================
FROM nginx:1.27-alpine AS runner

# Remove default nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy built static assets from builder stage
COPY --from=builder /app/client/dist /usr/share/nginx/html

# Copy optimized SPA nginx configuration
COPY docker/client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose internal HTTP port
EXPOSE 80

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=5s \
  CMD wget -q --spider http://127.0.0.1:80/health || exit 1

# Start nginx in foreground
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]

