# ZENIX ERP/MRP/MES deep audit

**Date/source:** 2026-11-09 current `main` worktree plus uncommitted changes. **Status: PARTIAL.** The current domain suite passed 417/417, UI 77/77, and Chrome E2E result is in `ZENIX_SOURCE_MANIFEST.md`. Tests establish the listed scenarios, not full operational correctness. Previous Phase 3.2–3.4 reports were treated as historical evidence and checked against current source/tests.

## Module and workflow coverage

| Area | Implemented path and source | Current evidence | Limit |
| --- | --- | --- | --- |
| Dashboard/KPI | `src/domain/dashboard.ts`, `src/features/dashboard/pages/Dashboard.tsx` | `tests/dashboard.test.mjs`; domain suite PASS | All report totals were not independently reconciled against ledger in this audit |
| Products/variants | `src/domain/actions.ts`, `src/features/products/`, `src/types/index.ts` | `tests/phase2.test.mjs`, `inventoryPhase3.test.mjs` PASS | Full BOM variant UI matrix not rerun |
| BOM/routing | `src/domain/manufacturingEngine.ts`, `planning.ts`, `src/features/products/components/BomEditor.tsx` | Phase 2/3.1 domain tests PASS | No randomized multi-level BOM property test |
| Production/MES | `src/domain/productionControl.ts`, `actions.ts`, `src/features/production/` | `workflows`, `phase31`, `productionControl` PASS | Hardware/shop-floor integration absent |
| MRP/MPS | `src/domain/planning.ts`, `manufacturingEngine.ts` | `phase2`, `phase31`, `planning` scenarios PASS | Demand forecast/capacity accuracy not independently rederived for every product |
| Warehouse/LOT/serial | `src/domain/inventory.ts`, `serials.ts`, `actions.ts` | `inventoryPhase3`, `phase5final`, `scopeStock` PASS | Browser quota and multi-user concurrency remain |
| Purchases/suppliers | `src/domain/payables.ts`, `supplierMaterials.ts`, `actions.ts` | `phase3`, `phase31`, `supplierMaterials` PASS | N-07 subcontract cost ZA-002 |
| Sales/customers | `src/domain/receivables.ts`, `profitability.ts`, `actions.ts` | `phase1`, `phase4`, `phase31`, `profitability` PASS | No external billing integration |
| Quality/CAPA | `src/domain/actions.ts`, `src/features/quality/` | `phase3`, `phase5`, `bugRegistry` PASS | No full manual CAPA lifecycle audit |
| Equipment/OEE | `src/domain/maintenance.ts`, `manufacturingEngine.ts`, `src/features/equipment/` | `phase4`, `phase5final`, earlier Chrome deep link PASS | Maintenance UI transaction E2E not independently rerun |
| Finance/costing | `src/domain/payables.ts`, `receivables.ts`, `profitability.ts` | Ledger and COGS tests PASS | Subcontract capitalization ZA-002; variance reconciliation ZA-008; GL absent |
| Reports/exports/traceability | `src/features/reports/`, `src/utils/exportData.ts`, `src/domain/serials.ts` | `dashboard`, `phase4`, `phase5final` PASS | Every export file/role/tenant combination unverified; ZA-001 can affect scope |
| AI/notifications | `src/domain/insights.ts`, `notifications.ts`, `src/features/ai/` | Notification tests PASS; AI is rule-based | AI answer correctness and tenant context not independently checked |

## Core integrity invariants

The domain actions combine permission checks (`src/domain/access.ts:74-116,356-364`) with stock/ledger logic. Existing tests cover purchase receipt → QC/quarantine → payable, material reservation/issue → output/scrap/rework → final QC, sales reserve/deliver → receivable/payment/return, LOT/serial lineage and duplicate idempotency keys. `tests/phase31.test.mjs`, `tests/workflows.test.mjs`, `tests/inventoryPhase3.test.mjs`, `tests/phase5final.test.mjs` and `tests/phase34.test.mjs` passed in the current suite. Historical Phase 3.2 stock and ledger probes are described in `PHASE32_AUDIT.md:5-8`, but were not independently rerun as a new end-to-end invariant probe. Therefore stock balance/movement, duplicate reservation and reversal are **verified only for their tested scenarios**, not for arbitrary concurrent operations.

