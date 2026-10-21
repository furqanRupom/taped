# Taped: Lightweight Feature Flag & Dynamic Config API

A bare-bones, edge-cacheable backend for **boolean feature flags** and **key-value configs**, organised by project and environment (`production`, `staging`). Built for solo and indie developers who want to launch features gradually or kill a broken one **without redeploying**.

> **Status:** Planning / pre-implementation. The specification lives in [`docs/`](./docs). Commands and file paths below describe the intended setup and will be confirmed as the code is written.

---

## Why

- Hardcoded flags require a full redeploy to change.
- Managed services like LaunchDarkly are powerful, but expensive and over-featured for small projects.
- FlagLite does the small useful part: toggle flags, change configs, serve them fast.

## Features (MVP)

- Boolean flags and `string` / `number` / `json` configs
- Separate values per environment (`production`, `staging`)
- One cacheable endpoint for clients: `GET /v1/configs/{project_id}`
- Instant toggle and a one-call **kill switch**
- Optional percentage rollout for boolean flags
- Environment-scoped SDK keys (create, revoke, rotate)
- Promote staging → production in one action
- Audit log of every change
- Minimal management API for a toggle UI

Not in the MVP: user targeting rules, experiments, teams, webhooks/SSE, GraphQL. See [`docs/01`](./docs/01-confirmed-decisions-and-assumptions.md).

## Tech Stack

| Layer         | Choice                             |
| ------------- | ---------------------------------- |
| Framework     | NestJS                             |
| ORM / DB      | TypeORM + PostgreSQL               |
| Queue / cache | BullMQ + Redis                     |
| Validation    | class-validator, class-transformer |
| API docs      | Swagger / OpenAPI                  |
| Testing       | Jest, Supertest, k6                |

## How It Works

```
Client app ──GET /v1/configs/{project_id}──▶ CDN ──(miss)──▶ NestJS ──▶ Redis ──▶ PostgreSQL
                  X-SDK-Key                    ▲                                    │
                                               └────── purge job (BullMQ) ◀── write ┘
```

Every change made in the dashboard rebuilds a single JSON **snapshot** for that environment inside the same database transaction. The public endpoint serves that snapshot with `ETag` and cache headers, and a BullMQ job purges the CDN so changes show up in seconds.

## Quick Look at the API

**Read config (public)**

```bash
curl -H "X-SDK-Key: fl_pk_xxxxxxxx" \
  https://api.example.com/v1/configs/3f1c2c9e-7a3b-4f2f-9d55-0c1a8d6e1b11
```

```json
{
  "projectId": "3f1c2c9e-7a3b-4f2f-9d55-0c1a8d6e1b11",
  "environment": "production",
  "version": 42,
  "updatedAt": "2026-10-21T10:15:00.000Z",
  "flags": { "new_checkout": { "enabled": true, "rollout": 25 } },
  "configs": { "api_timeout_ms": 3000 }
}
```

**Check a flag in your app**

```ts
const on = isEnabled(snapshot, 'new_checkout', currentUser.id);
// on = enabled && murmur3_32(`new_checkout:${userId}`) % 100 < rollout
```

> SDK keys are public (they ship to browsers). **Never store secrets in configs.**

