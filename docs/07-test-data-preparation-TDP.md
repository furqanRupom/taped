# 07 — Test Data Preparation (TDP)

**Project:** Taped
**Goal:** Define the datasets, factories, and edge cases needed to test every requirement in doc 03 and every journey in doc 05, locally and in CI.

---

## 1. Test Strategy Overview

| Level                                                       | Tooling                                          | Data source                                 |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Unit (services, validators, bucketing helper)               | Jest                                             | In-memory objects, factories                |
| Integration (TypeORM repos, transactions, snapshot builder) | Jest + real PostgreSQL (Docker / Testcontainers) | Factories, per-test transaction or truncate |
| E2E (HTTP, guards, caching headers)                         | Jest + Supertest, Postgres + Redis containers    | Seed scenarios (§3)                         |
| Load / smoke                                                | k6                                               | Load dataset (§6)                           |

Principles:

- **Never** test against a shared or production database.
- Each test file gets a clean schema state (truncate in `beforeEach`, or run each test in a rolled-back transaction).
- Seeds are **deterministic** (fixed UUIDs, fixed timestamps) so snapshots/ETags are assertable.
- BullMQ is mocked in unit tests; e2e uses real Redis with a test-prefixed queue.

---

## 2. Fixed Identifiers

| Name                  | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| `USER_ALICE_ID`       | `00000000-0000-4000-8000-0000000000a1`                |
| `USER_BOB_ID`         | `00000000-0000-4000-8000-0000000000b1`                |
| `PROJECT_SHOP_ID`     | `10000000-0000-4000-8000-000000000001`                |
| `PROJECT_BLOG_ID`     | `10000000-0000-4000-8000-000000000002`                |
| `ENV_SHOP_PROD_ID`    | `20000000-0000-4000-8000-000000000001`                |
| `ENV_SHOP_STAGING_ID` | `20000000-0000-4000-8000-000000000002`                |
| `FROZEN_NOW`          | `2026-10-21T10:00:00.000Z` (use `jest.useFakeTimers`) |

---

## 3. Seed Scenarios

### 3.1 Users

| Alias | Email                | Password (test only) | Notes                                       |
| ----- | -------------------- | -------------------- | ------------------------------------------- |
| alice | `alice@example.test` | `CorrectHorse#2026`  | Owns both projects                          |
| bob   | `bob@example.test`   | `BatteryStaple#2026` | Owns nothing (used for authorization tests) |

### 3.2 Projects & environments

| Project | Owner | Environments                              |
| ------- | ----- | ----------------------------------------- |
| `shop`  | alice | `production`, `staging`                   |
| `blog`  | alice | `production`, `staging` (empty, no items) |

### 3.3 Items & values for project `shop`

| Key               | Type    | staging value           | production value        | production rollout |
| ----------------- | ------- | ----------------------- | ----------------------- | ------------------ |
| `new_checkout`    | boolean | `true`                  | `true`                  | 25                 |
| `beta_banner`     | boolean | `true`                  | `false`                 | 100                |
| `dark_mode`       | boolean | `false`                 | `false`                 | 100                |
| `api_timeout_ms`  | number  | `5000`                  | `3000`                  | 100                |
| `welcome_message` | string  | `"Hi (staging)"`        | `"Hello!"`              | 100                |
| `theme`           | json    | `{"primary":"#ff9900"}` | `{"primary":"#00aaff"}` | 100                |

Expected **production snapshot** (golden file `test/fixtures/shop-production.snapshot.json`):

```json
{
  "projectId": "10000000-0000-4000-8000-000000000001",
  "environment": "production",
  "version": 1,
  "updatedAt": "2026-10-21T10:00:00.000Z",
  "flags": {
    "beta_banner": { "enabled": false, "rollout": 100 },
    "dark_mode": { "enabled": false, "rollout": 100 },
    "new_checkout": { "enabled": true, "rollout": 25 }
  },
  "configs": {
    "api_timeout_ms": 3000,
    "theme": { "primary": "#00aaff" },
    "welcome_message": "Hello!"
  }
}
```

### 3.4 SDK keys

| Alias                   | Environment     | Plain key (test only)                  | State   |
| ----------------------- | --------------- | -------------------------------------- | ------- |
| `KEY_SHOP_PROD`         | production      | `fl_pk_TESTPRODKEY0000000000000000001` | active  |
| `KEY_SHOP_STAGING`      | staging         | `fl_pk_TESTSTAGKEY0000000000000000001` | active  |
| `KEY_SHOP_PROD_REVOKED` | production      | `fl_pk_TESTREVKEY00000000000000000001` | revoked |
| `KEY_BLOG_PROD`         | blog production | `fl_pk_TESTBLOGKEY0000000000000000001` | active  |

