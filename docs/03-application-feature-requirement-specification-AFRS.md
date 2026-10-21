# 03 — Application Feature Requirement Specification (AFRS)

**Project:** Taped, a lightweight feature flag & dynamic config API
**Version:** 0.1 (draft)
**Priorities:** M = Must · S = Should · C = Could

---

## 1. Overview

A minimal BaaS for boolean flags and key-value configs, organised by project and environment, served through an edge-cacheable REST endpoint and managed through a small authenticated API (consumed by a minimalist UI).

**Glossary**

| Term        | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| Project     | A container owned by one user (one app or product).                                         |
| Environment | `production` or `staging` within a project.                                                 |
| Item        | A named setting (`new_checkout`, `api_timeout_ms`) with a type.                             |
| Flag        | An item of type `boolean`.                                                                  |
| Config      | An item of type `string`, `number`, or `json`.                                              |
| Value       | An item's current value in one specific environment.                                        |
| Snapshot    | Precomputed JSON of every item value for one environment; what the public endpoint returns. |
| SDK key     | Public, environment-scoped key used to read the snapshot.                                   |

---

## 2. Functional Requirements

### 2.1 Authentication & Account (FR-AUTH)

| ID         | Requirement                                                                | Pri | Acceptance criteria                                                    |
| ---------- | -------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------- |
| FR-AUTH-01 | Register with email + password.                                            | M   | Duplicate email → `409`. Password ≥ 10 chars. Stored as argon2id hash. |
| FR-AUTH-02 | Login returns access JWT (15 min) + refresh token (30 days).               | M   | Wrong credentials → `401` with a generic message.                      |
| FR-AUTH-03 | Refresh tokens rotate on use; reuse of a rotated token revokes the family. | M   | Old token → `401` after use.                                           |
| FR-AUTH-04 | Logout revokes the refresh token.                                          | M   |                                                                        |
| FR-AUTH-05 | `GET /auth/me` returns the current user.                                   | S   |                                                                        |

### 2.2 Projects & Environments (FR-PRJ)

| ID        | Requirement                              | Pri | Acceptance criteria                                                                         |
| --------- | ---------------------------------------- | --- | ------------------------------------------------------------------------------------------- |
| FR-PRJ-01 | Create a project (name 1–60 chars).      | M   | `production` and `staging` environments are auto-created, each with an empty snapshot (v1). |
| FR-PRJ-02 | List, view, rename, delete own projects. | M   | Other users' projects → `404`. Delete cascades everything.                                  |
| FR-PRJ-03 | List a project's environments.           | M   |                                                                                             |

### 2.3 SDK Keys (FR-KEY)

| ID        | Requirement                                                | Pri | Acceptance criteria                                                   |
| --------- | ---------------------------------------------------------- | --- | --------------------------------------------------------------------- |
| FR-KEY-01 | Create an SDK key for an environment, with optional label. | M   | Plain key (`fl_pk_...`) returned **once**; only hash + prefix stored. |
| FR-KEY-02 | List keys (prefix, label, last used, revoked state).       | M   | Never returns the hash or the full key.                               |
| FR-KEY-03 | Revoke a key.                                              | M   | Revoked key → `401` on the public endpoint within the cache TTL.      |
| FR-KEY-04 | Track `last_used_at` (debounced, ≥ 1 min granularity).     | C   | Updated asynchronously, never blocks reads.                           |

### 2.4 Items: Flags & Configs (FR-ITM)

| ID        | Requirement                                                                                                                             | Pri | Acceptance criteria                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------- |
| FR-ITM-01 | Create an item with `key`, `type`, `description`.                                                                                       | M   | Key matches `^[a-z0-9][a-z0-9_.-]{0,63}$`, unique per project (`409` otherwise). Max 200 items per project. |
| FR-ITM-02 | On creation, a value row is created for every environment with a type default (`false`, `""`, `0`, `{}`) or an optional `initialValue`. | M   | Value validated against `type`.                                                                             |
| FR-ITM-03 | Update description; **type and key are immutable**.                                                                                     | M   | Attempt to change key/type → `400`.                                                                         |
| FR-ITM-04 | Delete an item (removes all environment values).                                                                                        | M   | Snapshots of all environments rebuilt.                                                                      |
| FR-ITM-05 | List/search items by key prefix and type.                                                                                               | S   | Paginated (`limit` ≤ 100).                                                                                  |

### 2.5 Values & Toggling (FR-VAL)

