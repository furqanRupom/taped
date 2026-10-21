# 02 — Requirement Discovery Meeting (RDM)

**Project:** Taped, a lightweight feature flag & dynamic config API
**Status:** Pre-filled draft. Answers marked ⚠️ are _working answers_ taken from the brief and must be confirmed in the actual meeting.

---

## 1. Meeting Details

| Field                    | Value                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| Date / time              | _to be filled_                                                            |
| Duration                 | 60 min                                                                    |
| Attendees                | Product owner (you), backend developer, UI developer (if separate)        |
| Facilitator / note-taker | _to be filled_                                                            |
| Goal                     | Agree on MVP scope, the public API contract, and the data model direction |

---

## 2. Problem Statement

Hardcoded flags require a full redeploy to change. Managed services such as LaunchDarkly are powerful but expensive and over-featured for small projects. Solo developers need a **cheap, fast, minimal** way to turn features on/off, roll them out gradually, and change runtime config without shipping code.

**Success looks like:** a developer creates a project, copies one SDK key, and can flip a flag from the dashboard and see the effect in their app within seconds.

---

## 3. Agenda

1. Problem and target user (5 min)
2. Scope walkthrough: must / should / won't (15 min)
3. Public read API behaviour and caching (15 min)
4. Management API and UI needs (10 min)
5. Non-functional expectations (5 min)
6. Risks, open questions, action items (10 min)

---

## 4. Discovery Questions & Working Answers

### 4.1 Users & usage

| #   | Question                            | Working answer                                        | Status |
| --- | ----------------------------------- | ----------------------------------------------------- | ------ |
| 1   | Who is the primary user?            | Solo/indie developers with 1–5 apps.                  | ⚠️     |
| 2   | Will teams ever share a project?    | Not in MVP; single owner.                             | ⚠️     |
| 3   | How many flags/configs per project? | Up to ~200.                                           | ⚠️     |
| 4   | Which clients consume it?           | Browser/mobile frontends and backends via plain HTTP. | ⚠️     |

### 4.2 Functional scope

| #   | Question                           | Working answer                                                   | Status            |
| --- | ---------------------------------- | ---------------------------------------------------------------- | ----------------- |
| 5   | Which value types?                 | boolean, string, number, json.                                   | ⚠️                |
| 6   | Which environments?                | `production`, `staging` only.                                    | Confirmed (brief) |
| 7   | Gradual rollout needed?            | Yes, percentage rollout on boolean flags, client-side bucketing. | ⚠️                |
| 8   | User targeting rules?              | No.                                                              | ⚠️                |
| 9   | Promote staging → production?      | Yes, as a "Should have".                                         | ⚠️                |
| 10  | Audit trail?                       | Yes, simple who/what/when with before/after.                     | ⚠️                |
| 11  | Config version history & rollback? | Not in MVP (audit log only).                                     | ⚠️                |

### 4.3 Delivery & performance

| #   | Question                          | Working answer                                   | Status                                  |
| --- | --------------------------------- | ------------------------------------------------ | --------------------------------------- |
| 12  | REST or GraphQL?                  | REST first: `GET /v1/configs/{project_id}`.      | Confirmed (brief) / GraphQL deferred ⚠️ |
| 13  | How fast must a toggle propagate? | < 5 s with CDN purge, < 60 s worst case.         | ⚠️                                      |
| 14  | Polling or push?                  | Polling with ETag/304. Push is v2.               | ⚠️                                      |
| 15  | Expected read volume?             | Tens of thousands of reads/day, mostly CDN hits. | ⚠️                                      |

### 4.4 Security

| #   | Question                     | Working answer                     | Status |
| --- | ---------------------------- | ---------------------------------- | ------ |
| 16  | How do clients authenticate? | Env-scoped SDK key in `X-SDK-Key`. | ⚠️     |
| 17  | Can configs hold secrets?    | No. Values are treated as public.  | ⚠️     |
| 18  | How do owners log in?        | Email + password, JWT + refresh.   | ⚠️     |

### 4.5 Operations

| #   | Question        | Working answer                                         | Status |
| --- | --------------- | ------------------------------------------------------ | ------ |
| 19  | Hosting?        | Single container + managed Postgres + Redis + CDN.     | ⚠️     |
| 20  | Budget ceiling? | Roughly the price of a small VPS plus a free CDN tier. | ⚠️     |

---

## 5. Scope Summary (MoSCoW)

**Must have**

- Register/login, project CRUD
- Auto-created `production` / `staging` environments
- Create/update/delete flags and configs
- Instant toggle per environment
- SDK key creation/revocation
- Public cached read endpoint with ETag
- Audit log

**Should have**

- Percentage rollout for boolean flags
- Promote staging → production
- Optimistic concurrency on value updates

**Could have**

- Bulk import/export JSON
- Tiny JS/TS SDK helper (fetch + bucketing)

**Won't have (now)**

- Targeting rules, experiments, teams, webhooks/SSE, GraphQL, billing

---

## 6. Risks

| #   | Risk                                                 | Impact | Mitigation                                                           |
| --- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| R-1 | Aggressive caching makes "instant toggle" feel slow. | High   | Purge on write via BullMQ job with retries; short `max-age`.         |
| R-2 | Users store secrets in configs.                      | High   | Warn in UI/docs; no secret type.                                     |
| R-3 | Origin overloaded if CDN is bypassed.                | Medium | Single-row snapshot read + Redis cache + throttling.                 |
| R-4 | Scope creep toward "mini LaunchDarkly".              | Medium | Keep the out-of-scope list in doc 01 visible.                        |
| R-5 | A bad toggle breaks production.                      | Medium | Audit log, confirmation on production changes in UI, promotion flow. |

---

## 7. Decisions Made in the Meeting

_Fill in during the session. Pre-populated with the working answers above._

| #   | Decision | Owner | Date |
| --- | -------- | ----- | ---- |
| 1   |          |       |      |

---

## 8. Action Items

| #   | Action                                          | Owner         | Due |
| --- | ----------------------------------------------- | ------------- | --- |
| 1   | Confirm open questions in doc 01 §4             | Product owner |     |
| 2   | Freeze the public read API contract (doc 03 §5) | Backend       |     |
| 3   | Choose CDN and verify purge API                 | Backend       |     |
| 4   | Sketch UI screens against the management API    | UI            |     |
| 5   | Approve schema in doc 06                        | Backend       |     |

---

## 9. Next Steps

1. Update doc 01 with confirmed answers.
2. Review the AFRS (doc 03) for completeness.
3. Start the NestJS skeleton: modules, entities, migrations.