Seed stores only `sha256(plainKey)` + prefix; tests keep the plain value in a constants file.

### 3.5 Audit log seed

Three entries for `shop` (ITEM_CREATE, VALUE_SET, TOGGLE) with ascending `created_at` to test ordering and cursor pagination.

---

## 4. Test Case Matrix by Requirement

### 4.1 Auth

| Case                             | Input                       | Expected                             |
| -------------------------------- | --------------------------- | ------------------------------------ |
| Register OK                      | new email, 12-char password | `201`, hash ≠ password               |
| Duplicate email (different case) | `ALICE@example.test`        | `409` (citext)                       |
| Short password                   | 9 chars                     | `400`                                |
| Invalid email                    | `not-an-email`              | `400`                                |
| Login wrong password             |                             | `401`, same message as unknown email |
| Refresh rotation                 | use refresh token twice     | 2nd call `401`, family revoked       |
| Expired access token             | clock +16 min               | `401`                                |

### 4.2 Projects & ownership

| Case                     | Expected                                    |
| ------------------------ | ------------------------------------------- |
| Alice creates project    | Two environments + two empty snapshots (v1) |
| Bob GETs Alice's project | `404`                                       |
| Name empty / 61 chars    | `400`                                       |
| Delete project           | All child rows gone (cascade)               |

### 4.3 Items

| Case                      | Input                                                        | Expected                    |
| ------------------------- | ------------------------------------------------------------ | --------------------------- |
| Valid keys                | `a`, `new_checkout`, `x.y-z_1`, 64-char key                  | `201`                       |
| Invalid keys              | `""`, `New_Checkout`, `-start`, 65 chars, `has space`, `a/b` | `400`                       |
| Duplicate key             | `new_checkout` again                                         | `409`                       |
| 201st item                | seed 200 then add one                                        | `422`                       |
| Change key/type via PATCH |                                                              | `400`                       |
| Delete item               |                                                              | Removed from both snapshots |

### 4.4 Values, toggle, rollout

| Case                        | Input                                       | Expected                                              |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Boolean set                 | `true` / `false`                            | `200`                                                 |
| Boolean wrong type          | `"true"`, `1`, `null`                       | `400`                                                 |
| Number wrong type           | `"3000"`                                    | `400`                                                 |
| Number edge                 | `0`, `-1`, `1e9`, `NaN` (as string)         | accept first three, reject last                       |
| String edge                 | `""`, 10 000-char string                    | accept both (string limit follows JSON 10 KB)         |
| JSON valid                  | `{}` , nested object ≤ 10 KB                | `200`                                                 |
| JSON too large              | 10 KB + 1 byte                              | `413` or `400` (decide in implementation, assert one) |
| Rollout bounds              | `-1`, `0`, `100`, `101`, `12.5`             | reject, accept, accept, reject, reject                |
| Rollout on non-boolean      | `welcome_message` + `rolloutPercentage: 50` | `400`                                                 |
| Toggle boolean              | `dark_mode`                                 | value flips, snapshot version +1                      |
| Toggle non-boolean          | `api_timeout_ms`                            | `400`                                                 |
| Concurrency                 | two PUTs with same `expectedVersion`        | one `200`, one `409`                                  |
| Unknown environment in path | `/environments/dev/...`                     | `400`                                                 |

### 4.5 Promote

| Case                             | Expected                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| Promote all staging → production | production equals staging values; snapshot version +1 (once); N audit rows |
| Promote subset `["beta_banner"]` | only that key changes                                                      |
| Unknown key in list              | `404`, no changes applied                                                  |
| `from === to`                    | `400`                                                                      |

### 4.6 Public endpoint

| Case                                                            | Expected                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Valid prod key + `shop` id                                      | `200`, body equals golden snapshot, headers: `ETag`, `Cache-Control`, `Vary` |
| `If-None-Match` equal to ETag                                   | `304`, empty body                                                            |
| `If-None-Match` stale                                           | `200`                                                                        |
| No `X-SDK-Key`                                                  | `401`                                                                        |
| Revoked key                                                     | `401`                                                                        |
| Prod key + `?env=staging`                                       | `403`                                                                        |
| Prod key + `blog` project id                                    | `404`                                                                        |
| Random UUID project id                                          | `404`                                                                        |
| Non-UUID project id                                             | `400`                                                                        |
| After toggle                                                    | Next request returns new `version` and new ETag                              |
| 601st request in a minute (same key)                            | `429`                                                                        |
| CORS preflight (`OPTIONS`)                                      | `204` with allowed headers                                                   |
| Response never contains `description`, internal ids, audit data | assert via schema check                                                      |

### 4.7 Cache & queue

