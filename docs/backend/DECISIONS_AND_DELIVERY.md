# ZENIX backend technical baseline and delivery gates

Status: design only. Approved direction: NestJS + PostgreSQL, modular monolith, shared-schema multi-tenant. The five policies below were accepted by the owner as initial project decisions. No backend implementation, database migration, deployment, or data import is authorized by this document alone.

Source of truth: ../BACKEND_CONTRACT.md, ../PRODUCTION_DELIVERY_PLAN.md, ../../src/types/index.ts, ../../src/domain/actions.ts, ../../src/domain/access.ts, ../../src/domain/saas.ts, ../../src/app/providers/AppProvider/AppContext.tsx, ../../src/routes/navigation.ts. This design extends those decisions and must not silently replace them.

## Non-negotiable invariants

1. All 102 current DOMAIN_ACTIONS, generic CRUD over 18 entity kinds, identity/SaaS/platform operations, read selectors, exports, notifications, backup/recovery, settings, and the 15 existing routes receive an API or explicitly documented safe production equivalent. No removal by omission.
2. The server owns identity, tenant selection, authorization, subscription, stock, cost, payment state, and audit. Browser storage remains UI preferences and unsent drafts only.
3. Every tenant ERP row has tenant_id. Composite foreign keys, tenant-constrained queries, service authorization and tested RLS jointly defend isolation.
4. Stock, reservation, LOT/serial, production output, QC release, supplier/customer ledgers, costing, registration, and verified billing are transactional and idempotent where retries can duplicate effects.
5. Frozen historical values remain immutable. Correction means linked compensating or variance entries with actor, reason, evidence, period, and correlation ID.
6. Unknown provenance, missing cost, ambiguous import ownership, unverified company identity/payment, and unreconciled finance cases stay explicitly pending; they never become approved or actual by default.
7. Platform operators have separate identity/RBAC; tenant roles, including Business Owner, cannot gain platform authority. Support reads require a tenant grant, purpose, scope, expiry, and audit.
8. The existing design language, module navigation, feature states and tested business outcomes remain stable. Production mode cannot fall back to localStorage to complete a failed server command.

## Accepted initial business decisions and exact boundaries

### FIN-01 Subcontract material return

A dispatched subcontract order cannot be cancelled as a draft. Each dispatch line freezes source LOT/serial, stock SKU, location, quantity, issue cost and original document. Its quantity must reconcile as consumed into output, physically returned unused, or documented loss. Unused returned stock enters through a new receiving and QC disposition at its frozen issue basis; damaged or missing stock becomes an evidenced loss. Supplier credit/debit is a separate payable entry. Unresolved custody blocks close and remains a reconciliation case. No invented return quantity or provenance.

### FIN-02 Post-receipt service price correction

Before any receipt, the current reasoned quote correction remains valid. After receipt, the accepted LOT unit cost and original receipt are not rewritten. A verified supplier adjustment, source currency, approved exchange rate, document date, reason, actor and source receipt create a signed delta. The delta allocates by attributable quantity to unreceived WIP, remaining inventory, and consumed/shipped cost variance. Rounding residual goes to the last allocation and the allocated sum must equal the signed delta exactly. If traceability, valuation basis, supplier evidence or period status is unclear, create an open reconciliation case; do not post an automatic valuation. Credit and debit follow the same sign convention and are reversible only by compensating entries.

### FIN-03 Provisional to final MO cost and COGS

Final QC releases a LOT at a frozen cost with actual, estimated or provisional basis. Shipment freezes the cost of each allocated LOT. When MO final actual cost becomes determinable, the difference between final and previously allocated output cost is posted as linked variance: on-hand units to inventory adjustment, work-in-progress to WIP, shipped units to COGS variance. Returns reverse the original shipment and the linked variance share. Existing entries are not edited. If provenance or actual inputs are missing, the case is unreconciled and profitability remains labelled estimated/provisional; no silent promotion to actual. Closed periods take an approved adjustment in the next open period; backdating is prohibited by default. Final allocation and period rules need finance acceptance tests before use with real data.

### FIN-04 Finance scope and future GL/tax

Release 1 includes current supplier payable, customer receivable, expenses, production cost, inventory valuation, variance and profitability. It does not claim to be a full general ledger, legal invoice system or tax filing system. Immutable financial events carry tenant, source document, currency, original amount, UZS amount, exchange-rate snapshot, accounting date, posting status and reversal link. A documented integration/export interface can later map these events to chart-of-accounts entries, tax codes and statutory documents without recomputing or erasing source events. GL/tax scope, jurisdiction and accounting-period policy remain separately approved work.

### TEN-01 Company identifier

