# 01 — Confirmed Decisions & Working Assumptions

**Project (working name):** Taped, a lightweight feature flag & dynamic config API
**Status:** Draft v0.1
**Stack:** NestJS · TypeORM · PostgreSQL · BullMQ (Redis) · class-validator · class-transformer

> Purpose of this file: one place that separates what is **decided** from what is only **assumed**, so nobody builds on a guess without knowing it is a guess. If an assumption changes, update it here first, then update the other docs.

---

## 1. Confirmed Decisions (from the project brief)

| ID   | Decision                                                                                              | Notes                                                    |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| C-01 | The product stores **boolean flags** and **key-value configs only**.                                  | No targeting rules engine, no experiments, no analytics. |
| C-02 | Data is organised **per environment**: `production` and `staging`.                                    |                                                          |
| C-03 | Clients read config through an **edge-cacheable REST endpoint**: `GET /v1/configs/{project_id}`.      | Polled or fetched on app load.                           |
| C-04 | A **minimal UI** lets the owner toggle flags instantly.                                               |                                                          |
| C-05 | Tech stack is NestJS, TypeORM, PostgreSQL, BullMQ (if necessary), class-validator, class-transformer. |                                                          |
| C-06 | Audience is **solo / indie developers**; cost and simplicity beat features.                           | Drives every "keep it small" choice below.               |

---

## 2. Working Assumptions (to be confirmed)

| ID   | Assumption                                                                                                                                                                                                                     | Why                                                                                          | Revisit when                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A-01 | **REST only** in the MVP. GraphQL is deferred.                                                                                                                                                                                 | One cacheable GET covers the core use case; GraphQL adds complexity and weakens CDN caching. | Users ask for partial field selection.                                                     |
| A-02 | **Redis is included** (BullMQ + snapshot cache).                                                                                                                                                                               | Needed for retryable CDN purge jobs and scheduled cleanup.                                   | If you want zero Redis, replace with an in-process LRU cache and a synchronous purge call. |
| A-03 | Supported value types: `boolean`, `string`, `number`, `json`. A "flag" is a `boolean` item; everything else is a "config".                                                                                                     | Matches the "boolean flags and key-value configs" brief.                                     |                                                                                            |
| A-04 | Every project is auto-created with exactly two environments: `production`, `staging`. Custom environments are out of scope, but the schema allows them.                                                                        | Keeps UI and promotion flow trivial.                                                         | Users want `dev`, `qa`, `preview`.                                                         |
| A-05 | Reads are authenticated with an **environment-scoped SDK key** sent as `X-SDK-Key`. The key is **public by design** (it ships to browsers).                                                                                    | Key identifies the environment and allows revocation.                                        |                                                                                            |
| A-06 | **Never store secrets** in configs. This is documented clearly in the UI and README.                                                                                                                                           | Because SDK keys are public, config values are effectively public.                           | A private "server key" tier is added.                                                      |
| A-07 | Dashboard auth: email + password (argon2id), JWT access token (15 min) + rotating refresh token (30 days).                                                                                                                     | Simple, no third-party dependency.                                                           | OAuth (GitHub) requested.                                                                  |
| A-08 | **One owner per project**. No teams, roles, or invites in the MVP.                                                                                                                                                             | Solo-dev focus.                                                                              | First request for collaborators.                                                           |
| A-09 | **Snapshot model:** on every write, the full environment config is rebuilt into one JSON snapshot row and served as-is.                                                                                                        | Makes reads a single primary-key lookup, easy to cache and ETag.                             | Snapshots exceed 256 KB.                                                                   |
| A-10 | Edge caching: `Cache-Control: public, max-age=10, s-maxage=60, stale-while-revalidate=300`. A write triggers a CDN purge, so the practical propagation target is **under 5 seconds** with purge, **under 60 seconds** without. | Balances "instant toggle" against cost.                                                      |                                                                                            |
| A-11 | **Gradual rollout** = optional `rollout_percentage` (0–100) on boolean flags. Bucketing is computed **client-side**: `murmur3_32(flagKey + ":" + userId) % 100 < rollout`.                                                     | Keeps the endpoint cacheable and user-agnostic.                                              | Server-side targeting is needed.                                                           |
| A-12 | Limits: 200 items per project, 10 KB per JSON value, 256 KB per snapshot, key format `^[a-z0-9][a-z0-9_.-]{0,63}$`.                                                                                                            | Protects the small Postgres instance and cache.                                              |                                                                                            |
| A-13 | Every mutation writes an **audit log** entry (who, what, before/after). Retention: 90 days, cleaned by a BullMQ repeatable job.                                                                                                | Cheap safety net for "who flipped that?"                                                     |                                                                                            |
| A-14 | Items are **hard-deleted**; the audit log keeps the last known value.                                                                                                                                                          | Avoids soft-delete complexity in unique keys.                                                |                                                                                            |
| A-15 | Public IDs are UUID v4 (the `project_id` in the URL is a UUID).                                                                                                                                                                | Non-guessable, no extra slug lookup.                                                         |                                                                                            |
| A-16 | SDK keys are stored as SHA-256 hashes plus a visible prefix and shown **once** at creation.                                                                                                                                    | Standard practice; rotation is cheap.                                                        |                                                                                            |
| A-17 | The UI is a **separate SPA** that talks only to the management API. This repo documents the API, not the UI.                                                                                                                   | Keeps the backend repo focused.                                                              |                                                                                            |
| A-18 | Deployment: one NestJS container, managed Postgres, managed Redis, CDN in front (Cloudflare or equivalent).                                                                                                                    | Lowest-cost shape that still gives edge caching.                                             |                                                                                            |
| A-19 | Rate limits: public read 600 req/min per key (CDN absorbs most), management API 120 req/min per user (`@nestjs/throttler`).                                                                                                    |                                                                                              |                                                                                            |

---

## 3. Explicitly Out of Scope (MVP)

- User-level targeting rules, segments, A/B experiments
- Webhooks and streaming/SSE updates (candidate for v2)
- Teams, roles, SSO
- GraphQL endpoint
- Billing
- Config version history/rollback beyond the audit log (v2 candidate)

---

## 4. Open Questions

1. Is a **self-hosted** option required, or is this a hosted service only?
2. Is a CDN already chosen? Purge API details depend on it.
3. Should staging → production **promotion** be MVP or v1.1? (Currently planned as "Should have".)
4. Expected scale: number of projects and requests per month? This decides whether the Redis cache is needed on day one.
5. Is the UI built by you or by someone else? This affects the API contract freeze date.

---

## 5. Change Log

| Date       | Change        | By  |
| ---------- | ------------- | --- |
| 2026-10-21 | Initial draft | —   |
