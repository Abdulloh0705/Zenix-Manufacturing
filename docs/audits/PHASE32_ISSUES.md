# ZENIX Phase 3.2 — Issue Tracker

Audit date: 2026-11-07 · Source of truth: `C:\Users\user\Documents\ChatGPT\zenix` (`main` @ `dbbe317` + 47 modified / 12 untracked paths, Phase 1.1 SaaS + Phase 3.1 work, uncommitted).
Audit only — no application code was changed. Probes ran outside the repository (scratchpad) against bundles of the current `src/`.

Status legend: **CONFIRMED** = reproduced by probe or failing behaviour; **HIGH-RISK** = code evidence, not fully reproduced; **UNVERIFIED** = plausible, not checked.
All authorization below is browser/localStorage demo enforcement. "Confirmed" means the *supported app flow* allows it; it is not a claim about server security (there is no server).

## Summary

| ID | Sev | Class | Module | Title | Status |
|---|---|---|---|---|---|
| P32-001 | P1 | CONFIRMED BUG | RBAC / Backup | Backup import lets any `settings.edit` holder become Business Owner or legacy Super Admin | CONFIRMED |
| P32-002 | P1 | CONFIRMED BUG | RBAC / Employees / Users | Branch-scoped roles manage employees and accounts of other branches | CONFIRMED |
| P32-003 | P1 | CONFIRMED BUG | RBAC / Roles | Role administration ignores scope delegation (new roles default to `all`; system roles can be widened company-wide) | CONFIRMED |
| P32-004 | P1 | CONFIRMED BUG | SaaS / Subscription | Owner's self-service plan change revives a platform-expired/suspended subscription as a never-ending trial | CONFIRMED |
| P32-005 | P2 | CONFIRMED BUG | Auth | Tenant lockout policy is never applied at login; failed-login events carry no tenant | CONFIRMED |
| P32-006 | P2 | CONFIRMED BUG | Production / MES | `transitionProduction` writes any status string (incl. `''`, `null`, back to draft) and keeps reservations | CONFIRMED |
| P32-007 | P2 | CONFIRMED BUG | Sales / Finance | SO can be cancelled after partial delivery; Sales revenue figures drop it while its invoice stays in receivables | CONFIRMED |
| P32-008 | P2 | CONFIRMED BUG | Employees / Traceability | Employee hard-delete leaves dangling QC inspector / time-log references | CONFIRMED |
| P32-009 | P2 | MISSING FUNCTION | RBAC / Roles | Custom roles are fixed at rank 1: granted `users.*`/`employees.edit` rights are silently ineffective | CONFIRMED |
| P32-010 | P3 | UX ISSUE | Multi-tenant / Session | One session per browser: signing into company B in tab 2 silently switches tab 1 and drops unsaved form input | CONFIRMED |
| P32-011 | P3 | IMPROVEMENT | Costing / Profitability | COGS shows "unavailable" for goods released by Final QC until the MO is closed | CONFIRMED |
| P32-012 | P3 | UX ISSUE | UI / i18n | Mixed-language page titles (`Purchase Orders`, `Sales Orders`, `Shop Floor`) in Uzbek UI | CONFIRMED |
| P32-013 | P3 | IMPROVEMENT | Build | Main JS chunk > 500 kB (Vite warning) | CONFIRMED |

Counts: **P0 0 · P1 4 · P2 5 · P3 4** (bugs/UX/missing). Backend-dependent limitations: 10 (BR-01…BR-10). Missing enterprise functions: see §3.

---

## 1. Confirmed bugs