Display/legal names may repeat and are not identity keys. Server tenant UUID is immutable. Official identity is modelled by jurisdiction, identifier type, normalized value, issuing authority, verification status, verified-at, evidence reference and expiry where relevant. Only verified identities are subject to the jurisdiction/type-specific uniqueness policy; unverified claims do not silently block unrelated registrations or become verified. Region-specific validation and billing requirements are configured per jurisdiction after legal/product review. Existing legacy tenant ownership is never inferred from matching names; historical super_admin is not automatically promoted to Business Owner.

## Preserved current rules

- Production statuses, work-order dependencies, BOM snapshots, MPS/MRP make/buy and site safety, available/reserved/quarantine math, lot/serial and variant-stock behaviour, FIFO/FEFO allocation, QC blockers, rework/scrap, maintenance capacity/OEE, and returns remain contract tests against current domain tests.
- PO dual approval threshold and creator/approver separation; reasoned overrides; role rank and scope delegation; scoped read/export projections; feature restrictions; and plan limits remain enforced server-side.
- Free/Plus/Pro/Enterprise plan versions preserve current grants and limits until a separately approved catalog change. Self-service plan selection is not payment verification. Platform overrides are auditable and are not a payment.
- Temporary employee credentials currently expire after seven days; server invitation/activation is one-time, expires no later than that window, and requires controlled delivery. Existing browser recovery keys/tickets are migration references, not production credentials.
- New tenants do not receive the historical super_admin role. If imported legacy records contain it, effective rights are view-only and ownership must be resolved explicitly.

## Modular ownership and synchronous boundaries

Identity/tenant and organization/access precede every tenant command. Catalog owns item/BOM/ECO; inventory owns stock and reservation; procurement owns PO/subcontract and asks inventory/QC/payables to post in one application transaction; manufacturing owns MO/work orders and asks inventory/QC/costing to post; sales owns SO/shipment/returns and asks inventory/receivables/costing to post; equipment owns downtime/maintenance and supplies capacity/OEE; planning reads versioned inputs and creates proposals; reporting/notifications/AI are read/event consumers; platform owns SaaS metadata and never mutates ERP tables by ordinary operator authority. Cross-module orchestration belongs to application command handlers. External email/webhook/exports run from durable outbox after commit.

## Production-safe treatment of demo controls

resetTransactions, startClean, importState, importPrivilegedState, restoreLastBackup and recoveryCopies retain a visible purpose. Demo/test workspaces may use reset and restore. Production performs export/checksum/owner confirmation, controlled import or restore with dry run, backup, dual authorization where sensitive, audit and rollback plan. It never silently clears a live tenant. The exact production UI wording and approval policy are a separate acceptance checkpoint, not a reason to drop the controls.

## Implementation phases and exit gates

0. Contract freeze: 102/102 action mapping, 18/18 entity types, provider/auth/SaaS/platform/read inventory, status and money rules, approved FIN-01..04 and TEN-01. No unmapped frontend call.
1. Foundation: migrations, identity, session, tenant, membership, role/scope/plan, audit/idempotency/RLS. Two-tenant forged-ID and cross-tenant FK tests pass.
2. Organization/catalog: branches/sites/employees, items/variants/UOM, suppliers/customers, BOM/routing/ECO. Existing validation and reference-blocking tests pass.
3. Inventory: movement, balance, reservation, LOT/serial/bin/variant, count/transfer. Concurrent write, nonnegative available, unique serial and replay tests pass.
4. Procurement and incoming QC: PO, receipt, supplier ledger/replacement, subcontract dispatch/receipt/return/corrections. Partial quantity and exact cost-allocation tests pass.
5. Planning/manufacturing: forecasts, MPS/MRP, capacity, MO/work orders, material issue/output/rework, final QC. Snapshot and cross-module transaction tests pass.
6. Sales/finance: MTS/MTO, shipment/return, customer ledger, valuation, variance and reconciliation. Inventory + payable/receivable + cost conservation and reversals pass.
7. Equipment/reporting/AI/notifications: operational parity and scoped dashboard/search/export parity pass.
8. SaaS platform: separate operator MFA, plan catalog/feature restriction, verified billing events, support grants, health/audit. Forged/replayed webhook and unauthorized support tests pass.
9. Frontend cutover and release: module-by-module API adapter, desktop/mobile E2E, optional owner-confirmed demo import, backup/restore rehearsal, observability, production build and full 102-command parity gate. No production localStorage authority.

Each phase uses a codex/ branch; never push directly to main. Work is not complete until its evidence is recorded. Hosting region, provider, payment/email services, uptime, retention and statutory tax/GL scope remain deployment decisions. There is no real customer data today; demo seed must not masquerade as production records.
