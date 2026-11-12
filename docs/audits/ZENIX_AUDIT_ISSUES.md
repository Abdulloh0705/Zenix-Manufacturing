# ZENIX current-worktree issue register

> **2026-11-11 addendum:** The original rows below describe the 2026-11-09 baseline; see the later Phase 3.6 statuses in `docs/BUG_REGISTRY.md` and the current `ZENIX_PRO_FULL_AUDIT.md`. The current review confirmed and fixed ZP-001 (tenant role visibility/copy), ZP-002 (clean-tenant hydration restoring the legacy role), ZP-003 (Employees login handoff), ZP-004 (duplicate profile on account retry), and ZP-005 (silent legacy role promotion in future migrations). Domain 437/437, UI 95/95, and Chrome desktop/mobile E2E 37/37 passed. Production backend limits remain.

Audit: 2026-11-09, `main` at `dbbe317550e51154429d0ceb70529060038223a2` plus uncommitted files. `P` is release priority, not a CVSS score. CONFIRMED means source plus a current probe or a deterministic source path; HIGH-RISK means the failure condition has not been induced. Browser-only protections are not production security controls.

| ID | Priority | Class | Area | Current result |
| --- | --- | --- | --- | --- |
| ZA-001 | P1 | CONFIRMED | Branch RBAC reads | Branch manager sees other branch employee and unscoped expenses |
| ZA-002 | P1 | CONFIRMED | Subcontract costing | Service cost posts to overhead, not product/LOT cost |
| ZA-003 | P1 | BACKEND REQUIRED | Identity/tenant/security | Client storage and checks are mutable by the client |
| ZA-004 | P2 | CONFIRMED | Registration | Direct registration action skips name/company field validation |
| ZA-005 | P2 | CONFIRMED | Recovery | Signed recovery ticket is reusable until expiry in one page visit |
| ZA-006 | P2 | CONFIRMED | Platform | Expired platform ticket leaves metadata visible until mutation/reload |
| ZA-007 | P2 | MISSING | Employee activation | Temporary password has no activation expiry or single-use invitation |
| ZA-008 | P2 | MISSING | COGS | Provisional shipment cost has no final variance reconciliation |
| ZA-009 | P2 | HIGH-RISK | Registration atomicity | Multi-key storage rollback has no transaction or cross-tab lock |
| ZA-010 | P2 | MISSING | Company identity | No company identifier or duplicate-name policy |
| ZA-011 | P2 | BACKEND REQUIRED | Platform support | No scoped, expiring, audited support-access authority |
| ZA-012 | P2 | CONFIRMED | Employee scope | Fresh-company employee can activate with a scoped role but no site assignment |

**Count of currently confirmed defects:** P0 0, P1 2, P2 4, P3 0. Other rows are missing designs, high-risk conditions, or backend requirements and are excluded from that count. These are distinct from historical P32 findings.

## ZA-001 · P1 · CONFIRMED · Cross-branch read exposure

- **Evidence/root cause:** `src/domain/access.ts:453-519` returns a spread of `s` but never filters `employees`, `customers`, `suppliers` or `receivables`; `expenses` is filtered only by hidden `sourceId` (`:512`). `src/domain/access.ts:536-538` gives Production Manager `employees.view` and `costs.view`. `src/features/employees/pages/Employees.tsx:40-61` reads `app.state.employees`. Synthetic seed probe: `em2` home `b1`, `em7` home `b2`; `scopedView` returned 7/7 employees, 18/18 expenses, 3/3 customers and 7/7 receivables. The manager has `employees.view` and `costs.view`.
- **Reproduce:** in a synthetic two-branch state, use a `branch` Production Manager in branch A; open Employees or Costs, or call `scopedView(s, actor)`. Compare with a branch B employee and an unlinked expense.
- **Expected/actual:** branch-limited information follows an explicit data classification and filters at the data boundary; the current view includes company-wide records. Company-wide master data may be intentional, but employee and financial visibility has no documented exception.
- **Impact:** cross-branch personnel and cost disclosure; report/export paths consuming the scoped view may inherit it. This is within one tenant; no cross-tenant read was reproduced.
- **Solution/test:** define branch ownership for employees, expenses and ledgers, and filter by authorized branch before views/exports. Add a two-branch test that asserts branch B personnel and expense identifiers are absent from every branch A view and export; document any deliberately global master data.

## ZA-002 · P1 · CONFIRMED · Subcontract service excluded from unit cost

