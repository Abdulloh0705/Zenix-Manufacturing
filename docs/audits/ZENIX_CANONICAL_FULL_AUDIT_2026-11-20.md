# ZENIX-Pro canonical audit — 2026-11-20

## Executive summary and verdict

**Verdict: NOT READY for production multi-tenant use.** This is a browser-only ERP demo. Identity, tenant membership, authorization, business records, subscription state, and audit records live in browser storage. The tested frontend controls protect ordinary in-app flows, but a browser user controls the storage and there is no server/database authority or transaction boundary (`src/domain/access.ts:1-3`, `src/app/providers/AppProvider/AppContext.tsx:43-47,274-286`, `src/domain/saas.ts:1`, `docs/BACKEND_CONTRACT.md:1-3`). This is an existing architecture limitation, not a newly discovered exploit against a backend.

The current worktree type-checks and lints. UI tests pass 130/130. Domain tests pass 505/506; one test fails because a fixed 2026-11-09 temporary credential is checked against the real current date. Playwright passes **63/63** across setup, desktop and mobile. The standalone Vite production build passes. No application source was intentionally edited for this audit.

## Scope, source of truth, and Git state

- Canonical and only project inspected: `C:\Users\user\Desktop\Proyects\ZENIX-Pro`.
- Exact initial working directory: `C:\Users\user\Desktop\Proyects\ZENIX-Pro`.
- Git root: `C:/Users/user/Desktop/Proyects/ZENIX-Pro`.
- Branch: `codex/zenix-completion`.
- HEAD: `9d8740024c903367fa9638a551cc2cdefa3fca64`.
- Initial file count: **233** from `rg --files -g '!node_modules' -g '!dist'`; source file count: **188** matching `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.css`, or `.html`. Git tracked count: **193**.
- Initial working tree: **43 modified tracked paths and 42 untracked paths**. The exact 85-line pre-existing status is preserved in [preexisting-status.txt](evidence/canonical_2026-11-20/preexisting-status.txt). These counts exclude this audit's new log directory and report.
- No ZIP, extracted copy, backup checkout, or previous workspace was used as an audit source. Historical audit prose in this repository was used only to search for the requested prior checklist; current conclusions below come from current source and this run's checks.

The report and logs are under `docs/audits/`. `npm ci` added ignored dependencies. Package test/build tooling also writes ignored `.test-dist`, `dist`, `test-results`, and `e2e/.auth` artifacts. The E2E suite wrote to three pre-existing untracked screenshot paths; see Finding L1.

## Routes and visible modules

`src/App.tsx:96-122` declares **22 explicit route patterns** before the catch-all, including `/platform/*`, public authentication paths, `/setup` and `/help` redirects (since 2026-11-21 `/help` is the Help Center page, see "Help & Guidance" below), the dashboard, and 15 module pages. `src/routes/navigation.ts:7-26` defines 15 sidebar entries and numerous legacy redirects. The desktop/mobile smoke loop directly probes **8 of the 16 tenant dashboard/module route paths** (`/` plus seven modules, `e2e/smoke.spec.ts:16-28`). Other browser tests directly navigate platform, login/registration, employees, admin, costs, subscription, sales, and more; the suite does **not** instrument a distinct-route coverage counter, so 8/16 is the verified systematic route sweep, not the total distinct paths visited. The ten platform sections are rendered by one `/platform/*` route and are iterated by `e2e/platform.spec.ts:78-105`.

The browser suite exercises selected forms, drawers, dialogs, table actions, filters, CSV export, search, deep links, and desktop/mobile layouts. It does not constitute every control on every subview, a keyboard-only journey, a screen-reader audit, or a full role-by-route sweep.

## Discovered role and permission matrix

This table was generated from the current `SYSTEM_ROLES`, `PERMISSION_MODULES`, and `hasPermission` exports in `src/domain/access.ts:13-59,665-681` after bundling the current source. `V` view, `C` create, `E` edit, `D` delete, `A` approve, `X` export, `R` execute; `—` means no grant. A grant is additionally subject to a named command rule, scope, membership/session, and plan entitlement. The legacy `super_admin` tenant role is view-only in the effective function and is not a platform operator. Custom roles start without fixed grants; their stored permissions, rank, and scope determine access. Platform identity is a separate signed ticket gate.

| Module | Legacy | Owner | Admin | Prod mgr | Operator | Quality | Maintenance | Warehouse | Supply/sales |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production | V | VCEDAXR | VCEDAXR | VCEDAXR | VR | V | V | V | V |
| products | V | VCEDAX | VCEDAX | VCEDAX | V | V | — | V | V |
| materials | V | VCEDX | VCEDX | VCEDX | — | — | V | VX | VEX |
| warehouse | V | VCEDX | VCEDX | VEX | — | V | V | VCEDX | V |
| purchases | V | VCEDAX | VCEDAX | VCX | — | V | — | VE | VCEDAX |
| sales | V | VCEDAX | VCEDAX | VX | — | V | — | VE | VCEDAX |
| quality | V | VCEDAX | VCEDAX | VCX | VC | VCEDAX | — | V | — |
| equipment | V | VCEDAX | VCEDAX | VCEX | VC | — | VCEDAX | — | — |
| employees | V | VCEDX | VCEDX | V | — | — | — | — | — |
| costs | V | VCEDX | VCEDX | VX | — | — | — | — | V |
| reports | V | VX | VX | VX | — | VX | VX | VX | VX |
| ai | V | V | V | V | — | V | V | — | V |
| settings | V | VEX | VEX | — | — | — | — | — | — |
| users | V | VCED | VCED | — | — | — | — | — | — |
| roles | V | VCED | VCED | — | — | — | — | — | — |
| audit | V | VX | VX | — | — | — | — | — | — |
| subscription | V | VE | V | — | — | — | — | — | — |

System role ranks and default scopes: legacy super admin 5/all; business owner 4/all; admin 3/all; production manager 2/branch; supply/sales 2/all; operator 1/workcenter; quality 1/branch; maintenance 1/branch; warehouse 1/warehouse (`access.ts:41-49,665-681`). `src/domain/access.ts:75-123,446-502` maps named actions and checks scope. `src/domain/access.ts:564-662` filters scoped read views. `src/domain/saas.ts:8-18,70-84` separately applies plan entitlements. These are frontend checks only.

## Module-by-module assessment