| Case                                                  | Expected                                           |
| ----------------------------------------------------- | -------------------------------------------------- |
| Write → Redis key deleted                             | `GET snap:{env}` is null right after               |
| Write → purge job enqueued                            | Queue has 1 job with the correct URLs              |
| Purge API fails                                       | Job retried up to 5 times; user's write unaffected |
| Redis down                                            | Public endpoint still returns `200` from Postgres  |
| Transaction rollback (force error after value update) | No snapshot change, no audit row, no job enqueued  |

### 4.8 Audit

| Case          | Expected                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Each mutation | One audit row with correct `before` / `after`                            |
| Pagination    | Cursor returns next page without duplicates                              |
| Retention job | Rows older than 90 days removed, newer kept (use `FROZEN_NOW` ± 91 days) |

### 4.9 Bucketing helper (unit)

| flagKey                         | userId                | rollout | Expected                                                               |
| ------------------------------- | --------------------- | ------- | ---------------------------------------------------------------------- |
| any                             | any                   | 0       | always `false`                                                         |
| any                             | any                   | 100     | always `true`                                                          |
| `new_checkout`                  | 10 000 sequential ids | 25      | between 23% and 27% enabled                                            |
| `new_checkout`                  | `user-1`              | 25      | same result on every call (determinism)                                |
| `new_checkout` vs `beta_banner` | `user-1`              | 25      | buckets are independent (assert at least one differs across 100 users) |

Pin the exact bucket value for 3 known `(key, userId)` pairs in a test, so an accidental hash change fails CI.

---

## 5. Factories (TypeScript)

```ts
// test/factories/index.ts
export const buildUser = (o: Partial<User> = {}): User =>
  ({
    id: randomUUID(),
    email: `user-${nanoid(6)}@example.test`,
    passwordHash: TEST_PASSWORD_HASH, // precomputed argon2id, avoids slow hashing per test
    ...o,
  }) as User;

export const buildItem = (o: Partial<ConfigItem> = {}) => ({
  id: randomUUID(),
  key: `item_${nanoid(6).toLowerCase()}`,
  type: ItemType.BOOLEAN,
  ...o,
});

export const buildValue = (o: Partial<ConfigValue> = {}) => ({
  id: randomUUID(),
  value: false,
  rolloutPercentage: 100,
  ...o,
});
```

Helpers to provide:

- `seedShopScenario(dataSource)`: inserts everything in §3 and rebuilds snapshots using the real `SnapshotService`.
- `loginAs(app, 'alice')`: returns a ready `Authorization` header.
- `resetDatabase(dataSource)`: `TRUNCATE ... RESTART IDENTITY CASCADE` for all tables.

Suggested layout:

```
test/
  factories/
  fixtures/          shop-production.snapshot.json, payloads
  helpers/           seed-shop.ts, login.ts, reset-db.ts
  e2e/               auth, projects, items, values, promote, public-config, audit
src/database/seeds/  dev-seed.ts (same scenario for local development)
```

---

## 6. Load & Performance Dataset

| Dataset      | Size                                                             | Purpose                                  |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| `load-small` | 10 projects × 50 items                                           | Baseline                                 |
| `load-max`   | 100 projects × 200 items (JSON values near 1 KB on 20% of items) | Worst-case snapshot size (~256 KB check) |
| Keys         | 1 active key per environment (2,000 total)                       | Key lookup under load                    |

k6 scenarios:

1. **Cached read:** 500 virtual users, 95% sending `If-None-Match`; expect p95 < 50 ms at origin, > 90% `304`.
2. **Cold read:** random keys, bypass CDN; expect p95 < 100 ms with Redis warm.
3. **Write burst:** 20 toggles/second on one environment; verify snapshot versions are strictly increasing with no lost updates.
4. **Throttle check:** 700 requests/minute with one key; expect `429` after 600.

---

## 7. Local Development Seed

`npm run seed:dev` runs the §3 scenario against the local database and prints:

```
Seeded users:    alice@example.test / CorrectHorse#2026
Project (shop):  10000000-0000-4000-8000-000000000001
SDK key (prod):  fl_pk_TESTPRODKEY0000000000000000001
Try: curl -H "X-SDK-Key: fl_pk_TESTPRODKEY0000000000000000001" \
     http://localhost:3000/v1/configs/10000000-0000-4000-8000-000000000001
```

Guard: the script refuses to run when `NODE_ENV=production`.

---

## 8. Test Data Hygiene Checklist

- [ ] No real emails, passwords, or keys in fixtures
- [ ] Test keys use the recognisable `TEST` marker so they are never mistaken for real ones
- [ ] Seeds are idempotent (`ON CONFLICT DO NOTHING` or truncate first)
- [ ] CI spins up fresh Postgres + Redis for every run
- [ ] Golden snapshot files updated only through an explicit `npm run test:update-fixtures`