| ID        | Requirement                                                               | Pri | Acceptance criteria                                                          |
| --------- | ------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------- |
| FR-VAL-01 | Set an item's value in one environment (`PUT`).                           | M   | Type-checked; JSON ≤ 10 KB; rebuilds snapshot in the same DB transaction.    |
| FR-VAL-02 | Toggle a boolean flag in one call (`POST .../toggle`).                    | M   | Atomic flip; returns the new value and snapshot version.                     |
| FR-VAL-03 | Set `rolloutPercentage` (0–100) for a boolean flag.                       | S   | Integer; rejected for non-boolean items. Default 100.                        |
| FR-VAL-04 | Optimistic concurrency via `expectedVersion`.                             | S   | Stale version → `409`.                                                       |
| FR-VAL-05 | Promote values from one environment to another (all items or a key list). | S   | Runs in one transaction; target snapshot rebuilt once; audit entry per item. |

### 2.6 Public Config Delivery (FR-PUB)

| ID        | Requirement                                                             | Pri | Acceptance criteria                                          |
| --------- | ----------------------------------------------------------------------- | --- | ------------------------------------------------------------ |
| FR-PUB-01 | `GET /v1/configs/{project_id}` returns the environment snapshot.        | M   | Requires valid `X-SDK-Key`; key determines the environment.  |
| FR-PUB-02 | `ETag` + `If-None-Match` → `304`.                                       | M   | ETag = snapshot version hash.                                |
| FR-PUB-03 | Cache headers set for edge caching (see §5.3).                          | M   |                                                              |
| FR-PUB-04 | Optional `?env=` param is validated against the key's environment.      | S   | Mismatch → `403`.                                            |
| FR-PUB-05 | CORS enabled for any origin on this endpoint only.                      | M   | `GET`, `OPTIONS`; allowed header `X-SDK-Key, If-None-Match`. |
| FR-PUB-06 | Never include internal IDs, descriptions, or audit data in the payload. | M   |                                                              |

### 2.7 Cache Invalidation (FR-CCH)

| ID        | Requirement                                                                            | Pri | Acceptance criteria                                |
| --------- | -------------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| FR-CCH-01 | After a successful write, invalidate Redis snapshot cache and enqueue a CDN purge job. | M   | Job retries with exponential backoff (5 attempts). |
| FR-CCH-02 | A failed purge never fails the user's write.                                           | M   | Failure logged; TTL bounds staleness.              |

### 2.8 Audit Log (FR-AUD)

| ID        | Requirement                                                              | Pri | Acceptance criteria                              |
| --------- | ------------------------------------------------------------------------ | --- | ------------------------------------------------ |
| FR-AUD-01 | Record every mutation: actor, action, entity, before/after.              | M   | Written in the same transaction as the mutation. |
| FR-AUD-02 | List audit entries per project, newest first, filterable by environment. | M   | Cursor pagination.                               |
| FR-AUD-03 | Purge entries older than 90 days nightly.                                | S   | BullMQ repeatable job.                           |

### 2.9 Import / Export & SDK (could have)

| ID        | Requirement                                                              | Pri |
| --------- | ------------------------------------------------------------------------ | --- |
| FR-EXT-01 | Export one environment's items as JSON; import JSON into an environment. | C   |
| FR-EXT-02 | Tiny TypeScript helper: `fetchConfig()`, `isEnabled(flag, userId)`.      | C   |

---

## 3. Non-Functional Requirements

| ID     | Category       | Requirement                                                                                                                                |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-01 | Performance    | Public endpoint origin p95 < 50 ms (cache hit in Redis); CDN hit target > 95%.                                                             |
| NFR-02 | Propagation    | Toggle visible to clients < 5 s with purge, < 60 s without.                                                                                |
| NFR-03 | Availability   | 99.9% for the public endpoint; dashboard may degrade independently. Stale-while-revalidate keeps serving during origin outage.             |
| NFR-04 | Security       | HTTPS only; argon2id; JWT secrets rotated via env; input validated with class-validator (`whitelist: true`, `forbidNonWhitelisted: true`). |
| NFR-05 | Rate limiting  | Per doc 01 A-19.                                                                                                                           |
| NFR-06 | Observability  | Structured JSON logs, request IDs, `/health` and `/ready` endpoints, basic metrics (reads, 304 ratio, purge failures).                     |
| NFR-07 | Data integrity | Writes + snapshot rebuild + audit entry in a single transaction.                                                                           |
| NFR-08 | Portability    | Docker image + `docker-compose` for local Postgres/Redis.                                                                                  |
| NFR-09 | Documentation  | OpenAPI (Swagger) generated from DTOs.                                                                                                     |
| NFR-10 | Testing        | ≥ 80% coverage on services; e2e tests for every journey in doc 05.                                                                         |

---

## 4. Validation Rules (class-validator)

