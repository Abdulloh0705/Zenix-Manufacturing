# ZENIX-Pro full-system audit and repair

**Date:** 2026-11-11 (Asia/Tashkent)
**Overall status:** PARTIAL. The three reported browser-demo workflows are repaired and validated. Server-backed security, atomic multi-user transactions, and exhaustive accounting coverage remain outside the current architecture.

## Checkout and data safety

- Source reviewed and changed only at `C:\Users\user\Desktop\Proyects\ZENIX-Pro`.
- This folder has no `.git` directory. `git branch`, `git status`, and `git diff --check` cannot run; the initial change set and branch cannot be established from Git. Existing files were edited in place without resetting storage or copying another checkout.
- The project is a React/TypeScript browser application. ERP, SaaS metadata, authentication hashes, and sessions are held in browser storage. No production backend or database is present. All test accounts use isolated test storage.
- Existing company records and browser data were not cleared. New-company initialization changes apply only to newly registered tenants. Historical role references remain stored.

## Priority checkpoint

| Priority | Reported problem | Status | Regression evidence |
| --- | --- | --- | --- |
| P1 | Platform Super Admin appears in tenant roles | Fixed in current UI/domain demo | Domain role-forgery test, UI role-list test, registration desktop/mobile E2E |
| P1 | New business receives unrelated data | Fixed for tested creation/hydration paths | Domain empty-tenant test, UI registration test, desktop/mobile E2E, tenant-isolation E2E |
| P1 | Assigned employee cannot obtain login | Fixed for tested profile/account paths | UI activation/retry tests, desktop/mobile login and forced-password-change E2E |

### What changed

1. New tenant state omits the historical `super_admin` role. Schema-v7 hydration no longer re-adds it. Admin and Employees role catalogs hide that legacy role, including direct role deep links. Domain actions reject assignment, copying the legacy role, and any permission outside the company permission catalog. `/platform` remains under its separate signed-ticket gate.
2. Registration still builds a new tenant from `createEmptyTenantState`: one owner, required company roles, one basic branch and empty warehouse, empty products, suppliers, customers, orders, stock, time logs and other operational collections. The branch and empty warehouse are functional scaffolding. Tenant UUID storage keys and membership checks preserve older tenant state. No data deletion or automatic demo import was added.
3. Employees now shows branch, login and account status. Creating a profile offers the account step immediately; existing profiles can use Create Login from user management. Successful creation displays the generated temporary password once to the creator. The domain already forces password change, expires unused temporary credentials after seven days, blocks archived/disabled users, checks role and site scope, and rejects duplicate identifiers. Account reset remains an authorized local-demo action.
4. If the combined user form saves a profile but account creation fails, retry reuses the saved profile. The form now waits for the asynchronous result rather than treating the attempt as a successful submit.
5. Future migration of old `super_admin` assignments keeps their historical role read only; it no longer silently promotes them to `business_owner`. Accounts migrated by an earlier release are not automatically demoted or rewritten.

## Confirmed issues in this checkout

| ID | Severity | Module | Minimal reproduction and root cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| ZP-001 | P1 | Roles/RBAC | Open Admin or Employees Roles with legacy state: the full `s.roles` array rendered `Eski Super Admin`; copy action could target it. | Filter tenant catalogs; block legacy copy and unknown permission keys at domain boundary. | Fixed, domain/UI tests |
| ZP-002 | P1 | Registration/hydration | Register a second company, reload: migration treated the intentionally absent legacy role as an old schema gap and restored it. | Current-schema migration accepts the clean role catalog; new tenant constructor removes the legacy role. | Fixed, desktop/mobile E2E |
| ZP-003 | P1 | Employees/auth | Create an employee from Employees: profile saved with no offered login step or credential handoff. | Continue into Create Login, show one-time credentials and account state. | Fixed, desktop/mobile E2E |
| ZP-004 | P2 | User creation | Create a new profile with invalid account email, correct it and retry: the form attempted to create another profile. | Hold the pending profile ID across retries and await the async outcome. | Fixed, UI regression |
| ZP-005 | P2 | Legacy migration | Migrate a schema-v5 employee assigned `role0`: v6 silently changed their assignment to privileged Business Owner. | Preserve assignment and records; keep legacy role read only. | Fixed for future migrations, domain regression |

All five are verified defects, all five are repaired for the current browser implementation. ZP-005 cannot reverse promotions already persisted by older builds without an explicit identity review.

## Coverage matrix