### P32-001 · P1 · Backup import privilege escalation
- **Module:** RBAC, Settings → Backup/Import.
- **Files:** `src/app/providers/AppProvider/AppContext.tsx:511-538` (`replaceAll`), `src/domain/access.ts:53-60` (`hasPermission`: `super_admin` → everything), `src/domain/access.ts:511` (`role0` "Eski Super Admin", described as read-only legacy but granted full rights), `src/domain/auth.ts:110` (`superAdminInvariant`).
- **Actual:** `importState`/`restoreLastBackup` need only `settings.edit`. The imported roles/employees replace the current ones; the only check is that *some* owner employee still has an account. Probe (`probe/rbac.mjs` A6/A6b): an Admin (`em1`, rank 3) exports, sets own `roleId` to `role_owner` (or to `role0`, or adds a role with `key:'super_admin'`), imports → `prepareStored` keeps it, `superAdminInvariant` passes → Admin becomes Business Owner; with `role0`/`super_admin` key the user gets every permission incl. `subscription.edit` and can strip or archive the real owner (super_admin bypasses rank checks).
- **Expected:** import must not change who holds which role, or must re-run `assignRoleBlocker`/`rolePermissionBlocker` for every role/assignment delta against the importing actor; `super_admin` keys must never be accepted from data; `role0` must be read-only in `hasPermission` (as its description says).
- **Root cause:** backup is treated as trusted data; RBAC escalation guards exist only in the domain actions, not in the import path.
- **Repro:** sign in as Admin → Settings → System → Export backup → edit JSON `employees[em1].roleId="role_owner"` (or `"role0"`) → Import → Subscription page now editable / owner can be archived.
- **Impact:** any role holding `settings.edit` (Admin or a custom role) can take over the company.
- **Fix:** (1) on import, keep current `roles` and every employee's `roleId` unless the actor is Business Owner, or diff and validate each change with the existing blockers; (2) strip/refuse `key:'super_admin'` in `normalizeLoaded`; (3) make `isSuperAdminRole` grant nothing beyond view for `role0`; (4) require `subscription.edit`-level (owner) for full restore.
- **Regression test:** domain/UI test: Admin imports backup with self→owner, self→role0, injected `super_admin` role → refused, state unchanged; Owner import of an unchanged backup still works.

### P32-002 · P1 · Cross-branch employee/user administration
- **Files:** `src/domain/access.ts:284-296` (`scopeTargets` entity case has no `employees` branch), `src/domain/access.ts:189-198` (`employeeWriteBlocker`: rank only), `src/domain/auth.ts:123-132` (`accountManageBlocker`: rank only), `AppContext.tsx:803-833` (`setUserStatus`, `resetUserPassword`, `deleteUser`).
- **Actual:** probe A1: Production Manager (`branch` scope, branch b1) given `users.edit` archives `em7` (branch b2) and moves him to `wc1` → both succeed; `scopeBlocker` returns `null`. Account actions (block, password reset) use the same rank-only check.
- **Expected:** a branch/warehouse/work-center scoped actor manages only employees whose home (work center / warehouse) is inside its scope, both before and after the change.
- **Impact:** branch manager can lock out, reset the password of (account takeover), or re-home staff of another branch.
- **Fix:** add `employees` to `scopeTargets` (home branch of `row` and of `patch.workCenterId/warehouseId`); apply the same scope test in `accountManageBlocker`.
- **Regression test:** b1 manager with users.edit: archive/move/reset password of b2 employee → refused; b1 employee → allowed.

### P32-003 · P1 · Role scope escalation through role administration
- **Files:** `src/domain/actions.ts:4394-4401` (`createRole`: `scope:p.scope||'all'`), `src/domain/actions.ts:4417-4427` (`updateRole` accepts any `scope`), `src/domain/actions.ts:4377-4391` (`updateRolePermission` on *system* roles), `src/domain/access.ts:151-158`.
- **Actual:** probe A2/A3: branch-scoped manager with `roles.create/edit` creates a role → scope `all`; sets **system Operator role** scope to `all` and grants it `production.edit` → succeeds, changing every operator in every branch.
- **Expected:** an actor cannot create or widen a role beyond its own scope; edits to shared system roles by a scoped actor are refused (or require an `all`-scope actor).
- **Fix:** default new-role scope = actor's scope; refuse scope wider than actor's; refuse system-role edits by scoped actors.
- **Regression test:** branch manager: create role scope `all` → refused; update Operator scope/permission → refused; Admin (scope all) → allowed.

