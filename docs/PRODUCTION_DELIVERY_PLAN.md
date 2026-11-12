# ZENIX production delivery plan

Status: the frontend checkpoint is on `codex/zenix-completion`. The current application stores accounts, sessions, subscriptions, and ERP data in browser localStorage. A passing frontend build is not a production security gate.

This plan implements the existing `docs/BACKEND_CONTRACT.md`. It does not change the current UI design or domain rules. Hosting, data migration approval, payment provider, and final finance policy remain explicit decisions.

## Release invariants

- The server authenticates every request, resolves the tenant from an active membership, and checks role, scope, plan entitlement, and tenant status before returning or changing ERP data.
- All ERP tables have `tenant_id`; cross-tenant references are rejected by application checks and composite database constraints. Platform operators have separate server identities and audited authority.
- Inventory, reservation, LOT/serial, production, ledger, registration, and billing commands run transactionally with idempotency keys where retries can duplicate effects.
- Browser storage may hold UI preferences and unsent drafts. It cannot be the authority for identity, permissions, tenant state, payment, or the audit log.
- A failed migration or deployment must leave existing browser data and earlier server data readable. No import clears localStorage automatically.

## Implementation order and exit gates

1. **Preserve data and freeze contracts.** Inventory all browser keys and versions; export a read-only backup with checksum, record a schema manifest, and agree the handling of existing real users. Gate: a sample backup can be validated without modifying its source.
2. **Server identity and tenant foundation.** Add a server service (Node.js/TypeScript is proposed, pending stack choice) and PostgreSQL migrations for users, tenants, memberships, roles, sessions, invitations, audit events, and idempotency. Registration creates an owner and tenant in one transaction. Gate: two-tenant integration tests reject forged tenant IDs, role claims, missing membership, expired sessions, and cross-tenant references.
3. **ERP persistence and commands.** Move the existing pure domain rules behind server-owned data and transactional commands in this order: company master data and catalog; warehouse and purchasing; MRP/production/QC; sales, receivables, payables, and costing; HR and equipment. Gate: purchase → stock → production → QC → shipment → finance runs through the API with independent tenants and concurrent-write tests.
4. **Frontend API transition.** Replace each browser-authoritative write only after its server endpoint and tests pass. Keep current layouts, routes, and visual language. Gate: production mode has no localStorage path that can grant a role, switch tenant authority, mark a payment verified, or change stock without the server.
5. **Platform and commercial services.** Move platform operators, subscriptions, verified billing events, usage limits, support access, health, and immutable audit to server services. Email/invitation delivery and the payment provider are separate integrations. Gate: forged and replayed events are refused; entitlement changes require verified events or an audited manual override.
6. **Legacy import and rollout.** Import only a validated, owner-confirmed browser snapshot into a new server tenant. Preserve source IDs within tenant, source checksum, migration version, and import audit. Repeated imports must be idempotent. Gate: reversible rollout rehearsal, backup/restore test, full automated suites, desktop/mobile E2E, and production smoke checks.

## Decisions needed before dependent implementation

- Whether any real company data already exists in browser storage; who owns and approves each import.
- Backend/database hosting region, budget, uptime target, and access to the deployment account.
- Email/SMS provider for invitations and recovery; payment provider and currency/tax requirements.
- Finance policy for final COGS variance, subcontract return and post-receipt price differences.

Do not publish the frontend as a multi-user production SaaS until the server and release gates above pass.