| Field                | Rules                                                        |
| -------------------- | ------------------------------------------------------------ |
| `email`              | `@IsEmail()`, lowercased and trimmed via `@Transform`        |
| `password`           | `@MinLength(10)`, `@MaxLength(128)`                          |
| `project.name`       | `@IsString() @Length(1, 60)`, trimmed                        |
| `item.key`           | `@Matches(/^[a-z0-9][a-z0-9_.-]{0,63}$/)`                    |
| `item.type`          | `@IsEnum(ItemType)`                                          |
| `item.description`   | `@IsOptional() @MaxLength(280)`                              |
| `value`              | Custom `@IsValueOfType()` validator keyed on the item's type |
| `rolloutPercentage`  | `@IsInt() @Min(0) @Max(100)`                                 |
| `environment` (path) | `@IsIn(['production','staging'])`                            |
| UUID params          | `ParseUUIDPipe`                                              |

---

## 5. API Contract

### 5.1 Public endpoint

```
GET /v1/configs/{project_id}[?env=production]
Headers: X-SDK-Key: fl_pk_xxxxxxxxxxxxxxxx
         If-None-Match: "42"            (optional)
```

**200 OK**

```json
{
  "projectId": "3f1c2c9e-7a3b-4f2f-9d55-0c1a8d6e1b11",
  "environment": "production",
  "version": 42,
  "updatedAt": "2026-10-21T10:15:00.000Z",
  "flags": {
    "new_checkout": { "enabled": true, "rollout": 25 },
    "beta_banner": { "enabled": false, "rollout": 100 }
  },
  "configs": {
    "api_timeout_ms": 3000,
    "welcome_message": "Hello!",
    "theme": { "primary": "#00aaff" }
  }
}
```

Rollout semantics: a flag is on for a user if `enabled === true` **and** `murmur3_32(key + ":" + userId) % 100 < rollout`. With `rollout: 100`, the bucket check is skipped.

**Errors:** `401` missing/invalid/revoked key · `403` env mismatch · `404` unknown project · `304` not modified · `429` throttled.

### 5.2 Management endpoints (Bearer JWT)

| Method               | Path                                                          | Purpose                                                   |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| POST                 | `/v1/auth/register` · `/login` · `/refresh` · `/logout`       | Auth                                                      |
| GET                  | `/v1/auth/me`                                                 | Current user                                              |
| POST / GET           | `/v1/projects`                                                | Create / list projects                                    |
| GET / PATCH / DELETE | `/v1/projects/:projectId`                                     | Project detail                                            |
| GET                  | `/v1/projects/:projectId/environments`                        | List environments                                         |
| POST / GET           | `/v1/projects/:projectId/environments/:env/api-keys`          | Create / list SDK keys                                    |
| DELETE               | `/v1/projects/:projectId/environments/:env/api-keys/:keyId`   | Revoke key                                                |
| POST / GET           | `/v1/projects/:projectId/items`                               | Create / list items (with current values per environment) |
| GET / PATCH / DELETE | `/v1/projects/:projectId/items/:key`                          | Item detail                                               |
| PUT                  | `/v1/projects/:projectId/environments/:env/items/:key`        | Set value (+ rollout)                                     |
| POST                 | `/v1/projects/:projectId/environments/:env/items/:key/toggle` | Flip a boolean                                            |
| POST                 | `/v1/projects/:projectId/promote`                             | Body: `{ from, to, keys? }`                               |
| GET                  | `/v1/projects/:projectId/audit-logs`                          | Audit entries                                             |
| GET                  | `/health` · `/ready`                                          | Probes                                                    |

### 5.3 Cache headers on the public endpoint

```
Cache-Control: public, max-age=10, s-maxage=60, stale-while-revalidate=300
ETag: "42"
Vary: X-SDK-Key
```

> The CDN must include `X-SDK-Key` in its cache key (or use a small edge worker). Verify this in the CDN setup task.

### 5.4 Standard error body

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [{ "field": "key", "constraints": ["key must match ..."] }],
  "requestId": "b4c1..."
}
```

---

## 6. Suggested NestJS Module Layout

```
src/
  auth/            users, refresh tokens, guards, strategies
  projects/        projects + environments
  api-keys/        SDK key lifecycle + SdkKeyGuard
  items/           items + values, toggle, promote
  snapshots/       snapshot builder, Redis cache, ETag logic
  public-config/   GET /v1/configs/:projectId
  audit/           audit service + queries
  queues/          BullMQ: cache-purge, audit-cleanup, last-used-flush
  common/          filters, interceptors, pipes, throttling, config
  database/        migrations, seeds
```

---

## 7. Traceability

| Journey (doc 05)                 | Requirements                                        |
| -------------------------------- | --------------------------------------------------- |
| J1 Onboarding                    | FR-AUTH-01/02, FR-PRJ-01, FR-KEY-01                 |
| J2 Create & toggle / kill switch | FR-ITM-01/02, FR-VAL-01/02/03, FR-CCH-01, FR-AUD-01 |
| J3 Client fetch & poll           | FR-PUB-01–05, FR-KEY-04                             |
| J4 Promote                       | FR-VAL-05, FR-AUD-01                                |
| J5 Rotate key                    | FR-KEY-01/03                                        |