| Area | Current implementation and this run's evidence | Limit |
| --- | --- | --- |
| Platform / Super Admin | Separate signed ticket gate, tenant metadata, plans, support, audit, and health sections (`src/features/platform/PlatformPage.tsx`, `src/domain/platform.ts`); E2E covers ticket rejection, section rendering, settings and company operations (`e2e/platform.spec.ts`). | Browser storage remains editable; there is no trusted operator registry, real billing, or server monitoring. |
| Authentication / registration | First-owner and additional-tenant registration, login, temporary credential and recovery functions (`src/domain/auth.ts`, `AppContext.tsx`); domain/UI/browser tests cover supported paths. | Password hashes and sessions are browser-held; delivery, cross-device revocation, rate limiting, and atomic signup require a backend. |
| Business admin / owner | Roles, users, subscription demo and settings are guarded by effective grants and target-rank checks (`src/domain/access.ts`, `src/features/admin/pages/Admin.tsx`); role restriction and plan E2E cases pass in the browser suite. | Browser user can edit local role and plan data; exhaustive 9-role × route × action sweep was not run. |
| Employees / HR | Profile/account creation, site assignment, activation, time/activity screens (`src/features/employees/pages/Employees.tsx`, `src/domain/employeeForm.ts`); E2E covers creation and first login. | No payroll or external identity delivery; one date-sensitive domain regression fails (M1). |
| Sales | Orders, reservation/delivery, serial selection, receivable payment and returns (`src/features/sales/pages/Sales.tsx`, `src/domain/actions.ts:3265`); finance and sales domain/browser cases cover selected flows. | No external payment/shipping integration or server idempotency; not every cancellation/reversal sequence was tested. |
| Inventory / warehouses | Balances, lots/serials, transfers, partial receipts, stock counts and adjustment actions (`src/features/warehouse/pages/Warehouse.tsx`, `tests/inventoryCompletion.test.mjs`); desktop/mobile inventory scenario. | No concurrent database stock locks or hardware barcode/RF integration. |
| Procurement / suppliers | Request approval, PO, receipt, invoice match and payable ledger (`src/features/purchases/pages/Purchases.tsx`, `tests/procurementCompletion.test.mjs`, `e2e/procurement.spec.ts`). | Request-to-payment steps are split among cases; no external invoice/payment settlement. |
| Manufacturing / production | BOM, MRP, reservations, issue, shop floor, output, final QC, costing (`src/features/production/`, `src/domain/actions.ts`, `tests/manufacturingCompletion.test.mjs`, `e2e/manufacturing.spec.ts`). | No true multi-user transaction boundary or complete final cost variance journal. |
| Quality / NCR / CAPA | Inspections, quarantine, NCR and separation-of-duties CAPA verification (`src/features/quality/`, `tests/qualityMaintenance.test.mjs:37-77`); browser CAPA view/action case. | Full inspection-to-CAPA single-chain browser journey was not run. |
| Maintenance / equipment | Requests, approval, spare issue/return, downtime and expense (`src/features/equipment/`, `tests/qualityMaintenance.test.mjs:79-117`); browser maintenance case. | Preventive scheduling, all reversal paths, and external maintenance integrations are not exhaustive. |
| Costs / finance | Receivable/payable ledgers and selected KPI/cost screens (`src/domain/receivables.ts`, `src/domain/payables.ts`, `src/features/costs/pages/Costs.tsx`, `tests/financeCompletion.test.mjs`). | General ledger, period close, FX/tax, supplier price variance and final COGS variance accounting are absent or documented as open in `docs/BUG_REGISTRY.md:520-522`. |
| Reports / analytics | Reports use scoped state and export grants (`src/features/reports/pages/Reports.tsx`, `src/domain/access.ts:564-662`). | No exhaustive report/export reconciliation for every role, tenant and branch. |
| Settings / shared shell / AI | Settings, global search, responsive menus, modal/table primitives and theme have UI/browser coverage (`src/features/settings/`, `src/layout/AppLayout/`, `src/shared/ui/`). | Accessibility coverage is sampled; AI answer quality and all viewport/control combinations were not audited. |

## Seven requested cross-module workflows

**End-to-end completion count: 0/7 independently verified as one uninterrupted transaction chain in this audit.** The existing tests exercise parts of all seven; their success must not be relabeled as full-chain verification. Domain tests below include one unrelated date-sensitive failure, so this table cites individual passing cases rather than calling the whole suite green.

| Requested chain | Verified pieces | Missing link in this audit |
| --- | --- | --- |
| Sales → reservation → shipment → payment → return | `tests/salesCompletion.test.mjs:52-141`, `tests/financeCompletion.test.mjs:108-128`, `e2e/sales.spec.ts` | One browser chain with all steps and reconciled stock/ledger. |
| Request → approval → PO → receipt → QC → invoice → payment | `tests/procurementCompletion.test.mjs:30-158`, `tests/financeCompletion.test.mjs:130-145`, `e2e/procurement.spec.ts`, `e2e/smoke.spec.ts:158-177` | One same-request chain through QC and final payment. |
| BOM → MRP → issue → production → QC → FG → costing | `tests/manufacturingCompletion.test.mjs`, `tests/workflows.test.mjs`, `e2e/manufacturing.spec.ts`, `e2e/smoke.spec.ts:178-198` | One independently traced BOM-to-cost browser chain. |
| Inventory receipt → transfer → partial receipt → stocktake → adjustment | `tests/inventoryCompletion.test.mjs:37-163`, `e2e/inventory.spec.ts` | Receipt provenance through the *same* stocktaking adjustment. |
| Inspection → NCR → quarantine → CAPA → verification | `tests/qualityMaintenance.test.mjs:37-77`, `e2e/qualityMaintenance.spec.ts` | Same inspection and quarantine lot traced through verified CAPA. |
| Maintenance request → approval → parts → downtime → expense | `tests/qualityMaintenance.test.mjs:79-117`, `e2e/qualityMaintenance.spec.ts` | Same request's downtime event and final expense reconciled in browser. |
| Customer/supplier balances → finance reports | `tests/financeCompletion.test.mjs:108-145`, `e2e/finance.spec.ts` | Both balances reconciled against one report period and underlying ledgers. |

## Previous November 14 six findings

The supplied brief names only the **severity distribution** (1 Critical, 2 High, 2 Medium, 1 Low), not the finding IDs or descriptions. I searched the canonical repository's `docs/audits/` and `docs/BUG_REGISTRY.md`. The available November 14 registry section has **13** `SEC-01` through `SEC-13` rows (`docs/BUG_REGISTRY.md:524-541`), and the November 14 business-isolation report is a different simulation. Neither is an identifiable six-finding original report. A matching original six-finding checklist is not in this canonical project, so assigning its findings to code would be speculation.

| Prior slot | Status | Reason |
| --- | --- | --- |
| Critical 1 | **Not Verifiable** | Original description/ID unavailable in canonical project. |
| High 1 | **Not Verifiable** | Original description/ID unavailable. |
| High 2 | **Not Verifiable** | Original description/ID unavailable. |
| Medium 1 | **Not Verifiable** | Original description/ID unavailable. |
| Medium 2 | **Not Verifiable** | Original description/ID unavailable. |
| Low 1 | **Not Verifiable** | Original description/ID unavailable. |