The previous MO unknown-status, sales cancel-after-delivery, employee dangling-reference and backup escalation defects have Phase 3.3 regression tests and the current suite passes (`tests/phase33.test.mjs`). Phase 3.4 freezes cost at Final QC and labels provisional shipments; tests pass (`tests/phase34.test.mjs`). They are historical fixes, not new open issues. A browser-only state file cannot provide atomic stock reservations, serial uniqueness or supplier/customer ledger posting across multiple users/devices (ZA-003). `docs/BACKEND_CONTRACT.md` specifies server transactions and tenant-constrained foreign keys.

## Current material gaps

**ZA-002, subcontract costing:** `src/domain/actions.ts:4097-4140` receives subcontracted goods and posts service fee as `Overhead`; it is not allocated to LOT/MO cost. The BUG registry labels N-07 PARTIAL (`docs/BUG_REGISTRY.md:98`). This materially understates item cost and margin when subcontract service is part of production. Partial acceptance is also not modeled at the service-cost level. Finance needs to define allocation/reversal before implementation.

**ZA-008, provisional/final COGS:** Final QC release freezes sellable LOT cost, and shipment movements retain that amount. MO close may produce a different final snapshot, but no variance/revaluation ledger resolves the difference. `src/domain/profitability.ts:7-66`, `tests/phase34.test.mjs:41-49` and `PHASE34_FINAL_READINESS.md` support this. It is a missing accounting policy, not a regression in provisional labelling.

**ZA-001, branch read scope:** `src/domain/access.ts:453-519` filters many operational records but leaves employees and some financial/master data global. A synthetic branch manager probe returned a branch B employee and all 18 expenses in branch A's view. Report/export paths should be evaluated for the same disclosure. No cross-tenant data appeared in the existing two-tenant tests, but there is no server tenant boundary (ZA-003).

## Platform and production readiness

The current platform page lists companies, filters plans/status, suspends/reactivates and writes demo subscription overrides with reason and local event history (`src/features/platform/PlatformPage.tsx:58-66`, `src/domain/saas.ts:90-100`). It does not have billing verification, support grants, immutable audit or server session enforcement (ZA-003/ZA-011). The ticket is rechecked on mutation; idle platform metadata remains visible after ticket expiry (ZA-006). Company ERP records are not exposed through the platform page's supported UI.

Production backend prerequisites: global identities and tenant memberships; server-side auth, role/scope and subscription checks; database tenant IDs and composite foreign keys; transactional inventory, reservation, LOT/serial, payables and receivables; unique idempotency keys; immutable audit; verified payment events; controlled support access. `docs/BACKEND_CONTRACT.md` provides a design starting point, but implementation and integration tests are absent.

## Explicitly unverified

- Randomized or concurrent stock/ledger operations and multi-device state reconciliation.
- Every warehouse/branch role's export contents; every report KPI against raw transaction ledger.
- AI answer accuracy, all notification edge cases, exhaustive CAPA/maintenance UI operations.
- Real payment, platform support, external API, barcode/RF and production database behavior (not implemented).
- Real customer/business data: excluded by audit rule. All reproduction descriptions use synthetic data.

## Phase 3.6 addendum

The ZA-002 subcontract service exclusion is repaired for new and costed seed orders: dispatch freezes material value and UZS service quote, keyed partial receipts allocate both, and QC accept/scrap decides LOT release or loss. Quote correction before first receipt and Draft cancellation are reasoned and audited. Supplier returns, post-receipt variance posting and final COGS reconciliation remain open rather than changing historical LOTs without evidence. See `ZENIX_PHASE36_REPORT.md`.