The full contract is in [`docs/03`](./docs/03-application-feature-requirement-specification-AFRS.md#5-api-contract).

## Documentation

All planning documents live in [`docs/`](./docs):

| #   | Document                                                                                                                | What it answers                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 01  | [Confirmed Decisions & Working Assumptions](./docs/01-confirmed-decisions-and-assumptions.md)                           | What is decided, what is assumed, what is out of scope    |
| 02  | [Requirement Discovery Meeting (RDM)](./docs/02-requirement-discovery-meeting-RDM.md)                                   | Discovery questions, scope, risks, action items           |
| 03  | [Application Feature Requirement Specification (AFRS)](./docs/03-application-feature-requirement-specification-AFRS.md) | Functional/non-functional requirements and API contract   |
| 04  | [Data Flow Diagram (DFD)](./docs/04-data-flow-diagram-DFD.md)                                                           | How data moves between clients, API, Redis, Postgres, CDN |
| 05  | [User Journey Technical Flow (UJTF)](./docs/05-user-journey-technical-flow-UJTF.md)                                     | Step-by-step technical flow for each user journey         |
| 06  | [Database Schema Planning (DSP)](./docs/06-database-schema-planning-DSP.md)                                             | ERD, tables, indexes, migrations                          |
| 07  | [Test Data Preparation (TDP)](./docs/07-test-data-preparation-TDP.md)                                                   | Seed data, test matrix, factories, load tests             |

**Suggested reading order:** 01 → 03 → 06 → 05 → 04 → 07 (use 02 as the meeting template).

## Planned Project Structure

```
.
├── README.md
├── docs/                      # planning documents (this set)
├── src/
│   ├── auth/                  # users, refresh tokens, guards
│   ├── projects/              # projects + environments
│   ├── api-keys/              # SDK key lifecycle
│   ├── items/                 # flags/configs, values, toggle, promote
│   ├── snapshots/             # snapshot builder + Redis cache + ETag
│   ├── public-config/         # GET /v1/configs/:projectId
│   ├── audit/                 # audit log
│   ├── queues/                # BullMQ processors
│   ├── common/                # pipes, filters, interceptors, throttling
│   └── database/              # migrations, seeds
├── test/                      # factories, fixtures, e2e
├── docker-compose.yml         # local Postgres + Redis
└── .env.example
```

## Getting Started (planned)

**Prerequisites:** Node.js 20+, Docker (for Postgres and Redis).

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres + Redis
docker compose up -d

# 3. Configure environment
cp .env.example .env

# 4. Run migrations and seed demo data
npm run migration:run
npm run seed:dev

# 5. Start the API
npm run start:dev
```

Swagger UI will be served at `http://localhost:3000/docs`.

### Environment Variables (planned)

| Variable             | Example                                                | Description                   |
| -------------------- | ------------------------------------------------------ | ----------------------------- |
| `PORT`               | `3000`                                                 | HTTP port                     |
| `DATABASE_URL`       | `postgres://flaglite:flaglite@localhost:5432/flaglite` | PostgreSQL connection         |
| `REDIS_URL`          | `redis://localhost:6379`                               | Cache + BullMQ                |
| `JWT_ACCESS_SECRET`  | `change-me`                                            | Access token signing secret   |
| `JWT_REFRESH_SECRET` | `change-me-too`                                        | Refresh token signing secret  |
| `JWT_ACCESS_TTL`     | `15m`                                                  | Access token lifetime         |
| `JWT_REFRESH_TTL`    | `30d`                                                  | Refresh token lifetime        |
| `CDN_PURGE_URL`      | _provider specific_                                    | CDN purge endpoint (optional) |
| `CDN_PURGE_TOKEN`    | _provider specific_                                    | CDN API token (optional)      |
| `PUBLIC_BASE_URL`    | `https://api.example.com`                              | Used to build URLs to purge   |

### Scripts (planned)

| Script                                                              | Purpose                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run start:dev`                                                 | Run with watch mode                                                             |
| `npm run migration:generate` / `migration:run` / `migration:revert` | TypeORM migrations                                                              |
| `npm run seed:dev`                                                  | Seed the demo scenario from [`docs/07`](./docs/07-test-data-preparation-TDP.md) |
| `npm test` / `npm run test:e2e`                                     | Unit and e2e tests                                                              |
| `npm run test:update-fixtures`                                      | Regenerate golden snapshot fixtures                                             |

## Roadmap

- [x] Planning documents
- [ ] Project skeleton, config, health checks
- [ ] Auth (register, login, refresh)
- [ ] Projects, environments, SDK keys
- [ ] Items, values, toggle, audit log
- [ ] Snapshot builder + public endpoint + caching
- [ ] BullMQ cache purge
- [ ] Promote staging → production
- [ ] Rollout percentage + tiny TS SDK helper
- [ ] Minimal dashboard UI (separate SPA)
- [ ] v2 candidates: webhooks/SSE, config history, teams, GraphQL

## Contributing

1. Read docs 01 and 03 first.
2. Any change to scope, API, or schema must update the matching doc in the same pull request.
3. Keep migrations small, reversible, and never edit one after it is merged.

## License

_To be decided (MIT is a common choice for projects like this)._