- **Evidence/root cause:** `src/domain/actions.ts:4097-4140` posts the subcontract service fee as an `Overhead` expense at receipt (`:4140`), with no LOT/MO cost allocation. `src/domain/profitability.ts:7-30` computes delivered LOT cost from production provenance and snapshots. Existing `docs/BUG_REGISTRY.md:98` identifies N-07 as PARTIAL.
- **Reproduce:** synthetic subcontract order with a positive service fee; advance to receipt and final QC, then compare the finished LOT unit cost/COGS with the same flow without the fee.
- **Expected/actual:** the fee is capitalized once into eligible received goods/WIP according to a documented partial-acceptance rule; currently it remains a period overhead expense.
- **Impact:** understated product cost and COGS, overstated gross margin; financial statements could double count if a later manual adjustment is added.
- **Solution/test:** agree allocation basis with finance, post a unique subcontract cost component to accepted quantity or WIP, reverse rejected quantity appropriately, and test partial acceptance, return, rework, shipment and no double posting.

## ZA-003 · P1 · BACKEND REQUIRED · Client is the security authority

- **Evidence/root cause:** `src/domain/auth.ts:1-5`, `src/domain/access.ts:1-3`, `src/app/providers/AppProvider/AppContext.tsx:268-285,371-419,644-654` read identity, role, membership, subscription and business state from browser storage. `src/domain/saas.ts:65-69` computes entitlements locally. No server API or transaction boundary is present in `package.json` or `docs/BACKEND_CONTRACT.md`.
- **Reproduce:** in an isolated synthetic browser profile, edit localStorage identity/role/tenant/subscription data and reload. This is a trust-boundary observation; a production server exploit cannot be tested because none exists.
- **Expected/actual:** production requests are checked against server-owned identity, membership, permission, scope and subscription; current controls only govern honest browser use.
- **Impact:** all SaaS/ERP data and audit controls are bypassable on a client-controlled copy; multiple devices cannot safely transact on shared stock/ledgers.
- **Solution/test:** implement the server model in `docs/BACKEND_CONTRACT.md`, server sessions, tenant-constrained storage, transactional commands and immutable audit; integration tests must forge tenant IDs, roles, plans and stale sessions and verify rejection.

## ZA-004 · P2 · CONFIRMED · Registration validation only in the form

- **Evidence/root cause:** `src/features/auth/pages/AuthPages.tsx:162-175` calls `registrationProblem`, but `AppContext.tsx:727-754` directly accepts `p.name` and `p.company` and checks only password and duplicate login; `src/domain/auth.ts:189-203` validates username/email but uses fallback text for empty names. `src/data/mockData.ts:137-146` accepts trimmed empty company/owner strings. A pure-function probe of `setupFirstAdmin` accepted empty `name/company` fields without a validation error.
- **Reproduce:** call the registration action directly with synthetic blank name/company while supplying valid username/password in a clean browser state; the UI form blocks it, the action path does not re-run field validation.
- **Expected/actual:** the action rejects invalid registration regardless of the caller; its validation depends on the form.
- **Impact:** malformed company and owner metadata through direct action, future UI/API callers or corrupted form state.
- **Solution/test:** validate the complete registration payload at the action boundary, including normalized company and owner names; unit and context tests should call the action directly with blanks and overlong input and prove no state key is written.

## ZA-005 · P2 · CONFIRMED · Recovery ticket replay

- **Evidence/root cause:** `src/shared/lib/crypto.ts:38-51` verifies only signature and expiry. `src/domain/auth.ts:211-226` defines the signed text and updates the account without a consumed-ticket record. `AppContext.tsx:807-819` verifies and invokes recovery but does not mark a ticket used. A synthetic ECDSA probe verified the same signed ticket twice before expiry (`true`, `true`). The UI page nonce at `AuthPages.tsx:194-196` limits reuse to the same visit, but does not make it single-use within that visit.
- **Reproduce:** mint a synthetic ticket for a test account and page code, call verification/recovery twice before expiry in the same page context.
- **Expected/actual:** second use is refused; current verifier accepts it. A full browser double-recovery flow was not run, so the practical exposure is bounded by that limitation.
- **Impact:** a copied ticket can be replayed during its validity window; owner recovery proof is weaker than its one-time description.
- **Solution/test:** store a server-side ticket ID/nonce consumption record atomically with password reset; for the demo, at least track use in persistent auth state. Test first success, second denial, expiry and cross-page code mismatch.

## ZA-006 · P2 · CONFIRMED · Expired platform session keeps read access on screen

