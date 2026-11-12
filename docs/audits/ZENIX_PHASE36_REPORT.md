# ZENIX Phase 3.6 implementation report

Date: 2026-11-09. Status: **PARTIAL**. The verified P1 service valuation and branch-read failures are repaired in the tested frontend flows. The frontend-only architecture cannot satisfy the remaining accounting and multi-device security requirements.

## Root causes and fixes

| Audit ID | Root cause | Implemented change |
| --- | --- | --- |
| ZA-001 | Scoped projection retained foreign employees, expenses and aggregate debt. | Projection now limits employees, branches, sites, expenses and linked ledgers; customer/supplier debt is recalculated from the visible ledger. Explicit multi-branch assignments and expense site checks apply at the domain boundary. |
| ZA-002 | Subcontract fee became period overhead instead of inventory/WIP value. | Material cost is frozen at dispatch; service amount and currency rate are frozen in UZS. Multiple keyed receipts allocate rounded cost shares. QC pass releases a valued LOT; QC scrap posts the receipt's value as loss. A reasoned price correction is permitted before first receipt; only a Draft can be cancelled without supplier material return. |
| ZA-004 | The direct registration action relied on UI field checks. | Provider and `registerCompanyOwner` validate owner name, company name, login, email and password. Duplicate login/email and concurrent in-page submission are refused. Legacy bootstrap remains compatible. |
| ZA-005 | A signed owner recovery ticket could be verified repeatedly. | A SHA-256 ticket fingerprint is persisted after use and checked before another recovery; failed persistence reports failure. Credential change invalidates older sessions. |
| ZA-006 | Expired platform session stayed on screen. | The platform view checks ticket expiry while open, removes the session, hides metadata, and verifies the signature again for writes. |
| ZA-012 | A scoped employee could be activated without a site. | Employee creation and account activation require a valid branch, work center or warehouse as appropriate. The employee form now collects primary/additional branches and compatible sites. |

Temporary employee credentials expire seven days after issue or reissue if the employee has not changed the password. Reissue resets that window and invalidates older sessions. No email or SMS delivery is claimed.

## Authorization and workspace

The existing role permissions remain the source of truth. Business Owner and delegated company Admin keep company-wide tenant administration; scoped Production Manager, Operator, QC, Maintenance and Warehouse roles now receive only assigned branch/site data. The existing Supply/Sales role has company-wide scope as defined by its system role. A manager needs explicit employee and user permissions to create/activate workers, can assign only permitted lower roles, and cannot expand a custom role beyond their own permissions or scope. The legacy `super_admin` tenant role cannot be newly assigned and is not a platform credential.

`/platform` uses a separately signed short-lived operator ticket. Tenant logins cannot open it, and the platform operator gets no manufacturing route or tenant ERP authority. The workspace displays browser-local company/subscription/audit facts and labels Billing, Support, Feature Management, Settings and System Health integrations as unavailable. It does not claim payment verification, support impersonation or server metrics.

## Subcontract cost policy and remaining work

The initial quote is recognized when materials leave stock and its converted service value is apportioned to received quantity. Accepted receipts carry their frozen unit cost into LOT issues and subsequent MO/WIP or shipment calculations; rejected receipts become a recorded scrap loss. Receipt keys prevent the same local receipt from posting twice. Legacy orders without reliable material provenance are marked estimated rather than silently backfilled.

Supplier returns after dispatch, post-receipt invoice corrections, and automatic provisional/final COGS variance journals are **open**. A sent order is therefore blocked from simple cancellation; an accepted LOT is not repriced in place. These workflows need an explicit reversal/variance ledger and rules for already consumed or sold units. No historical cost was rewritten.

## Browser demo and backend requirements

- Auth/RBAC checks, ticket consumption and receipt idempotency live in client-controlled storage. They are useful demo safeguards, not production security or cross-device guarantees.
- Tenant/account/subscription registration uses separate `localStorage` keys. Best-effort rollback cannot make these keys atomic under crashes or concurrent tabs. A backend transaction and authoritative uniqueness constraints are required.
- One-time recovery tickets require server-side atomic consumption and session revocation across devices. Employee activation needs expiring one-time server tokens and controlled delivery.
- Platform ticket authorization, audit, support access, feature flags, billing, payment verification and system health require server enforcement and integrations. No fabricated live data was introduced.
- A company-name uniqueness/identifier policy and server registry remain a product/backend decision.

## Validation

Results from the final `npm run check`: domain **426/426**, UI **79/79**, TypeScript **pass**, ESLint **pass**, production build **pass**. Final Chrome E2E desktop/mobile **27/27**; `git diff --check` **pass**. Chrome E2E required running Playwright outside the restricted local-socket sandbox; it used Playwright's isolated browser contexts. No commit, push, merge or deploy was made.

## Files changed for this phase

Core source: `src/types/index.ts`, `src/domain/access.ts`, `src/domain/actions.ts`, `src/domain/auth.ts`, `src/app/providers/AppProvider/AppContext.tsx`, `src/features/employees/pages/Employees.tsx`, `src/features/costs/pages/Costs.tsx`, `src/features/purchases/pages/Purchases.tsx`, `src/features/platform/PlatformPage.tsx`.

Tests: `tests/phase36.test.mjs`, `tests/access.test.mjs`, `tests/phase1.test.mjs`, `tests/ui/auth.test.tsx`, `tests/ui/platform.test.tsx`, `tests/ui/tenant.test.tsx`.

Records: `docs/BUG_REGISTRY.md`, `docs/AUTH.md`, `docs/audits/ZENIX_AUDIT_ISSUES.md`, `docs/audits/ZENIX_AUTH_DEEP_AUDIT.md`, `docs/audits/ZENIX_ERP_DEEP_AUDIT.md`, `docs/audits/ZENIX_RBAC_ROLE_MATRIX.md`, this report. Existing unrelated uncommitted files were preserved.

Phase 4 can build the professional Super Admin backend and the open accounting reversal/journal workflows on these explicit boundaries. This Phase 3.6 worktree is **not** production-ready authentication or accounting.