The current `tests/securityAudit.test.mjs:43-223` separately re-exercises branch scope, mass-assignment, payment-key, decimal validation and secret-redaction cases from the 13-row registry; those are **not** substituted for the unidentified six. No new regression in those tested paths was observed. The date-sensitive test failure below is a new regression in audit reliability.

## New findings by severity

| Severity | ID | Finding and reproduction | Evidence / impact |
| --- | --- | --- | --- |
| Critical | — | None newly confirmed. | Production trust boundary is an existing architecture blocker, listed separately. |
| High | — | None newly confirmed. | Full multi-user/security guarantees remain untestable without a backend. |
| Medium | M1 | **Domain suite fails after fixed fixture credential expires.** Run `npm run test:domain` on 2026-11-20. `tests/phase36.test.mjs:121-126` creates an account at 2026-11-09 and calls `signInBlocker` without a clock argument; `src/domain/auth.ts:282-284` defaults to `new Date()` and returns expired-password before the expected site error. | 505/506 pass; the suite is no longer a clean release gate. Test should pass the fixture date explicitly or check scope before credential expiry in an isolated fixture. No product security bypass was reproduced. |
| Low | L1 | **E2E writes fixed screenshot filenames into a pre-existing evidence directory.** Run `npm run test:e2e`; `e2e/businessIsolation.spec.ts:15,49,86,161,209` saves three screenshots to `docs/audits/evidence/zenix_business_simulation/`. | This audit run replaced three pre-existing untracked screenshots at those paths. Their previous bytes are unavailable from Git. The test should use a run-specific output directory. This is an audit artifact integrity issue, not an ERP workflow defect. |

## Security and business-rule conclusions

- Named domain actions are checked by `commandBlocker`, while generic entity mutations use `ENTITY_RULES` and target scope (`src/domain/access.ts:75-123,446-502`, `src/domain/actions.ts:5118-5373`). The current security tests include direct action calls with forged branch IDs and workflow fields (`tests/securityAudit.test.mjs:43-223`). These checks are client-side.
- Read projection filters employees, scoped financial rows, documents, logs, and exports for scoped roles (`src/domain/access.ts:564-662`). The two-tenant domain/browser tests cover selected foreign-ID calls and customer CSVs (`tests/tenantIsolationSimulation.test.mjs`, `e2e/businessIsolation.spec.ts:47-211`); they do not prove database tenant isolation.
- CAPA verification rejects verification by the action owner in the tested path (`tests/qualityMaintenance.test.mjs:37-64`). Request approval similarly rejects self-approval (`tests/procurementCompletion.test.mjs:30-56`). No configurable multi-step approval engine was found.
- Payment/stock replay and limits are tested in selected single-process cases (`tests/financeCompletion.test.mjs`, `tests/inventoryCompletion.test.mjs`, `tests/securityAudit.test.mjs:187-221`). There is no cross-device atomic idempotency guarantee. Supplier price variance, final COGS variance, cancellation after downstream posting, currency/FX and bank reconciliation need explicit accounting policy and server transactions.
- Platform support text has secret-like pattern filtering (`src/domain/platform.ts:199-210,267-275`) and ticket inputs are masked (`src/features/platform/PlatformPage.tsx:139`). A browser can inspect stored authentication hashes, sessions, business data and platform metadata, so redaction in rendered UI is not confidentiality against the local user.

## Checks and evidence

| Check from canonical root | Result | Evidence |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Initial sandbox attempt failed DNS; unrestricted retry installed 329 locked packages. | [npm-ci.log](evidence/canonical_2026-11-20/npm-ci.log), [npm-ci-escalated.log](evidence/canonical_2026-11-20/npm-ci-escalated.log) |
| `npm run typecheck` | PASS, exit 0. | [typecheck.log](evidence/canonical_2026-11-20/typecheck.log) |
| `npm run lint` | PASS, exit 0. | [lint.log](evidence/canonical_2026-11-20/lint.log) |
| `npm run test:domain` | **FAIL: 505 pass, 1 fail, 506 total**, M1. | [domain.log](evidence/canonical_2026-11-20/domain.log) |
| `npm run test:ui` | PASS: **130/130**. | [ui.log](evidence/canonical_2026-11-20/ui.log) |
| `npm run test:e2e` with `PW_CHANNEL=chrome`, `PW_PORT=4187` | **PASS: 63/63** (1 setup, 31 desktop, 31 mobile; 5.6 minutes). Initial sandbox run did not start the server and was stopped; unrestricted run passed. | [e2e.log](evidence/canonical_2026-11-20/e2e.log), [e2e-escalated.log](evidence/canonical_2026-11-20/e2e-escalated.log) |
| `npm run build` | **Not run as written**: its `styles` step unconditionally writes the already-modified application source `src/styles.css` (`scripts/build-styles.mjs:20`). The current stylesheet is byte-for-byte equal to the nine source inputs; `npm run typecheck` and the separate `npx vite build` exercise the remaining production build stages without rewriting source. | `package.json:6-15`, `playwright.config.ts:24` |
| `npx vite build` | PASS, exit 0; Vite built in 2.38 seconds. This is the production bundler stage of the package build. | [vite-build.log](evidence/canonical_2026-11-20/vite-build.log) |
| `git diff --check` | PASS, exit 0; Git printed only LF/CRLF conversion warnings. | [diff-check.log](evidence/canonical_2026-11-20/diff-check.log) |

## Untested areas and backend requirements

No real payment provider, bank feed, email/SMS delivery, production API, shared database, server authorization, immutable audit log, concurrent stock transaction, cross-device session revocation, or multi-tenant row isolation exists to test. Browser storage simulation is useful as a demo check only. The 22-route declaration was not swept across every role and state. Every table/filter/export and every desktop/tablet/mobile viewport was not covered. No complete keyboard or screen-reader audit was run. The seven requested cross-module chains have component evidence but no single uninterrupted verification in this run.

Before production release, move identity, membership, authorization, tenant predicates, sensitive records, billing state, payment verification, idempotency keys, inventory reservations, and ledgers to a trusted backend with database constraints and transactions. Implement explicit reversal/variance accounting, durable approval history, audit retention, and cross-tenant integration tests. `docs/BACKEND_CONTRACT.md` describes the intended boundaries but is not an implementation.

## Help & Guidance (completed 2026-11-21)

This section records the Help & Guidance work: started in an earlier session and completed in this one. Nothing here was committed, pushed or merged. ZENIX is still a frontend-only application, so every permission statement below concerns what the **browser UI** shows. It is not server-side security.

### Architecture

The design chosen in the earlier session was kept. There is **one catalog**, `src/features/help/helpContent.ts`, and **one UI module**, `src/features/help/HelpExperience.tsx` (styles in `help.css`, built only from the existing tokens and glass surfaces). Three entry points read the catalog:

* **Help Center**: the `/help` route in `src/App.tsx`. It is reached from:
  * the profile menu (**Yordam markazi**);
  * the page help panel;
  * the onboarding banner.

  It contains a search box, the user's role profile, workflow guides, page topics with a module filter, and FAQ.