- **Evidence/root cause:** `src/features/platform/PlatformPage.tsx:15-35` validates on sign-in, restore and mutation only. Lines `:44-66` render tenant metadata whenever `session` remains truthy; there is no expiry timer or render-time guard. Mutations reverify at `:34-35`.
- **Reproduce:** sign in with a short-lived synthetic platform ticket; keep `/platform` open beyond expiry without clicking a mutation or refreshing. The company list and audit rows remain rendered.
- **Expected/actual:** expiry hides platform data immediately; current screen keeps showing it until an action/reload. A timed browser probe was not run; this follows the deterministic state/render path.
- **Impact:** unattended shared-screen disclosure of company names, status, membership counts and platform events.
- **Solution/test:** track ticket expiry in component state, schedule invalidation and check it before rendering sensitive content; test expiry while idle and tab resume. Server authorization remains required.

## ZA-007 · P2 · MISSING · Employee activation lifecycle

- **Evidence/root cause:** `AppContext.tsx:843-860` creates an active membership and account immediately with `mustChangePassword:true`; `src/domain/auth.ts:296-312` has no activation deadline/token. `src/features/auth/pages/AuthPages.tsx:275-300` forces password change after sign-in. `docs/BACKEND_CONTRACT.md` describes a future invitations table.
- **Reproduce:** owner creates a synthetic employee/account with a temporary password; the password remains usable for first login without an activation expiry until changed or reset.
- **Expected/actual:** a single-use, expiring activation/invitation is bound to tenant, employee, role and scope; current demo requires manually handing over a temporary credential.
- **Impact:** long-lived initial credential and manual delivery risk. Role/membership are not chosen by the employee during activation.
- **Solution/test:** server invitation token hash, expiry, one-time acceptance, delivery and audit; test expired, replayed, wrong-tenant, changed-role and cancelled invitations.

## ZA-008 · P2 · MISSING · Final COGS variance reconciliation

- **Evidence/root cause:** `docs/audits/PHASE34_FINAL_READINESS.md` (P32-011 section) explicitly says Final QC freezes provisional shipment LOT cost and MO close does not revalue it. `src/domain/profitability.ts:7-30,39-66` reports provisional/actual basis, but no variance posting action is present. `tests/phase34.test.mjs:41-49` asserts the provisional label persists.
- **Reproduce:** release and ship a synthetic LOT before MO close; add eligible actual cost, close MO; compare frozen shipment COGS and final order snapshot.
- **Expected/actual:** documented finance policy posts or explains the variance; current system retains the provisional shipment value without reconciliation.
- **Impact:** cost and margin may remain unreconciled. This is a known design gap, not a reopened P32-011 bug.
- **Solution/test:** choose prospective vs retroactive variance accounting, add immutable adjustment entries and idempotency, test partial shipments/returns and exact sum of variance.

## ZA-009 · P2 · HIGH-RISK · Registration is not atomic across browser keys

- **Evidence/root cause:** `AppContext.tsx:737-746` writes tenant state, SaaS metadata and global auth as three separate storage operations; rollback uses further writes/removal. The first registration path also writes business state, SaaS, auth and session separately (`:756-767`). `src/shared/lib/storage.ts` exposes individual localStorage operations, not a transaction.
- **Reproduce:** use an isolated synthetic profile and induce a quota/storage failure or interleaving tab write between those steps; this failure was not induced in this audit.
- **Expected/actual:** all-or-nothing company/account/membership/trial creation; current code attempts compensation but cannot guarantee atomicity across tabs or crashes.
- **Impact:** orphaned tenant data, missing owner or inconsistent metadata after interrupted signup.
- **Solution/test:** server transaction with unique constraints; for demo, recovery detection and staged commit marker. Fault-injection tests at every write boundary and concurrent-tab registration.

## ZA-010 · P2 · MISSING · Company identity and duplicate policy

- **Evidence/root cause:** `src/domain/auth.ts:172-181` checks only company length; `AppContext.tsx:730-746` checks duplicate username/email but not company name or tax/registration ID; `src/domain/saas.ts:14,29-38` validates tenant IDs and membership uniqueness, not company identity. `src/data/mockData.ts:141` initializes tax ID to blank.
- **Reproduce:** register two synthetic companies with different owner logins and the same display name; no duplicate-company rule blocks it. This can be legitimate, so it is a missing policy, not an intrinsic uniqueness bug.
- **Expected/actual:** define legal identity verification and intentional duplicate-name behavior; current signup only creates a display name.
- **Impact:** ambiguous company administration and billing/onboarding records.
- **Solution/test:** decide whether names may duplicate; collect and verify jurisdictional identifiers server-side, with tests for same name/different entity and same legal ID.

