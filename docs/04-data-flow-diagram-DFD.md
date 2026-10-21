# 04 — Data Flow Diagram (DFD)

**Project:** Taped
**Notation:** Mermaid (renders on GitHub/GitLab). Rounded boxes = processes, cylinders = data stores, rectangles = external entities.

---

## 1. Level 0: Context Diagram

```mermaid
flowchart LR
    DEV[/"Developer / Owner<br/>(Dashboard UI)"/]
    APP[/"Client App<br/>(frontend or backend)"/]
    CDN[/"CDN / Edge Cache"/]

    SYS(("FlagLite<br/>Config API"))

    DEV -- "register, login, manage projects,<br/>items, values, keys" --> SYS
    SYS -- "tokens, item lists, audit logs" --> DEV

    APP -- "GET /v1/configs/{project_id}<br/>+ X-SDK-Key" --> CDN
    CDN -- "cache miss / revalidate" --> SYS
    SYS -- "snapshot JSON, ETag, 304" --> CDN
    CDN -- "snapshot JSON / 304" --> APP

    SYS -- "purge request" --> CDN
```

---

## 2. Level 1: Internal Processes

```mermaid
flowchart TB
    DEV[/"Developer (UI)"/]
    APP[/"Client App"/]
    CDN[/"CDN"/]

    P1("1.0 Authenticate<br/>& Manage Account")
    P2("2.0 Manage Projects<br/>& Environments")
    P3("3.0 Manage SDK Keys")
    P4("4.0 Manage Items<br/>& Values")
    P5("5.0 Build Snapshot")
    P6("6.0 Serve Public Config")
    P7("7.0 Invalidate Caches<br/>(BullMQ worker)")
    P8("8.0 Record & Clean<br/>Audit Log")

    D1[("D1 PostgreSQL<br/>users, projects, environments,<br/>api_keys, config_items,<br/>config_values, snapshots,<br/>audit_logs, refresh_tokens")]
    D2[("D2 Redis<br/>snapshot cache, BullMQ queues,<br/>rate-limit counters")]

    DEV -- credentials --> P1
    P1 -- "JWT + refresh token" --> DEV
    P1 <--> D1

    DEV -- "project details" --> P2
    P2 <--> D1
    P2 -- "create empty snapshots" --> P5

    DEV -- "key requests" --> P3
    P3 -- "plain key (once)" --> DEV
    P3 <--> D1

    DEV -- "item / value / toggle / promote" --> P4
    P4 -- "result + snapshot version" --> DEV
    P4 <--> D1
    P4 -- "changed environment(s)" --> P5
    P4 -- "mutation details" --> P8

    P5 -- "rebuilt snapshot (in same tx)" --> D1
    P5 -- "enqueue purge" --> D2

    APP -- "request" --> CDN
    CDN -- "miss" --> P6
    P6 -- "lookup key hash" --> D1
    P6 <-- "snapshot read/write" --> D2
    P6 -- "fallback read" --> D1
    P6 -- "200 / 304" --> CDN
    CDN -- "response" --> APP

    D2 -- "purge job" --> P7
    P7 -- "delete snapshot key" --> D2
    P7 -- "purge URL(s)" --> CDN

    P8 --> D1
    D2 -- "nightly cleanup job" --> P8
```

---

## 3. Process Descriptions

| Process                   | Input                                               | Processing                                                                                           | Output                                   |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1.0 Authenticate          | email, password, refresh token                      | Validate DTO, hash/verify (argon2id), issue/rotate tokens                                            | JWT, refresh token                       |
| 2.0 Manage Projects       | project name, ids                                   | Ownership check, create project + 2 environments                                                     | Project, environments                    |
| 3.0 Manage SDK Keys       | env, label, key id                                  | Generate random key, store SHA-256 + prefix, revoke                                                  | Plain key (once), key list               |
| 4.0 Manage Items & Values | item definitions, values, toggles, promote requests | Validate types/limits, write rows in a transaction                                                   | Updated item/value, new snapshot version |
| 5.0 Build Snapshot        | environment id                                      | Read all items + values for that env, produce `flags` and `configs` JSON, bump version, compute ETag | Snapshot row                             |
| 6.0 Serve Public Config   | `X-SDK-Key`, project id, `If-None-Match`            | Hash key → find env → compare project → read snapshot (Redis → Postgres) → 200 or 304                | Snapshot JSON + cache headers            |
| 7.0 Invalidate Caches     | purge job                                           | Delete Redis key, call CDN purge API, retry on failure                                               | Fresh cache state                        |
| 8.0 Audit                 | mutation events                                     | Insert audit row (same tx as the mutation); nightly delete > 90 days                                 | Audit entries                            |

---

## 4. Data Stores

| Store | Technology | Contents                                                              | Notes                                                |
| ----- | ---------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| D1    | PostgreSQL | All durable data                                                      | Source of truth                                      |
| D2    | Redis      | `snap:{environmentId}` (TTL 5 min), BullMQ queues, throttler counters | Losing Redis never loses data; reads fall back to D1 |
| D3    | CDN cache  | Public responses per `(URL, X-SDK-Key)`                               | Purged on write; bounded by `s-maxage`               |

---

## 5. Data Dictionary of Main Flows

| Flow            | Format         | Example / key fields                                                |
| --------------- | -------------- | ------------------------------------------------------------------- |
| Credentials     | JSON           | `{ email, password }`                                               |
| Value update    | JSON           | `{ value, rolloutPercentage?, expectedVersion? }`                   |
| Promote request | JSON           | `{ from: "staging", to: "production", keys?: ["new_checkout"] }`    |
| SDK key         | string         | `fl_pk_` + 32 random base62 chars                                   |
| Snapshot        | JSON           | `{ projectId, environment, version, updatedAt, flags, configs }`    |
| Purge job       | BullMQ payload | `{ projectId, environmentId, urls[] }`                              |
| Audit entry     | row            | `{ actor, action, entityType, entityId, before, after, createdAt }` |

---

## 6. Write Path (critical flow, simplified)

```mermaid
sequenceDiagram
    participant UI as Dashboard
    participant API as NestJS API
    participant PG as PostgreSQL
    participant R as Redis / BullMQ
    participant CDN as CDN

    UI->>API: POST .../toggle (JWT)
    API->>PG: BEGIN
    API->>PG: UPDATE config_values (flip, version+1)
    API->>PG: Rebuild snapshot row (version+1, etag)
    API->>PG: INSERT audit_logs
    API->>PG: COMMIT
    API->>R: DEL snap:{env}; add job cache-purge
    API-->>UI: 200 { value, snapshotVersion }
    R->>CDN: Purge /v1/configs/{project_id}
```

## 7. Read Path (critical flow, simplified)

```mermaid
flowchart LR
    A[Client request] --> B{CDN hit?}
    B -- yes --> Z[Return cached response]
    B -- no --> C[SdkKeyGuard: hash key, load key + env]
    C -- invalid/revoked --> E[401]
    C -- ok --> D{Redis snapshot?}
    D -- yes --> F[Compare ETag]
    D -- no --> G[Read snapshots row from PG, store in Redis]
    G --> F
    F -- If-None-Match matches --> H[304]
    F -- otherwise --> I[200 + Cache-Control + ETag]
```