* **Contextual help**: the topbar **Yordam** button (ⓘ) opens one side drawer, **Sahifa bo‘yicha yordam**. The drawer shows:
  * the current page's explanation, resolved from pathname plus `?view=` and the page's default view;
  * the guides attached to that page that the user is allowed to run;
  * a link to the topic in the Help Center.

  Pages without a catalog entry, such as `/help` itself or an unknown URL, show a neutral empty state.
* **First-time onboarding**: an inline banner (not a modal) below the module subnav. Its actions:
  * **Yo‘riqnomani boshlash** opens `/help?onboarding=1`;
  * **Keyinroq** dismisses it;
  * **Tushundim** completes it.

  **Boshlang‘ich yo‘riqnomani qayta ko‘rish** on the Help Center reopens it at any time. The choice is stored through the existing `shared/lib/storage` helper under `zenix-help-onboarding-v1:<tenant>:<account>:<employee>`. That makes it per company, account and employee, and it is never sent anywhere.

Page topics are generated from `routes/navigation.ts` (`moduleNav`), so every navigable view has exactly one help entry. Explanations are written once in `HELP_COPY`, which keeps the help content free of duplicates.

**Visibility rules**

* A topic is visible when the user can open its page. This uses the same `anyOf` / module test as the navigation.
* A guide is visible only when:
  * its page is visible, and
  * every requirement resolves to a rule the user holds.
* Requirements are resolved through the real access-control functions:
  * `actionRules(command)` for domain commands;
  * `entityRules(entity, action)` for CRUD actions;
  * an explicit rule, or an any-of list that mirrors a button's own UI gate (used for **Maintenance so‘rovi**).
* Search, the onboarding task list, the role profile and the contextual panel all draw from the same filtered lists. A user therefore cannot see or find instructions for an action they are not allowed to perform.

Tutorials only explain. **Keyingi qadam** and **Oldingi** move between steps in local React state, and **Sahifani ochish** is a plain link. No help code calls a domain action or writes business state.

### Coverage

* **Routes and modules.** There are **97 topics**: 96 module views across 15 modules plus ZENIX AI. Every tenant route declared in `src/App.tsx` has a topic, except public/auth pages, `/setup`, `/platform/*` and `/help`.
  * Modules covered: Dashboard; Production (8 views); Products (7); Materials (4); Warehouse (10); Purchases (7); Sales (6); Quality (8); Equipment (7); Employees (5); Costs (6); Reports (9); Admin (7); Subscription; Settings (10); ZENIX AI.
* **Roles.** All 9 system roles are covered: Eski Super Admin, Biznes egasi, Admin / Direktor, Ishlab chiqarish menejeri, Operator, Sifat nazoratchisi, Texnik xizmat muhandisi, Omborchi, Ta’minot va sotuv menejeri. Custom tenant roles get help derived from their own permission matrix.

**Guides per role**

| Role | Guides shown |
| --- | --- |
| Biznes egasi, Admin / Direktor | all 22 |
| Ishlab chiqarish menejeri | 15 |
| Operator | Sex ishini bajarish; Maintenance so‘rovini yuborish |
| Sifat nazoratchisi | Sifat tekshiruvi; CAPA; Hisobot |
| Texnik xizmat muhandisi | Maintenance qism chiqimi; Ombordan qism chiqimi; Maintenance so‘rovi; Maintenance ishini boshlash/yakunlash; Hisobot |
| Omborchi | Qabul; Transfer; Inventarizatsiya; Ombordan qism chiqimi; Yetkazib berish; Supplier invoice; Mijoz to‘lovi; Hisobot |
| Ta’minot va sotuv | 9 purchasing/sales guides |
| Eski Super Admin | none (legacy read-only role) |

A view-only custom role sees the page explanations and no action guides.

**Completed guides (22).** Each guide has:
* purpose;
* the permission it needs;
* prerequisites;
* numbered steps;
* fields to fill;
* expected result;
* next action;
* common errors.

The guides:
1. Xomashyo kartasini qo‘shish
2. Xarid talabini yuborish
3. Xarid talabini ko‘rib chiqish
4. Xarid buyurtmasini tayyorlash
5. Xaridni qabul qilish
6. Supplier invoice kiritish (new)
7. BOMni faollashtirish
8. MO yaratish
9. Sex ishini bajarish
10. Sifat tekshiruvini hal qilish
11. CAPA choralarini yuritish
12. Maintenance so‘rovini yuborish (new)
13. Maintenance ishini boshlash va yakunlash (new)
14. Biriktirilgan maintenance ishida qism chiqarish
15. Ombordan maintenance uchun qism chiqarish
16. Omborlararo transfer
17. Inventarizatsiya o‘tkazish (new)
18. Sotuv buyurtmasini yaratish
19. Sotuvni yetkazib berish
20. Mijoz to‘lovini qabul qilish (new)
21. Hisobotni filtrlash va eksport qilish
22. Foydalanuvchi yaratish

There are also 8 FAQ entries, filtered by module.

### What this session changed

* **Guide accuracy.** Generic steps were rewritten to quote the real button and field labels from the components:
  * Purchases: **Yangi so‘rov**, **Tasdiqlashga yuborish**, **Yangi PO**, **Qoralama saqlash** / **Yaratish va tasdiqlash**.
  * Products: **Faollashtirish**.
  * Quality: **Tekshiruv natijasini kiritish** → **Natijani saqlash**; **Amal qo‘shish** → **Bajarildi** → **Tekshirish**.
  * Maintenance: **Qism berish** → **Qism va ombor** / **Miqdor** → **Berish**.
  * Sales: **Yetkazib berish** → **Yetkazishni tasdiqlash**.
  * Reports: the export buttons **Excel (.xlsx)**, **CSV** and **Print / PDF saqlash**, and the actual period options.

  A domain test now fails if any quoted label (“…”) in a guide or page explanation does not exist in the application source. A mutation check confirmed it: an invented label made the test fail.
* **Five new guides**, so that the maintenance, warehouse and supply/sales roles have daily workflows: stock count, maintenance request, maintenance start/complete, supplier invoice and customer payment. The role-specific "daily" lists were updated to match.
* **Profile menu** now has a **Yordam markazi** entry in `Topbar.tsx`.
* **`App.tsx` import.** The `/help` page is imported statically. The module was already in the main bundle through the topbar and banner, and the earlier lazy import produced a Vite "dynamically and statically imported" warning.
* **E2E fix.** The existing help test looked up the search field as `textbox`. A `type="search"` field has the role `searchbox`, so the test now uses that.

### Regression tests

