# DriveScale — Cloud File Storage Platform

DriveScale is a high-performance, self-hosted cloud file storage platform inspired by Google Drive and Dropbox.

Built with a modular monolith architecture, DriveScale demonstrates production-quality engineering across full-stack TypeScript, streaming chunked uploads, object storage, caching, distributed rate limiting, and background job processing without any AWS dependencies.

---

## Architecture Overview

```text
                         DriveScale
                             |
              +--------------+--------------+
              |                             |
              v                             v
       React Frontend                Express API
       TypeScript                   Node + TypeScript
              |                             |
              |                       +-----+------+
              |                       |            |
              |                       v            v
              |                    MongoDB       Redis
              |                    Metadata      Cache
              |                                  Rate Limit
              |                                  BullMQ
              |                                    |
              |                                    v
              |                                  Worker
              |
              |
              v
          MinIO Object Storage
```

---

## Core Technology Stack

- **Frontend**: React 18/19, TypeScript, Vite, TanStack Query, Zustand, Lucide React
- **Backend**: Node.js, Express.js, TypeScript, MongoDB (Mongoose), Redis (ioredis), Pino, Zod
- **Infrastructure**: Docker, Docker Compose, MongoDB 7.0, Redis 7.2, MinIO
- **Testing**: Vitest, Supertest, React Testing Library

---

## Monorepo Structure

```text
drivescale/
├── AGENTS.md               # Master engineering guide & rulebook
├── README.md               # Project documentation
├── .env.example            # Canonical environment template
├── docker-compose.yml      # Local development infrastructure
├── package.json            # Root workspace configuration
├── docs/
│   └── progress.md         # Phase progress tracker
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── server/                 # Express + TypeScript API
    ├── src/
    │   ├── config/         # env, database, redis
    │   ├── middleware/     # error, not-found
    │   ├── routes/         # versioned API routes (/api/v1/health)
    │   ├── utils/          # logger, response formatters
    │   ├── app.ts          # Express application setup
    │   └── server.ts       # Server entrypoint
    ├── tests/              # Vitest test suite
    ├── package.json
    └── tsconfig.json
```

---

## Quick Start

### 1. Prerequisites

- Node.js >= 20
- npm >= 9
- Docker & Docker Compose (for local MongoDB & Redis services)

### 2. Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Start Local Infrastructure

```bash
docker compose up -d
```

This starts:
- MongoDB at `localhost:27017`
- Redis at `localhost:6379`

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Development Servers

Run both client and server simultaneously:

```bash
npm run dev
```

Or run individually:

```bash
# Frontend dev server (Vite on http://localhost:5173)
npm run dev:client

# Backend API server (tsx watch on http://localhost:5000)
npm run dev:server
```

### 6. Verify Health Endpoint

```bash
curl http://localhost:5000/api/v1/health
```

Expected output:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 4.12,
    "timestamp": "2026-09-14T13:30:00.000Z",
    "version": "0.1.0",
    "services": {
      "database": {
        "status": "connected"
      },
      "redis": {
        "status": "connected"
      }
    }
  }
}
```

---

## Testing & Quality Assurance

```bash
# Type check all workspaces
npm run typecheck

# Run linter across workspaces
npm run lint

# Run automated tests
npm test

# Build client and server
npm run build
```

---

## Development Roadmap & Progress

Track implementation phases and verification status in [docs/progress.md](docs/progress.md).