### P32-004 · P1 · Subscription self-reactivation
- **Files:** `src/domain/saas.ts:78-85` (`changePlan`: any non-`active` previous status → `trial` with `endsAt: previous.endsAt`), `src/domain/saas.ts:94-97` (`platformOverridePlan` writes no `endsAt`), `AppContext.tsx:908-912`.
- **Actual:** probe `saas.mjs`: platform sets `expired` or `suspended` → entitlement false; owner calls `changePlan('enterprise')` → status `trial`, `endsAt` undefined → `subscriptionActive` true now and in one year, AI/all modules entitled. The Subscription page stays reachable while expired (`entitlement('subscription')` is always true).
- **Expected:** self-service change keeps `expired/suspended` status (or is refused); trials always have an end date.
- **Fix:** in `changePlan` refuse when previous status is `expired|suspended`; carry `endsAt` only from a trial; never create a trial without `endsAt`.
- **Regression test:** override → expired; owner changePlan → refused or still inactive.

### P32-005 · P2 · Tenant lockout policy ignored; failed logins invisible to tenants
- **Files:** `AppContext.tsx:637,642,730,735` (`lockState`/`recordFailure` on `authRef.current` = global `policy`), `AppContext.tsx:835-838` + `authResult` scoped merge (tenant policy written only to `policies[tenantId]`, global `policy` never changes), `src/domain/auth.ts:240-250`, `AppContext.tsx:884` (`visibleEvents`).
- **Actual:** probe `lock.mjs`: tenant policy `maxFailedAttempts:2` → 4 failures, not locked (global default 5 applies). Admin-set lock duration is also ignored. `login_failed`/`lockout` events are written without `tenantId`, so for any non-legacy tenant they never appear in that tenant's audit list.
- **Fix:** resolve the account's tenant(s) and use that tenant's policy (strictest if shared); tag failure events with the account's tenant ids.
- **Regression test:** set tenant policy 2 attempts → 2nd failure locks; tenant admin sees the events.

### P32-006 · P2 · Unvalidated production status transitions
- **Files:** `src/domain/actions.ts:1036-1150` (no whitelist; falls through to generic write at `:1147`).
- **Actual:** probe `trans.mjs`: from `Tasdiqlangan`, statuses `'Yakunlandi'` (typo), `'Qoralama'`, `'Material kutilmoqda'`, `''`, `null` all return `ok` and are stored; material stays reserved (`materialReserved:true`, 14.947 kg). UI only sends valid statuses (`OrderParts.tsx:226,297`, `Production.tsx:443`), so reachable only via direct domain calls — but this is the contract the backend will copy.
- **Fix:** explicit transition table; reject unknown targets; returning to draft must release reservations.
- **Regression test:** each invalid (from,to) pair → refused with state identity.

### P32-007 · P2 · Cancel after partial delivery / revenue mismatch
- **Files:** `src/domain/actions.ts:2905-2928` (`cancelSalesOrder` blocks only `Yetkazildi|Bekor`), `src/features/sales/pages/Sales.tsx:195,230` (revenue = `o.total` of non-`Bekor` orders).
- **Actual:** probe `flows.mjs`: deliver 4 of 10 (invoice 200 000), pay 100 000, cancel → `ok`, status `Bekor`. Receivable 100 000 remains open, delivered qty stays 4, but customer "Savdo hajmi" and order totals exclude the order. Open orders count ordered, not delivered, value.
- **Expected:** partially delivered SO is short-closed (keeps delivered part, invoice and revenue), not cancelled; revenue widgets use delivered/invoiced amounts.
- **Regression test:** cancel after delivery → refused or converted to short-close; revenue == invoiced.

### P32-008 · P2 · Employee delete breaks traceability
- **Files:** `src/domain/actions.ts:4147` (employee reference check = responsible on *open* MO only), `src/features/employees/pages/Employees.tsx:96`.
- **Actual:** probe `del.mjs`: employee who is QC inspector of a `Passed` check, or owner of a time log, is hard-deleted → 1 dangling QC reference, 1 dangling time log. Also not checked: closed-MO responsible, work-order operator events, maintenance, accounts.
- **Fix:** block delete when any historical reference exists (archive instead).
- **Regression test:** delete employee with QC/time log/WO history → refused; archive allowed.

