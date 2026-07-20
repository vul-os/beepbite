# BeepBite Setup Guide

BeepBite is a monorepo with a Go HTTP backend and a React 19 frontend. There is no Supabase project — the frontend talks to the Go API directly.

## Prerequisites

- **Go 1.22+**
- **Node.js 18+** and npm
- **PostgreSQL 15+** (local install or Docker)

## 1. Database

```bash
createdb beepbite
```

## 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```env
DATABASE_URL=postgres://localhost/beepbite?sslmode=disable
JWT_SECRET=<random 32+ char secret>
VITE_API_URL=http://localhost:8080
```

`DATABASE_URL` and `JWT_SECRET` are the only required vars. Everything else in `.env.example` (WhatsApp, SMTP, Mapbox, Gemini) is an optional integration and the app degrades gracefully when absent.

## 3. Run migrations

```bash
cd backend
go run ./cmd/migrate --env=local --up
```

`--reset` drops and re-applies all migrations (destructive). `--down` rolls back.

## 4. Start the Go backend

```bash
cd backend
go run ./cmd/server --env=local
# Listens on :8080 by default
```

## 5. Start the frontend

```bash
# from repo root
npm install
npm run dev
# http://localhost:5174  (beepbite dev port)
```

## First login

Use the seed script to create an owner account and a populated demo organisation:

```bash
./scripts/seed-demo-local.sh --create
# Prints owner + employee logins (password: Demo1234!)
```

## Building for production

```bash
npm run build           # prod bundle (VITE_MODE=main)
npm run build:dev       # dev bundle  (VITE_MODE=dev)
```

## Deploying

See the **Deploy** section in [README.md](../README.md). BeepBite is self-hosted: a Go binary plus a static frontend bundle, running wherever you choose.

## Troubleshooting

See [troubleshooting.md](troubleshooting.md).
