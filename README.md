# FuelMap Libya

Fuel availability platform for Libya built as a monorepo.

## Services

- `apps/web`: Next.js frontend with interactive maps.
- `services/api`: Express API with MongoDB, Redis, and SSE.
- `services/ai`: FastAPI service for prediction helpers.

## Requirements

- Node.js 22+
- npm 10+
- Python 3.13+
- MongoDB 7+ or Docker
- Redis 7+ or Docker

## Quick Start

1. Install dependencies:

```bash
npm install
python -m pip install -r services/ai/requirements.txt
```

2. Create the local environment file:

```bash
copy .env.example .env
```

3. Start MongoDB and Redis:

```bash
docker compose up -d mongodb redis
```

4. Sync indexes and seed local data:

```bash
npm run db:migrate
npm run db:seed
```

5. Start all services:

```bash
npm run dev
```

## Local URLs

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`
- AI health: `http://localhost:8000/health`

## Useful Commands

```bash
npm run dev:web
npm run dev:api
npm run dev:ai
npm run typecheck
npm run build
```

## Notes

- Copy values from `.env.example` and keep `.env` private.
- The repository ignores local logs, caches, build output, and machine-specific files.