**Domain: `tests/help.test.mjs` (10 tests, 6 new).**
* **Route coverage.** Every tenant route in `App.tsx` has a topic. Every topic path is a declared route, and its `?view=` key is handled in that module's source.
* **Guide integrity.** Every guide:
  * points at an existing topic;
  * has requirements that resolve to real `actionRules` / `entityRules`;
  * has prerequisites, steps, fields, errors, a result and a next action;
  * quotes only labels that exist in the UI. Page explanations are checked for quoted labels too.
* **Per-role matrix.** The test asserts the exact guide set for all 9 system roles. It also checks:
  * every rule a visible guide needs is held by the role;
  * hidden guides cannot be found by search.
* **View-only custom role.** It gets pages but no action guides.
* **Search.** Works on title, description, step, field and common-error text, ignoring case and spacing.
* **Read-only.** Catalog browsing does not mutate seed state, and onboarding keys are separated by tenant and account.

**UI: `tests/ui/help.test.tsx` (9 tests, 5 new).**
* **Every role.** Each of the 9 roles is mounted as an employee. The Help Center lists exactly that role's guides and topic count, and nothing from other roles.
* **Contextual panel on every route.** The panel opens on all 97 topic routes for the owner, shows the right topic and links back to `/help?topic=<id>`. No page crashes; jsdom lacks `Element#scrollTo`, so it is stubbed for the AI page.
* **Every guide.** All 22 guides:
  * render every section;
  * step through to the last step without changing business data in `localStorage`;
  * open their real route through **Sahifani ochish**.
* **Profile menu and missing content.** The profile menu reaches `/help`. The panel on `/help` and on an unknown URL shows the safe empty state.
* **Onboarding.** Started from the banner, it is completed and stays dismissed across pages. The operator on the same browser still gets their own onboarding, listing only shop-floor work and no admin links.

The existing tests cover skipping and reopening onboarding, the operator being refused the admin guide by URL and by search, and FAQ search.

**E2E: `e2e/help.spec.ts` (4 tests, run in both the desktop 1366×900 and mobile Pixel 7 projects).**
* The onboarding → contextual panel → Help Center → tutorial journey checks:
  * business state in `localStorage` is unchanged;
  * search works;
  * there is no horizontal overflow.
* Forbidden and missing guides and topics show safe empty states.
* At **tablet size 820×1180**, a guide and the page panel fit without horizontal scroll.
* The profile menu reaches the Help Center, and a guide link opens its real page.

### Results (all executed 2026-11-21, after the last code change)

| Check | Result | Evidence |
| --- | --- | --- |
| `npx tsc -b` | PASS, exit 0 | [typecheck.log](evidence/help_2026-11-21/typecheck.log) |
| `npx eslint .` | PASS, exit 0 | [lint.log](evidence/help_2026-11-21/lint.log) |
| Domain tests (`scripts/run-domain-tests.mjs`) | PASS **548/548** | [domain.log](evidence/help_2026-11-21/domain.log) |
| Full UI tests (`scripts/run-ui-tests.mjs`) | PASS **152/152** | [ui.log](evidence/help_2026-11-21/ui.log) |
| Standard E2E, `PW_CHANNEL=chrome PW_PORT=4202 npx playwright test` (Phase 4 specs excluded by config) | PASS **77/77**: 1 setup, 38 desktop, 38 mobile; 5.6 min | [e2e.log](evidence/help_2026-11-21/e2e.log) |
| `npx vite build` (the safe build; `npm run build` would rewrite `src/styles.css`) | PASS, exit 0, no warnings | [vite-build.log](evidence/help_2026-11-21/vite-build.log) |
| `git diff --check` | PASS, exit 0 (only LF/CRLF notices) | [diff-check.log](evidence/help_2026-11-21/diff-check.log) |
| Whitespace check of the untracked help files (`git diff --no-index --check`) | no findings | — |
| `src/styles.css` | MD5 unchanged before and after all runs | — |

Before these final runs, two failures were found and fixed:
* the existing E2E search step (wrong role);
* the first version of the all-routes UI test (`/ai` crashed only in jsdom).

Neither is counted as a pass.

**Screenshots** are in `docs/audits/evidence/help_2026-11-21/`: `{desktop,mobile}-help-onboarding.png`, `-help-contextual.png`, `-help-center.png`, `-help-guide-tablet.png`, `-help-panel-tablet.png` and `-help-link-target.png`. The `mobile-*-tablet` files were taken with the Pixel 7 profile resized to 820×1180.

### Remaining gaps and limitations

* **Frontend only.** Hiding a guide is a UI decision. The domain commands still enforce permissions in the browser, but nothing here is server-side authorization.
* **Guide visibility uses the role/permission matrix and the subscription entitlement (`app.can`) only.** It does not account for:
  * scope (branch, warehouse, work center);
  * maintenance assignment;
  * record status.

  A user may therefore see a guide whose button is disabled for a particular record. The guides' error sections and the FAQ explain these cases.
* **Onboarding state is per browser** (`localStorage`). It does not follow the user to another device, and it is not cleared by a tenant data reset.
* **Help content is static Uzbek text in the bundle.** There is no CMS and no other language. The global Ctrl K record search does not index help content; search lives on the Help Center.
* **Tutorials are explanatory, not interactive.** They do not highlight elements on the real page; that was avoided to keep overlays to a minimum.
* **Custom tenant roles** get correctly filtered guides but no curated daily order. They get the first four permitted guides.
* **Not done:** no screen-reader or keyboard-only audit of the help UI beyond the existing semantics (dialog, search box, region, `aria-current` step). No visual regression baselines.

### Files changed for Help & Guidance

Files present before this session and kept:
* `src/features/help/helpContent.ts`
* `src/features/help/HelpExperience.tsx`
* `src/features/help/help.css`
* `src/layout/AppLayout/AppLayout.tsx` (banner)
* `scripts/run-domain-tests.mjs` (helpContent bundle entry)

Changed in this session:
* `src/features/help/helpContent.ts`: accurate steps, 5 new guides, any-of requirement, daily lists.
* `src/layout/AppLayout/Topbar.tsx`: the **Yordam markazi** profile entry. The ⓘ panel button was already there.
* `src/App.tsx`: the `/help` route and its static import.
* `tests/help.test.mjs`, `tests/ui/help.test.tsx`, `e2e/help.spec.ts`
* `docs/audits/evidence/help_2026-11-21/` (new evidence)
* this section

No other module was refactored. No reset, clean or stash was used, and existing evidence and authentication files were not touched. **Nothing was committed, pushed or merged.**

## Context-aware help and accessibility (2026-11-21, second pass)

This is still frontend-only. "Can / cannot" in help explains what the browser UI will accept. It is not backend authorization. Nothing was committed, pushed or merged.

### What was already present

The first pass, described in the section above, included:
* the Help Center;
* the page panel;
* onboarding;
* 22 guides, filtered by the role matrix and subscription entitlement (`app.can`).

The shared `Drawer` already had:
* `role="dialog"` and `aria-modal`;
* a labelled title;
* a focus trap, Escape and click-outside to close;
* focus restored to the opener.

