# ZENIX Phase 3.2 — Frontend Functional, RBAC, Multi-Tenant & Business Logic Audit

Date: 2026-11-07 · Type: audit only (no application code changed, nothing committed) · Companion files: `PHASE32_ISSUES.md`, `PHASE32_ROLE_MATRIX.md`.

## 1. Executive summary

The current worktree builds, type-checks, lints and passes every existing test (406 domain, 75 UI, 21 Chrome E2E). Phase 3/3.1 fixes hold under re-test. Tenant data isolation is structurally sound for supported flows: no record of company A appeared in company B in lists, global search, storage or after reload. All 17 main modules render without page errors and without horizontal overflow at desktop (1440), tablet (820) and mobile (Pixel 7) widths.

The weak area is **delegated administration**: four P1 defects let a holder of an admin-tier right exceed their delegation — backup import as a role-escalation path (P32-001), branch managers managing other branches' staff and accounts (P32-002), role scope widening (P32-003), and self-reactivation of an expired subscription (P32-004). No P0 was found: no cross-tenant contamination, stock corruption or ledger mismatch was reproduced.

| Area | Verdict |
|---|---|
| Authentication | Demo-ready; tenant lockout policy not applied (P32-005) |
| RBAC | Core action gate solid; delegation/scope gaps (P32-001…003, 009) block "ready" |
| Multi-tenant (demo) | Isolation PASS; subscription bypass P32-004; single session per browser (P32-010) |
| ERP functional | Core chains PASS end-to-end; P2 gaps in MO status validation, SO cancel, employee delete |
| Production security | Not applicable — browser-only (BR-01…BR-10) |

Findings: **P0 0 · P1 4 · P2 5 · P3 4**.

## 2. Repository / version state