## ZA-011 · P2 · BACKEND REQUIRED · Scoped support access absent

- **Evidence/root cause:** `PlatformPage.tsx:58-66` has company list, suspension and subscription override; no support-access grant, purpose, expiry, tenant-data boundary or impersonation audit. `docs/BACKEND_CONTRACT.md` requires explicit support approval and expiry.
- **Reproduce:** inspect platform operations and try to initiate a time-limited support session; there is no workflow.
- **Expected/actual:** least-privilege support access approved by tenant, time-bound and independently audited; no current support-access feature exists.
- **Impact:** platform operators cannot safely investigate tenant records; using direct storage access would evade a controlled support model.
- **Solution/test:** define server support grants and audit, deny tenant data by default, test expiry/revocation and cross-tenant boundaries.

## ZA-012 · P2 · CONFIRMED · Scoped employee without a home site

- **Evidence/root cause:** a new tenant has one branch and warehouse but no work center (`src/data/mockData.ts:137-148`). Employee form defaults `workCenterId` to empty when none exists, permits empty warehouse, and validates only name/cost/attendance (`src/features/employees/pages/Employees.tsx:68-84`). `src/domain/actions.ts:4265-4297` validates a location reference only when present. `src/domain/access.ts:389-395,435-440` denies located actions for a scoped role without a home branch. A synthetic probe created `role2` Production Manager with no work center or warehouse successfully; a located action returned the missing-site blocker.
- **Reproduce:** register a clean synthetic company, create a Production Manager employee before configuring a work center, leave warehouse blank, create its account and sign in; try a branch-located operation.
- **Expected/actual:** activation requires a valid branch assignment and the role's required work center/warehouse, or clearly leaves the profile pending. Current profile/account creation succeeds and the worker reaches a workspace where located work is refused.
- **Impact:** owner believes access is ready, but the employee cannot perform delegated tasks; support burden and possible pressure to assign an overbroad role.
- **Solution/test:** add explicit branch to employee membership/profile and validate home requirements per role at creation/activation; guide the owner to create a work center or assign the existing warehouse. Test fresh-company creation of each scoped role with missing and valid home site.

## Fixed historical items, not counted above

Phase 3.2 reported P32-001 through P32-013. `tests/phase33.test.mjs` and `tests/phase34.test.mjs` cover backup escalation, branch writes, role delegation, subscription revival, tenant lockout, MO transitions, SO close, employee reference deletion, tab switching and provisional COGS labelling; the current full domain/UI suites pass. The historical P32-002 **write** bug is distinct from ZA-001 **read** exposure. The current register UI has no public role selector (`AuthPages.tsx:175-185`). No historical P32 issue is asserted reopened by this audit.

## Phase 3.6 update (2026-11-09)

The original findings above remain the audit baseline; these are the current implementation results.

| ID | Result | Limit |
| --- | --- | --- |
| ZA-001 | FIXED in tested branch views | Employee, site, expense, ledger and derived debt projection is scoped; multi-branch assignment is explicit. Client-owned state is still demo security. |
| ZA-002 | CORE FIXED | Tracked material and converted service value enter each partial receipt and accepted LOT once. QC scrap writes its share off. A quote can be corrected with a reason before first receipt and a Draft can be cancelled with history; post-receipt correction, supplier return and final COGS variance posting remain open. |
| ZA-004 | FIXED | Public registration validates owner/company at the provider and domain entry, rejects duplicate login and in-flight submission. |
| ZA-005 | FIXED in one browser store | Recovery ticket fingerprint is persisted and checked before reuse; cross-device atomic consumption needs a server. |
| ZA-006 | FIXED in active page | Timer revokes an expired platform ticket and hides company metadata; mutation rechecks the signature. |
| ZA-007 | PARTIAL | Temporary activation/reissue expires after seven days; secure invitation delivery requires a server. |
| ZA-008 | OPEN | No reliable final variance journal was introduced. |
| ZA-009 | OPEN | Browser `localStorage` has no multi-key transaction or cross-tab lock. |
| ZA-010 | OPEN | Company name uniqueness needs an authoritative tenant registry and product policy. |
| ZA-011 | BACKEND REQUIRED | No support impersonation is exposed. |
| ZA-012 | FIXED | New scoped profiles and account activation require a valid assigned site. |

See `ZENIX_PHASE36_REPORT.md` for validation and remaining work.