A global `:focus-visible` outline already existed. The gap was that **help ignored the user's real context**: branch and warehouse scope, maintenance assignment, record status and work center.

### What was improved

**`src/features/help/helpContext.ts` (new, read-only).** It derives every answer from the existing gates and invents no rule. Sources:
* `actionRules`, combined with `app.can`;
* `commandBlocker`, which covers maintenance assignment and branch / warehouse / work-center scope;
* `stockScope`, `homeOf`, `employeeBranchIds`;
* record status.

It provides:
* `workContext`: company, branches, accessible warehouses, home work center, and the open maintenance orders assigned to this person. The assignment rule is flagged only for the Maintenance Engineer role, matching `maintenancePartAssignmentBlocker`.
* `contextNotes`, per area:
  * **warehouse:** the user's warehouse scope, with receiving, issuing and transfer explained as three different operations, each with its own availability;
  * **production:** the operator's work center and the actions they hold there, plus what is closed to them (creating, editing, planning, approving MOs);
  * **quality:** inspection (one final decision), quarantine/release, rework and CAPA verification, each shown as available or not;
  * **maintenance:** the engineer's assigned orders.
* `guideProbe`: for the guides that depend on context, says whether the action is possible **now**, impossible (with the real reason) or idle (nothing to do yet). Covered guides:
  * engineer and warehouse spare-part issue;
  * transfer — every (own → other) warehouse pair is checked against `dispatchTransfer`;
  * stock count — per warehouse;
  * shop-floor — open operations the user may start;
  * quality check — pending checks they may decide;
  * maintenance start/complete.
* `unavailableGuides`: guides on the current page that the user cannot run, with the exact missing right (e.g. "Kerakli ruxsat: Ombor: Tahrir"). These show **no steps**.
* `recordContext`: for the record open in the URL, each action is shown as allowed or refused with its reason, followed by the next step, facts and permitted links. Supported records:

  | Record | URL | Actions |
  | --- | --- | --- |
  | Maintenance order | `/equipment?view=maintenance&id=` or `/warehouse?view=maintenance&mo=` | **Qism berish**, **Boshlash**, **Yakunlash**; status-gated and assignment/scope-checked |
  | Quality check | `/quality?view=checks&id=` | Pending vs final decision; customer-return checks go to Sotuv → Qaytarishlar; rejected purchase receipts can be returned or scrapped |
  | Production order | `/production?id=` | **START** on the current operation (status and work-center scope), edit/plan; next step by MO status |

  A record that is not in the user's view shows "topilmadi yoki doirangizdan tashqarida" and offers no actions. Other pages get general guidance, with that limitation stated.

**`AppContext.actionBlocker(name,args)` (two added lines).** This is a read-only wrapper around the same `commandBlocker` the domain gate runs on the full data, so help shows the exact refusal text. Before it was added, a scoped user saw "Noma’lum … (wc4)" for a work center in another branch; now they see "siz faqat Laser Cuttingda ishlaysiz".