---

## 2. UX issues and improvements

### P32-009 · P2 · MISSING FUNCTION · Custom roles cannot delegate
`roleRank` (`access.ts:45`) returns 1 for every custom role, so a custom "HR" role granted `users.create/edit` and `employees.edit` cannot assign any role and cannot edit any rank-1 or higher employee (probe A9: "sizning darajangizda yoki undan yuqori"). The matrix lets admins tick these boxes with no effect. Fix: give custom roles an explicit rank (≤ creator rank − 1) or hide administration rights for rank-1 roles. Test: custom HR role ranked 2 edits operators only.

### P32-010 · P3 · UX · Single browser session across tabs
Probe (`pw/audit.spec.mjs`, multi-tab): tab 1 in company A with an open "Mijoz qo‘shish" form; tab 2 signs into company B → tab 1 remounts into B, dialog gone, input lost, no warning. Design keeps one session per browser (`AppContext.tsx:217`), so no cross-tenant write was observed. Fix: warn before switching when a form is dirty; document the limitation.

### P32-011 · P3 · IMPROVEMENT · COGS pending until MO close
Final QC pass releases stock while the MO may stay in `Sifat nazoratida` (remaining qty). Deliveries from it show cost basis `unavailable` until the MO is closed; after close the same rows show `actual` (probe: 1 897.34 for net 2 units). Label correctly but surprising; consider an estimated snapshot at release.

### P32-012 · P3 · UX · Mixed-language headings
Viewport sweep: `/purchases?view=orders` → "Purchase Orders", `/sales?view=orders` → "Sales Orders", Shop Floor in English. Fix: i18n strings.

### P32-013 · P3 · IMPROVEMENT · Bundle size
`npm run build`: chunk > 500 kB warning. Split vendor/route chunks.

---

## 3. Missing business functions (verified absent or partial)

| ID | Function | Evidence | Note |
|---|---|---|---|
| MF-01 | Multi-currency / exchange rates | no `exchangeRate` in `src` | currency is display + `UZS` ledgers only |
| MF-02 | Per-unit serial genealogy | `BUG_REGISTRY.md` N-11 OPEN | serial ranges per LOT |
| MF-03 | General UoM conversion table | BUG-12 PARTIAL | per-supplier `unitFactor` only |
| MF-04 | Configurable approval workflows (multi-step, thresholds) | only fixed `approve` permissions | |
| MF-05 | Custom-role rank/delegation level | P32-009 | |
| MF-06 | API / webhooks / integrations | none in `src`; plan flag `api` unused | backend |
| MF-07 | PDF documents (invoice, PO, delivery note) | 4 files mention PDF; no generator verified | NOT VERIFIED |

## 4. Backend-required limitations (not bugs of the demo)

| ID | Limitation |
|---|---|
| BR-01 | All RBAC, scope, plan and tenant checks run in the browser; anyone with devtools can edit `localStorage` (state, `zenix-auth-v1`, `zenix-saas-v1`). |
| BR-02 | Tenant isolation = separate `localStorage` keys in one origin; no cryptographic or server boundary. |
| BR-03 | Platform admin = offline ECDSA ticket verified client-side; SaaS store writable by any page script. |
| BR-04 | Billing: plan change takes no payment (stated in UI); entitlement trust is client-side. |
| BR-05 | Password hashing (PBKDF2) and session tokens live in the browser; no server revocation. |
| BR-06 | Audit logs (activity, auth, SaaS events) are mutable, capped (2 000) and per-browser. |
| BR-07 | Concurrency: same-browser tabs are reconciled (`slot.latest`, conflict refusal); multi-device/multi-user concurrency impossible. |
| BR-08 | Transactions: atomicity per action in memory + one `localStorage` write; no ledger journal or idempotency store across devices. |
| BR-09 | Backup import must be a privileged server operation with RBAC diff (see P32-001). |
| BR-10 | Exports are generated client-side from the scoped view; no server-side report authorization. |
