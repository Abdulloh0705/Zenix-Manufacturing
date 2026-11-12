# Phase 2 backend contract

The current application is a browser-only demo. Its localStorage keys separate workspaces for ordinary UI flows; they are not a security boundary or a shared database. A production implementation must move identity, tenant resolution, authorization, billing state and audit writes to a server.

## Conceptual model

| Model | Required fields and constraints |
| --- | --- |
| `users` | Global identity, unique normalized login/email, server-side password hash, status, password version. No tenant role on this row. |
| `tenants` | Immutable ID, legal/display name, status, owner membership reference, created/updated timestamps, suspension reason. |
| `tenant_memberships` | Unique `(tenant_id, user_id)`, status, tenant employee ID, role ID, branch/warehouse/department scope, start/end timestamps. |
| `roles`, `permissions` | Tenant-owned role IDs and grants; system templates cannot be edited into platform roles. Privilege changes need actor/target rank checks. |
| `branches` | Tenant ID plus branch ID; warehouses, locations and work centers carry the same tenant ID and use composite foreign keys. |
| `subscription_plans` | Versioned plan catalog, module entitlements, limits and effective dates. |
| `subscriptions` | Tenant ID, plan version, state, trial/grace/end dates, billing provider reference and verified payment state. Append changes, do not rewrite history. |
| `audit_logs` | Append-only actor, tenant, action, target, outcome, reason, timestamp, correlation ID. Platform audit uses a separate authority. |
| `sessions` | Revocable server-side session, expiry, last activity, password version, selected tenant, device metadata. Browser receives HttpOnly Secure SameSite cookie. |
| `invitations` | Tenant, email/login, proposed role/scope, single-use token hash, expiry, inviter, acceptance outcome. Delivery is an external service. |

ERP tables also need `tenant_id`: products, BOMs, routings, orders, reservations, stock balances/movements, lots/serials, suppliers/customers, ledgers, quality, maintenance, notifications and attachments. Use composite foreign keys such as `(tenant_id, product_id)` so a row cannot reference a record in another tenant. PostgreSQL row-level security can provide another layer, but service authorization and query predicates remain mandatory.

## Request and transaction boundaries

1. Authenticate the session on the server; reject expired, revoked or password-version-stale sessions.
2. Resolve the requested tenant from the authenticated membership and selected session context. Reject inactive membership or suspended tenant before loading any ERP row.
3. Check module/action permission, role rank, branch/warehouse scope and subscription entitlement on the server. Do not accept a client-submitted role, tenant ID or plan as proof of authority.
4. Execute each manufacturing command inside one database transaction with tenant-constrained reads/writes. Lock stock/reservation rows as needed; enforce nonnegative balances and references at commit.
5. Write the business result and audit event in the same transaction. Audit denied attempts separately without leaking tenant data to the caller.

Tenant switching should update server session context and invalidate tenant-scoped caches, drafts and in-flight commands. Exports and backups must require the same tenant authorization and query only that tenant's rows. Support access needs explicit approval, purpose, expiry, least privilege and immutable audit events; no unrestricted impersonation.

## Security and commercial workflows

Provision platform operators through a trusted server-side process with separate platform RBAC and strong authentication. The offline signed ticket in this frontend is only a local demo gate. Password recovery, lockout, rate limiting and one-time token replay prevention belong on the server. Use a modern server password hashing function and rotate/revoke sessions after credential changes.

Billing provider webhooks must be signature checked, idempotent and recorded transactionally before a paid entitlement activates. A button click or admin demo override cannot represent payment. API and AI usage metering must be server-side and atomic against plan quotas. Invitation delivery and acceptance need one-time tokens and a durable audit trail.

## Legacy migration

Preserve the original `zenix-manufacturing-v3-state` and its historical backups. Export a read-only snapshot, validate schema and cross-references, then bind it only to a confirmed legitimate owner and a newly created server tenant. Keep ambiguous ownership quarantined for manual resolution. Import in a transaction, retain original IDs within the tenant, and record source checksum, migration version, owner approval and audit event. Repeat runs must detect an already imported checksum and avoid duplicate rows.

## Isolation verification

Run integration tests with two tenants sharing a user but holding different roles, overlapping local record IDs and independent subscriptions. Exercise purchase → inventory → MRP → production → quality → sales → finance, then prove every row and export stays in its own tenant. Include direct API calls with forged tenant IDs, missing/disabled membership, suspended tenant, expired plan, stale session, cross-tenant foreign keys and concurrent inventory writes.

## Platform administration API (Phase 4.1 frontend contracts)

The `/platform` workspace calls these operations locally today; a server must own them. TypeScript shapes live at the end of `src/domain/platform.ts` (`PlatformOverviewContract`, `PaymentEventContract`, `InvoiceContract`, `PlatformAuditContract`, `SystemHealthContract`, `SupportChannelContract`).

| Operation | Server rule |
| --- | --- |
| `GET /platform/v1/overview` | Aggregated from tenant, membership, subscription and verified invoice tables; MRR only from verified payments. |
| `POST /platform/v1/tenants/:id/status` | Platform RBAC, reason ≥ 5 chars, idempotency key, tenant + audit row in one transaction; revoke tenant sessions on suspension. |
| `POST /platform/v1/tenants/:id/subscription-overrides` | Plan version, status (`active`/`grace`/`expired`/`suspended`, never `trial`), server-computed grace end, reason, audit. Not a payment. |
| `POST /platform/v1/tenants/:id/feature-restrictions` | Restrict or restore a plan module only; entitlement check = plan ∧ ¬restriction ∧ RBAC on every request. |
| `PUT /platform/v1/settings` | Versioned, validated policy (trial days 1–60, grace days 1–30, registration open/closed); applies to future registrations. |
| `/platform/v1/support/tickets` | Tickets linked to inbound channel messages; notes redact secrets; support access to tenant data needs consent, purpose, expiry and audit. |
| `GET /platform/v1/audit` | Append-only, hash-chained rows with server timestamp, authenticated actor, correlation ID and permitted IP/device metadata. |
| `GET /platform/v1/health` | Monitoring-agent data (API, DB, workers, error rate, uptime); never computed in the browser. |