**Panel and Help Center**
* The panel (`HelpExperience.tsx`) now has these sections:
  * "Ochilgan yozuv" (the open record);
  * "Shu yerdagi amallar" (each guide with its live availability);
  * "Sizga yopiq amallar" (reasons only);
  * "Sizning ish kontekstingiz" (notes, plus links to the user's assigned orders);
  * an explicit limitation note.
* The role profile and the onboarding view list the user's company, branch, warehouses, work center and assigned maintenance.
* Each guide shows a "Sizning holatingiz" note.

**Finding (unchanged business rule).** A warehouse role bound to one home warehouse cannot dispatch a transfer at all. `scopeBlocker` requires both the source and the destination warehouse to be its own. Help now says this with the domain's own words, instead of describing steps that would be refused. Whether this is intended is a business decision, so the rule was left as it is.

### Roles and contexts covered

| Role | Context behaviour |
| --- | --- |
| Maintenance Engineer | Assigned vs unassigned order. Open vs closed order. Spare parts and start/complete availability, with "Bu maintenance ishi sizga biriktirilmagan" on others' work. |
| Omborchi (warehouse-scoped) | Own warehouse(s) listed. Counting and issuing outside them refused with the scope reason. Spare parts for another branch's order shown as out of scope. Transfer status as above. |
| Operator (work-center scope) | Home work center. START refused for operations at other centers. MO create/edit/plan listed as closed with the missing right. |
| Sifat nazoratchisi | Pending vs decided checks. Return checks routed to Sales. Quarantine/release, rework and CAPA rights shown as held or not held. |
| Owner / Admin / Production manager / Supply-sales / custom roles | The same derivation from their matrix and scope. Unrestricted scope shows "Barcha filiallar / Barcha omborlar". |

### Accessibility

| Area | Result |
| --- | --- |
| Already correct (verified, unchanged) | Dialog role, `aria-modal` and labelled title; focus moves into the panel; Tab stays inside; Escape closes; focus returns to the **Yordam** button; `aria-expanded` follows the state; global `:focus-visible` outline. |
| Search results | Announced through a polite live region ("N ta natija topildi" / "Natija topilmadi"), linked with `aria-describedby`. |
| Chosen result | Moves focus to the opened topic or guide. This is done only after the router has applied the URL; before that the region is still empty and hidden, so focusing failed in a real browser. The E2E test caught this. |
| Guides | Have their own `h2`. Step changes are announced ("Qadam 2 dan 3: …"). Finished steps carry a check icon and "o‘tilgan" text instead of reduced opacity, which had lowered contrast. |
| Availability | Always shown as an icon plus text ("Mumkin" / "Mumkin emas" with the reason), never by colour alone. Colours are tokens (`--success`, `--danger`, `--text-2`). |
| Onboarding banner | Dismissing it, or finishing onboarding, puts focus on `#main` instead of losing it to `body`. |
| Role and scope lists | Are `dl` / `dt` / `dd`. |
| Text scaling | The search box uses `min-height`, and all help text uses the scalable `--fs-*` tokens. |
| Reduced motion | Hover transitions are disabled when reduced motion is requested. |
| Layout | The panel fits at 820 px (tablet) and 360 px (phone) with no horizontal scroll. |

### Tests

**Domain: `tests/helpContext.test.mjs` (6 new).** Every expected refusal is compared with `commandBlocker` for the same arguments. The tests cover:
* engineer assigned vs unassigned vs closed order;
* keeper warehouse scope, other-branch spare parts and transfer;
* operator work center, START at another center, closed planning actions, and the shop-floor probe idle/ready/blocked states;
* quality pending, final, return and decided-with-NCR states, and CAPA/inspect rights;
* exact missing-right text with no steps, the "missing" record and general pages;
* all helpers leaving state unchanged.

**UI: `tests/ui/helpContext.test.tsx` (7 new).**
* The engineer panel on their own and a peer's order.
* The keeper panel: own warehouse only; receiving, issuing and transfer; the transfer refusal; another branch's order shown as out of scope.
* The operator panel: START refused, closed MO actions with no step links.
* The quality panel: decided vs pending.
* Keyboard: focus into the dialog, Escape, focus restored, `aria-expanded`.
* Help Center: live result count, focus on the chosen guide, step announcements, the passed-step text.
* The banner leaves focus on `#main`, and opening context help writes no business data.

**E2E: `e2e/help.spec.ts` (+3, run in both desktop and mobile projects).**
* The panel opens with Enter, Tab and Shift+Tab stay inside, the context section is visible, Escape closes it and focus returns.
* Search announces results, Enter on a result focuses the guide, and the step change is announced.
* An unknown record is explained and not actionable, at 820 px and 360 px, with no horizontal overflow.

**Mutation check.** With the scope/assignment blocker disabled in `actionCheck` (the old role-only behaviour), 3 domain tests and 3 UI tests fail. The file was then restored byte-for-byte.

### Results (executed 2026-11-21, after the last change)

| Check | Result | Evidence |
| --- | --- | --- |
| `npx tsc -b` | PASS | [typecheck.log](evidence/help_context_2026-11-21/typecheck.log) |
| `npx eslint .` | PASS | [lint.log](evidence/help_context_2026-11-21/lint.log) |
| Domain tests | PASS **554/554** | [domain.log](evidence/help_context_2026-11-21/domain.log) |
| Full UI tests | PASS **159/159** | [ui.log](evidence/help_context_2026-11-21/ui.log) |
| Standard E2E, `PW_CHANNEL=chrome PW_PORT=4204` | PASS **83/83**: 1 setup, 41 desktop, 41 mobile; 5.6 min | [e2e.log](evidence/help_context_2026-11-21/e2e.log) |
| `npx vite build` | PASS, no warnings | [vite-build.log](evidence/help_context_2026-11-21/vite-build.log) |
| `git diff --check` (and `--no-index --check` for the new untracked files) | PASS / clean | [diff-check.log](evidence/help_context_2026-11-21/diff-check.log) |
| `src/styles.css` | MD5 unchanged | — |

During development, before these runs, two failures were found and fixed; neither counts as a pass:
* the first help E2E run: focus on the chosen result in a real browser, and measuring the panel during its slide-in;
* the first UI run: the fixture has no transactions, so the tests now seed the demo data set.

**Screenshots** are in `docs/audits/evidence/help_context_2026-11-21/`:
* `{desktop,mobile}-help-context-panel.png`
* `{desktop,mobile}-help-missing-record-{820,360}.png`

The earlier evidence in `help_2026-11-21/` was not overwritten.

### Remaining limitations

* **Record-level context covers three record types only**: maintenance orders, quality checks and production orders. Other pages show general guidance, and the panel says so. The final word is always the domain gate when the user submits.
* **A spare-part issue is checked before the user picks a warehouse.** The probe uses the order's work center; the warehouse scope is checked again when the user submits, and help states this.
* **Context comes from data the browser holds.** Two users on different devices can see different states. There is no server, no real-time update and no server authorization.
* **The E2E company has no transactions.** Record-level states are verified in the UI tests with the demo data, not in a real browser.
* **Not done:**
  * no automated screen-reader run (NVDA/VoiceOver) — semantics and live regions were checked through the DOM and Playwright roles;
  * no automated contrast measurement — colours come from existing tokens;
  * browser zoom beyond the app's own font scale was not tested.
* **The warehouse-bound transfer restriction** described above is reported, not changed.

### Changed files (this pass)

New:
* `src/features/help/helpContext.ts`
* `tests/helpContext.test.mjs`
* `tests/ui/helpContext.test.tsx`
* `docs/audits/evidence/help_context_2026-11-21/`

Changed:
* `src/features/help/HelpExperience.tsx`
* `src/features/help/help.css`
* `src/app/providers/AppProvider/AppContext.tsx` (`actionBlocker` type and value only)
* `scripts/run-domain-tests.mjs` (the `helpContext` bundle entry)
* `e2e/help.spec.ts`
* this report

No reset, clean or stash was used. Authentication state and earlier evidence were not touched. **Nothing was committed, pushed or merged.**

## Final independent verification — 2026-11-25 (Asia/Tashkent)

**Decision: PASS WITH LIMITATIONS for starting backend architecture and integration.** The frontend demo and tested workflows are functional. This is **not** a production, backend, or security readiness claim.

The linked audit captures are local evidence. They are excluded from Git publication because browser screenshots and adjacent run files may contain account or storage data.

### Scope and preserved work

Canonical root: `C:\Users\user\Desktop\Proyects\ZENIX-Pro`; branch `codex/zenix-completion`; HEAD before and after: `deb1f0d3ff466a1b44984e8af17c09f6ea3b556b`. The complete starting list of 619 modified/untracked paths is in [`GIT_STATUS_BEFORE.txt`](evidence/final_independent_2026-11-25/GIT_STATUS_BEFORE.txt), with the [final status](evidence/final_independent_2026-11-25/GIT_STATUS_AFTER.txt) recorded separately; the tracked diff was 59 files, 2,827 insertions and 307 deletions ([`GIT_DIFF_STAT_BEFORE.txt`](evidence/final_independent_2026-11-25/GIT_DIFF_STAT_BEFORE.txt)). All pre-existing work was preserved. No reset, clean, stash, merge, commit, push, or PR occurred.

This pass changed only `src/features/reports/pages/Reports.tsx`, `tests/ui/reportsYield.test.tsx`, `e2e/phase4.spec.ts`, `e2e/phase4Manufacturing.spec.ts`, this report, and new evidence under `evidence/final_independent_2026-11-25/`, `evidence/phase4/run-3fbc1770/`, and `evidence/phase4/run-38407e97-manufacturing-d81ddd97.storage.json`. The Phase 4 tests wrote credentials only to an ignored `test-results/` registry copy. The protected files `src/styles.css`, `e2e/.auth/admin.json`, the saved Phase 4 state, and a prior Help screenshot retained identical SHA-256 hashes ([before](evidence/final_independent_2026-11-25/PROTECTED_HASHES_BEFORE.txt), [after](evidence/final_independent_2026-11-25/PROTECTED_HASHES_AFTER.txt)). The original Phase 4 account registry and seed summary were not written by these runs.

### Confirmed new defect and correction

| ID | Severity | Location | Reproduction, cause, impact | Correction and evidence |
| --- | --- | --- | --- | --- |
| FI-2026-11-25-01 | Medium | `src/features/reports/pages/Reports.tsx`, production KPI around lines 79–88 | In the saved Phase 4 company, the original MO has 95 good and 5 scrap, and a rework MO reports 5 completed without a second `Production +` receipt. The report added both MO completion counts, displaying **95.2%** Yield although 95 / (95 + 5) is **95.0%**. Rework units were counted twice. This was a real application reporting defect. | Yield now uses original MOs only; completed MO count and other metrics retain their previous definitions. `tests/ui/reportsYield.test.tsx` reproduces the rework case and passes. The new manufacturing browser run's `REPORTS.json` displays **95.0%**. |

The new test initially failed because its fixture assumed the clean seed already contained an MO; a test-created MO fixed the fixture. That run was 159/160; the final UI run was 160/160. An initial sandboxed Playwright attempt did not start tests because local socket access was denied. The authorized isolated run then completed. An automatic approval review also rejected pointing `PHASE4_RUN_DIR` at the pre-existing evidence directory; the run used a new directory with a hash-matched copy of `STATE_SUMMARY.json`. The Phase 4 scripts now accept an isolated account registry path, and the manufacturing script refuses output path collisions.

### Independent workflow and arithmetic checks

The current canonical `auth.ts`, `AuthPages.tsx`, and `AppContext.tsx` contain Login/Register entry points, phone login, duplicate account checks, registration policy and trial duration, temporary employee credentials, forced password change, logout, and tenant membership gates. `access.ts` and `actions.ts` recheck maintenance assignment when issuing/returning parts and scope both transfer endpoints; dispatch requires a reason and duplicate key, and receipt records an actor and remaining in-transit quantity. The standard browser suite exercised registration (12 desktop/mobile cases), Help (14), transfers (4), maintenance assignment (2), and tenant isolation (2). These are browser-side controls.

Help contains **22 guides and 97 topics** in the current bundle. `helpContext.ts` uses `actionRules`, `commandBlocker`, `stockScope`, employee branch/home, assignment, and record status; Help tests covered filtering, context, focus, announcements, Escape, tablet/phone layout, and non-mutating guidance. Contextual record guidance covers maintenance orders, quality checks, and production orders. General navigation and the platform sections were exercised on desktop/mobile; the systematic route smoke sweep covers eight tenant routes, so an exhaustive route-by-role and assistive-technology audit is still unverified.

From the **new** manufacturing snapshot, calculations were performed independently of prior narrative reports ([calculation sheet](evidence/final_independent_2026-11-25/INDEPENDENT_CALCULATIONS.txt), [browser summary](evidence/final_independent_2026-11-25/phase4_seed/manufacturing-d81ddd97/MANUFACTURING_SUMMARY.json), [report capture](evidence/final_independent_2026-11-25/phase4_seed/manufacturing-d81ddd97/REPORTS.json)): raw stock 24 + 25 = **49 kg**; LOT value 49 × 10,000 = **490,000**; standard value 49 × 12,000 = **588,000** (variance −98,000); supplier ledger −200,000 + 600,000 + 400,000 = **800,000**; customer ledger −60,000 − 1,500,000 + 2,850,000 = **1,290,000**; original MO 95 good / 5 scrap, actual cost **560,000**, unit cost **5,894.74**; maintenance 150,000 + net spare part 10,000 = **160,000**. The 25-unit transfer has one 25-unit receipt and a completed status. The browser summary records zero page errors. OEE has no eligible recorded work time in this scenario, so a numeric OEE result was **not verified**.

### Executed checks

| Check | Actual result | Evidence |
| --- | --- | --- |
| Domain | **554/554 PASS** after the reporting fix | [`DOMAIN_FINAL.log`](evidence/final_independent_2026-11-25/DOMAIN_FINAL.log) |
| UI | **160/160 PASS** after the new regression test | [`UI_RETEST.log`](evidence/final_independent_2026-11-25/UI_RETEST.log) |
| TypeScript and ESLint | **PASS**, exit 0 | [`TYPECHECK_RETEST.log`](evidence/final_independent_2026-11-25/TYPECHECK_RETEST.log), [`ESLINT_RETEST.log`](evidence/final_independent_2026-11-25/ESLINT_RETEST.log) |
| Vite production build | **PASS**, `npx vite build` (safe script) | [`VITE_BUILD_FINAL.log`](evidence/final_independent_2026-11-25/VITE_BUILD_FINAL.log) |
| Standard Playwright | **83/83 PASS**: setup 1, desktop 41, mobile 41 | [`E2E_STANDARD_ESCALATED.log`](evidence/final_independent_2026-11-25/E2E_STANDARD_ESCALATED.log) |
| Phase 4 manufacturing | **1/1 PASS**, run `d81ddd97`, 27 unique screenshots | [`E2E_PHASE4_MANUFACTURING_SAFE.log`](evidence/final_independent_2026-11-25/E2E_PHASE4_MANUFACTURING_SAFE.log), [screenshots](evidence/final_independent_2026-11-25/phase4_seed/manufacturing-d81ddd97/SCREENSHOTS.md) |
| Phase 4 fresh company | **1/1 PASS**, run `3fbc1770`, 22 unique screenshots | [`E2E_PHASE4_FRESH.log`](evidence/final_independent_2026-11-25/E2E_PHASE4_FRESH.log), [screenshots](evidence/phase4/run-3fbc1770/SCREENSHOTS.md) |
| `git diff --check` | **PASS**, exit 0; line-ending warnings only | [`GIT_DIFF_CHECK.log`](evidence/final_independent_2026-11-25/GIT_DIFF_CHECK.log) |

The standard E2E build began before the narrow Yield fix; the updated source was subsequently built and exercised by both Phase 4 browser runs, including the corrected production report. Total executed passing cases after the test-fixture correction: **554 domain + 160 UI + 83 standard browser + 2 Phase 4 browser = 799**.

### Open decisions and readiness boundary

| Severity for production | Open item | Required action |
| --- | --- | --- |
| Critical | Identity, session, permission, tenant, subscription, and audit state remain browser controlled. | Implement server authority before production; frontend checks are usability gates, not security boundaries. |
| High | Inventory, LOT, payment, transfer, and registration flows have no cross-client transaction or uniqueness guarantee. | Implement API transactions, locking/idempotency, unique constraints, and authoritative ledger persistence. |
| Medium / business decision | A warehouse role scoped to one home warehouse cannot dispatch to another because both endpoints must be in scope. | Decide whether transfer dispatch should remain a higher-scope action or use a defined cross-warehouse delegation/receipt workflow. No authorization rule was changed here. |
| Low / verification gap | Automated screen-reader use, contrast measurement, browser zoom, exhaustive route-by-role sweep, and numeric OEE under eligible runtime were not completed. | Verify with real assistive technology and a representative runtime data set during integration. |

Backend integration must provide PostgreSQL persistence, an API architecture, authentication and session management, server-side RBAC and tenant isolation, transactional inventory operations, unique constraints, registration rate limiting, phone verification where required, durable audit logging, and backup/recovery. **Frontend demo readiness: yes. Frontend functional readiness to start backend integration: yes, with the listed business decision and verification gaps. Backend, security, and production readiness: no.**