| Item | Value |
|---|---|
| Audited checkout | `C:\Users\user\Documents\ChatGPT\zenix` — the only checkout containing Phase 1.1 SaaS + Phase 3.1 work |
| Branch / HEAD | `main` @ `dbbe317` (PR #4 merge) |
| Uncommitted | 47 modified tracked files (+1334/−411), 12 untracked (`saas.ts`, `payables.ts`, `profitability.ts`, `features/platform`, `features/subscription`, `phase31/profitability/saas` tests, …) |
| Not used | `Desktop/Proyects/zenix` (`1ecaf89`, only `styles.css` modified) and its worktrees — stale relative to this work |
| Preservation | SHA-256 of all 59 changed paths and of every file under `src tests e2e scripts docs` taken before any command and re-checked after validation and after writing reports: unchanged. A diff + tar of untracked files is kept in the session scratchpad. |

## 3. Validation results (current worktree, run 2026-11-07)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS (exit 0) |
| ESLint | `npm run lint` | PASS (exit 0, no warnings printed) |
| Domain tests | `npm run test:domain` | **406 / 406 pass**, 0 fail, 0 skipped |
| UI tests (jsdom) | `npm run test:ui` | **75 / 75 pass** |
| Production build | `npm run build` | PASS; warning: chunk > 500 kB (P32-013) |
| E2E Chrome | `PW_CHANNEL=chrome npx playwright test` | **21 / 21 pass** (setup + 10 desktop + 10 mobile) |
| Whitespace | `git diff --check` | PASS (only CRLF notices for `docs/AUTH.md`, `src/styles.css`) |
| Audit probes (outside repo) | `scratchpad/probe/*.mjs` on esbuild bundles of `src/`; `scratchpad/pw/audit.spec.mjs` on `vite preview` port 4191, fresh Playwright profiles | see §5–§9 |

`npm run build` regenerates `src/styles.css`; its hash was identical afterwards.

## 4. Module coverage

| Module | Method | Result |
|---|---|---|
| Auth / sessions | code review `auth.ts`, AppContext; probe `lock.mjs`; E2E register/login | P32-005 |
| RBAC / roles | code review `access.ts`; probe `rbac.mjs` (25 checks) | P32-001/002/003/009 |
| SaaS / tenants / platform | code review `saas.ts`, `PlatformPage.tsx`; probe `saas.mjs`; browser isolation probe | P32-004, P32-010 |
| Purchases / suppliers / payables | probe `flows.mjs` (PO → receive → inspect → supplier return → payments) | PASS |
| Warehouse / inventory | probe `flows.mjs` invariants (balances, LOTs, movements, negatives) | PASS |
| Production / MES | probe `flows.mjs`, `trans.mjs` | P32-006 |
| Quality (incoming, final, return) | probe `flows.mjs`; existing tests | PASS |
| Sales / receivables / returns | probe `flows.mjs` | P32-007 |
| Costing / profitability | probe `flows.mjs` | P32-011 (labelling) |
| MRP | existing `phase2/phase31` tests; `runMrp` smoke in probe | PASS (not independently re-derived) |
| Employees | probe `del.mjs`, `rbac.mjs` | P32-008 |
| Equipment / maintenance / OEE | existing tests + render sweep only | NOT independently probed |
| Dashboard / reports / exports | render sweep; existing `dashboard.test.mjs` | KPI math NOT re-derived |
| AI / notifications | render sweep; code review (`insights.ts` is rule-based, no external AI) | content accuracy NOT verified |
| UI shell | Playwright sweep 17 routes × 3 viewports | PASS (P32-012 i18n) |

## 5. Phase 3 / 3.1 regression check

| Item | Evidence | Status |
|---|---|---|
| Scrap never sellable; Final Scrap reconciles; rework LOT/serial lineage | `workflows.test.mjs`, `phase31.test.mjs` pass | HOLDS |
| Ambiguous legacy rework LOT blocked; operator reconciliation needs quality/production edit; repeat safe | `phase31.test.mjs` P3-P0-07 (operator refused, repeat no-op) | HOLDS |
| All-scrap MO closes | P3-P0-03 test | HOLDS |
| Unused-material return: eligible only, original LOT/location, duplicates refused, cost adjusted | `phase31.test.mjs` P3-P1-05 | HOLDS |
| Supplier payables: partial receipt, return, replacement, partial payment, duplicates | probe: receive 60/100, return 5, pay 20 000, duplicate key no-op, overpay refused, ledger = supplier debt to the cent (34 999.70 after 0.1+0.2 payment) | HOLDS |
| Branch MRP, expired LOT exclusion, variant BOM demand | `phase2/phase31` tests pass | HOLDS (tests only) |
| Profitability: partial delivery, returns, LOT COGS, estimated/actual labelling | probe: 4 delivered − 2 returned → net 2, revenue 100 000, COGS `unavailable` until MO close then `actual` 1 897.34 | HOLDS (P32-011 note) |

No previously FIXED registry item was found reopened.

## 6. RBAC results

Summary (full matrix and denied-action list in `PHASE32_ROLE_MATRIX.md`):
- One gate (`commandBlocker`) checks every domain command against its argument-specific rule and location scope; unlisted commands are refused. Plan entitlement is ANDed with RBAC, never ORed.
- Role changes take effect immediately (role read from current state, not from the session); archived employee, blocked account, disabled membership, suspended tenant all block sign-in and actions.
- Escalation guards (no self-edit, grant only what you hold, rank ordering, last-owner protection) work in the domain actions.
- Gaps: import path (P32-001), employee/account scope (P32-002), role scope (P32-003), custom-role rank (P32-009), legacy `role0` has full rights although described as read-only.

## 7. Multi-tenant results

Browser probe with two disposable companies in fresh Playwright profiles:

| Check | Result |
|---|---|
| A's new customer visible in B's customer list | No |
| Global search (Ctrl+K) in B for A's marker | 0 hits |
| B's storage key contains A's marker | No (A's key does) |
| Reload in B | still isolated |
| Log out of B, log into A | A's record present in A's storage |
| Separate state keys | `zenix-manufacturing-v3-state` (legacy A), `zenix-erp-tenant-<uuid>-state` (B) |
| Tab 2 signs into B while tab 1 has an A form open | tab 1 remounts into B, unsaved input lost, no write into either tenant (P32-010) |
| Suspension / membership removal / subscription | covered by existing `tenant.test.tsx`, `saas.test.mjs` (pass); self-reactivation P32-004 |

Not tested: session expiry during a switch, browser back across a tenant switch with cached forms beyond the probe above, export file contents per tenant (exports read the scoped tenant state by construction).

## 8. Cross-module workflow results

| # | Workflow | Result |
|---|---|---|
| 1 | Supplier → PO → partial receipt (QC hold) → incoming QC 55/60 → supplier return 5 → MRP → MO → issue/run → output 15 + scrap 2 → Final QC → FG | PASS; invariants hold at every step |
| 2 | FG → SO → reserve → partial delivery 4 → invoice → payment 100 000 → profitability | PASS; P32-007 on cancel-after-delivery |
| 3 | Delivered → customer return 2 → disposition Scrap → receivable credit | PASS (balance 0; second disposition refused) |
| 4 | Receipt → reject → supplier return → payable reconciliation | PASS (replacement path covered by `phase31` tests) |
| 5 | Rework | existing tests only (`workflows`, `phase31`) |
| 6 | Multi-tenant | PASS (§7) |
| 7 | Owner → manager → worker delegation | Owner/Admin delegation PASS; manager delegation needs admin-granted users/roles rights and then exceeds scope (P32-002/003) |
| 8 | Invalid operations | duplicate receipt/payment/output keys, NaN, negative, over-receipt, over-delivery, over-return, over-payment, adjust below reserve+quarantine, same-warehouse transfer, invalid MO jump to `Yakunlangan`: all refused with state unchanged. Exception: unknown MO status strings accepted (P32-006) |

Invariants checked after each successful step: no NaN/Infinity anywhere in state; no negative onHand/reserved/quarantine/incoming/LOT qty; reserved ≤ onHand − quarantine; Σ positive LOTs ≤ onHand; Δ onHand per (warehouse,item,variant) = Σ new stock movements; customer/supplier `debt` = ledger balance; unique ids per collection; unique ledger keys. No violation found (one probe-definition mismatch: rejected receipt LOT status `hold` is counted in balance quarantine — consistent by design).

## 9. UI results

17 routes × 3 viewports (desktop 1440×900, tablet 820×1180 touch, Pixel 7): every page shows its heading, no error boundary, no page/console errors, `scrollWidth ≤ innerWidth`, no visible input without a label, no icon-only button without an accessible name. Existing E2E additionally cover dialog Escape/focus return, deep links, 404, theme persistence, operator Purchases block, recovery screen. Not exercised here: sorting/pagination per table, every form's validation messages, keyboard-only completion of whole workflows.

## 10. Existing strengths

- Pure domain actions with a single authorization gate and argument-aware rules.
- Idempotency keys on receipts, outputs, payments, counts; refused actions return the identical state object.
- Ledger-derived supplier/customer balances; LOT provenance used for COGS with honest "unavailable/estimated" labels.
- Durable-save semantics (rollback on failed write, newer-schema lock, cross-tab conflict refusal, recovery screen).
- Broad automated suite (502 tests) that passes cleanly; accessibility basics consistently met.

## 11. Competitive gap summary (SAP S/4HANA Mfg, Dynamics 365 SCM, Odoo Mfg)

| Capability | ZENIX status |
|---|---|
| Production execution (MO, job cards, shop floor, scrap, rework, backflush) | PRESENT |
| Planning (MRP by branch, MPS/forecast, capacity sub-day) | PARTIAL (no finite optimisation, no multi-level pegging UI verified) |
| Warehouse (multi-site, bins, LOT, FEFO, quarantine, counts) | PARTIAL (no barcode/RF device flows, waves, putaway rules) |
| Traceability | PARTIAL (LOT genealogy yes; per-serial genealogy MF-02) |
| Quality (incoming/in-process/final, hold, CAPA, QCP frequency) | PRESENT (demo depth) |
| Maintenance (PM, downtime, OEE, repair) | PRESENT (not re-probed) |
| Cost accounting | PARTIAL (MO snapshots, LOT COGS; no GL, WIP accounting, variances by type, FX — MF-01) |
| Multi-site | PARTIAL (branches/warehouses; no inter-company) |
| Workflow approvals | PARTIAL (fixed approve rights; MF-04) |
| Configurability | PARTIAL (custom roles, policies; custom-role delegation missing MF-05) |
| Analytics | PARTIAL (dashboards/reports; KPI math not re-derived here) |
| Integrations / API | MISSING / BACKEND REQUIRED (MF-06) |
| Auditability | PARTIAL / BACKEND REQUIRED (mutable browser logs, BR-06) |
| Enterprise scalability | BACKEND REQUIRED (single-browser storage) |

No claim of parity or superiority is made.

## 12. Frontend readiness conclusion

- **Authentication:** suitable as a demo; fix P32-005 before relying on tenant policies.
- **RBAC:** not ready for a Super Admin / multi-manager build until P32-001…003 are fixed; these define the delegation contract the backend will mirror.
- **Multi-tenant demo:** ready for isolation demos; fix P32-004 before demonstrating subscription enforcement.
- **ERP functional:** core purchase→production→sales→return chains are consistent; address P32-006…008 in the same pass.

### Recommended Phase 3.3 order
1. P32-001 backup-import RBAC diff + `role0` read-only.
2. P32-002 employee/account scope.
3. P32-003 role scope delegation (+ P32-009 custom-role rank, same code).
4. P32-004 subscription status on self-service change.
5. P32-005 tenant lockout policy + tenant-tagged auth events.
6. P32-006 MO transition whitelist.
7. P32-007 short-close instead of cancel after delivery; revenue from invoices.
8. P32-008 employee delete reference guard.
9. P3 items (P32-010…013) as polish.

## 13. Unverified areas (explicit)

Equipment/maintenance/OEE flows beyond render; dashboard and report KPI arithmetic; export file contents (CSV/XLSX) per role/tenant; AI answer accuracy; per-table sorting/pagination; warehouse-scoped role in practice (no seed user); session expiry during tenant switch; localStorage quota behaviour (covered only by existing reliability tests); timezone runs under non-default `TZ`; randomized long-run property testing (only scripted chains were run this phase).