| Area | Source and workflow coverage in this audit | Evidence and limits |
| --- | --- | --- |
| Authentication | `domain/auth.ts`, `AuthPages`, `AppContext`, setup, registration, account creation, expiry, recovery and logout paths reviewed | 437 domain and 95 UI tests; registration E2E. Real delivery and cross-device revocation need backend. |
| Authorization/RBAC | `domain/access.ts`, `actions.ts`, both role screens, action rules and scope checks reviewed | Forged platform permission/assignment regressions; browser platform gate E2E. Client storage is mutable. |
| Multi-tenant | `domain/saas.ts`, `migrations.ts`, `persistence.ts`, tenant provider and registration writes reviewed | New tenant, reload, switching and stale-tab browser scenarios passed. Multi-key commits are not database transactions. |
| Manufacturing/MRP/MES | Products, BOM, production, planning, execution, QC and maintenance source/tests surveyed | Domain suite covers snapshots, MRP, execution, scrap, rework and QC; Shop Floor browser workflow passed. Arbitrary concurrent operations unverified. |
| Inventory/warehouse | Inventory engine, stock actions, LOT/serial tests and warehouse UI surveyed | Domain suite and receipt/transfer/QC browser scenarios passed. Server-enforced stock serialization absent. |
| Procurement/sales | Purchase, supplier, sales, return, receivable and payable actions/tests surveyed | Partial receipt/QC and customer browser workflows passed. External invoices and payments are demo behavior. |
| Finance/costing | `payables.ts`, `receivables.ts`, `profitability.ts`, prior phase-3.6 reports and costing tests reviewed | Tested accounting scenarios pass; final COGS variance policy and full GL remain open design work. |
| Employees/HR | Employee profile, role/scope, account linking, time logs and activation UI reviewed | New profile, existing-profile activation, temporary password, retry and first login covered. Attendance is not a complete payroll system. |
| Platform | Platform page/domain, ticket gate, plans, subscription, support, audit and health views surveyed | Desktop/mobile platform browser tests passed. Billing/support are local demo records, without trusted server enforcement. |
| UI/UX | Route guards, tables, filters, modals, search, empty states, theme and responsive smoke flows surveyed | 95 UI tests and desktop/mobile E2E; no exhaustive screen-reader or every viewport/interaction audit. |

This is module-by-module source/test coverage, not a claim that every branch of every module was exercised.

## Validation actually executed

- `npm run check`: PASS. TypeScript PASS; ESLint PASS; domain **437/437**; UI **95/95**; production Vite build PASS.
- `PW_CHANNEL=chrome PW_PORT=4181 npm run test:e2e`: **37/37 PASS**, including setup, desktop and mobile projects.
- `git diff --check`: unavailable because the requested folder is not a Git checkout.
- Initial E2E attempts failed before browser assertions because port 4179 was occupied and Playwright's bundled Chromium was absent. The config now accepts `PW_PORT`; the successful run used installed Chrome. A later desktop-only regression run passed 4/4 before the full run.

## Remaining work and architecture limits

- **Backend required:** browser localStorage is controlled by the browser user. Tenant and platform authorization, audit, subscription state, rate limiting, shared credentials and data isolation require trusted server identity and database constraints. Current guards are useful integrity checks for this local demo, not production SaaS security.
- **Backend required:** registration spans several storage keys and cannot guarantee all-or-nothing writes after a crash or concurrent-tab interleaving. Inventory, LOT/serial and ledger actions also need server transactions and idempotency for multiple users.
- **Finance design:** final COGS variance reconciliation and a general ledger are not implemented. Prior `docs/BUG_REGISTRY.md` and phase-3.6 reports describe the current subcontract allocation and remaining accounting policy questions.
- **Legacy role recovery:** historical `super_admin` memberships remain read only; an authorized, explicit owner-recovery procedure is needed for a genuinely ownerless legacy tenant. Existing prior-release promotions must be reviewed case by case, without automatic demotion.
- **Verification limits:** real business data, every role/export combination, full keyboard/screen-reader coverage, external payment/delivery integrations, and concurrent multi-device behavior were not tested. Existing audit documents contain earlier findings; their historical baseline text should not be read as the current state where the bug registry marks later fixes.

## Files changed

`src/data/mockData.ts`, `src/domain/migrations.ts`, `src/domain/access.ts`, `src/domain/actions.ts`, `src/features/admin/pages/Admin.tsx`, `src/features/employees/pages/Employees.tsx`, `playwright.config.ts`, `tests/saas.test.mjs`, `tests/access.test.mjs`, `tests/ui/registration.test.tsx`, `tests/ui/phase33.test.tsx`, `e2e/registration.spec.ts`, this report, `docs/audits/ZENIX_AUDIT_ISSUES.md`, and `docs/BUG_REGISTRY.md`.
