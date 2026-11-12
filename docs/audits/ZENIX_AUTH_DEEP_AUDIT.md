# ZENIX authentication and onboarding deep audit

**Date/source:** 2026-11-09; current `main` worktree at `dbbe317550e51154429d0ceb70529060038223a2` with uncommitted changes. Browser-only SaaS demo. Status **PARTIAL** because no server exists, fault injection was not run, and full browser recovery/activation paths were not exhaustively exercised. Findings are keyed in `ZENIX_AUDIT_ISSUES.md`.

## Public signup

The rendered `/register` form asks for owner name, company, login/phone, optional email and password/confirmation. There is no role selector (`src/features/auth/pages/AuthPages.tsx:148-185`). `registrationProblem` checks these fields (`src/domain/auth.ts:168-183`), and `setupFirstAdmin` always assigns `business_owner` (`:189-203`). The direct action never accepts a role ID. A Platform operator cannot register through this route; platform identity uses a separate signed ticket (`src/features/platform/PlatformPage.tsx:9-35`). **UI contract verified by source and existing tests** (`tests/saas.test.mjs:19-29`, `tests/ui/phase33.test.tsx`, Chrome signup setup).

For the first company, `AppContext.tsx:748-767` checks damaged/legacy storage before binding an owner, then creates a 14-day Enterprise trial (`src/domain/saas.ts:54-59`) and signs the owner in. For a later company in the same browser, `AppContext.tsx:730-746` builds an empty tenant state (`src/data/mockData.ts:137-149`), creates a new owner account/membership/trial and preserves the older tenant key. Tenant IDs map only to a strict UUID key pattern (`src/domain/saas.ts:20-24`). Username/email duplicates are checked against global accounts (`AppContext.tsx:733`, `src/domain/auth.ts:101-104`). The company display name has no duplicate/identity policy (ZA-010).

**Defects and limits:** Full name/company validation is only invoked by the form; the action/domain setup does not enforce it (ZA-004). Signup spans separate localStorage writes, with compensating rollback but no atomic transaction or cross-tab lock (ZA-009). Cancellation before submit creates nothing; interruption during commit has not been fault-tested. First-login owner has `mustChangePassword:false` because the owner chose the initial password; employees are treated differently. Existing business storage with missing/damaged auth is blocked rather than claimed by a new owner (`src/domain/auth.ts:145-165`, `AppContext.tsx:748-750`). This legacy protection is covered by tests but was not exercised against real data.

## Sign in, lockout and sessions

`normalizeLogin` trims/case-folds login/email and canonicalizes Uzbek or international phone formats (`src/domain/auth.ts:47-57,93-104`). Passwords use WebCrypto PBKDF2-SHA-256, 210,000 iterations and a per-password 16-byte random salt (`src/shared/lib/crypto.ts:4-20,54-62`). This is a client demo hash and cannot protect a client-controlled hash store. No real passwords or hashes are in this package.

The login path checks an existing lock, hashes unknown-login attempts to reduce timing differences, verifies password, finds an active membership/tenant, loads the tenant state, checks account/employee/role, then saves a tenant-specific session (`AppContext.tsx:689-724`). Failed attempts use the strictest threshold and longest lock of the account's tenant policies (`src/domain/auth.ts:39-43`, `AppContext.tsx:695-705`); unknown-login attempts use the global fallback. `recordFailure` logs login/lockout (`src/domain/auth.ts:241-257`). Whether cross-device rate limiting works is **BACKEND REQUIRED**.

Session normalization rejects incomplete timestamps and manipulated tenant ID shapes (`src/domain/auth.ts:70-77`). `sessionProblem` refuses missing/blocked accounts, archived employees, role loss, password changes, absolute expiry and idle timeout for non-remembered sessions (`:278-291`). The provider also requires active membership and active tenant on render/action (`AppContext.tsx:371-419`) and checks on a timer and storage events (`:907-947`). Logout removes the shared browser session (`:677-686`). Remembered sessions have absolute expiry but no idle timeout by design; the selected tenant policy is used for new session duration and later idle checks (`AppContext.tsx:272-273,721,913`). Multiple memberships are selected from the prior account's tenant or the first active membership (`:710-713`); account switching validates destination membership and employee (`:959-977`). Tab switching with dirty forms has regression coverage in `tests/ui/tenant.test.tsx` and Chrome E2E, but simultaneous-device behavior is absent.

**Tested in current suites:** wrong credentials, lockout policy, owner/company status, role changes, expired/invalid sessions, credential invalidation and tenant switching are represented in `tests/auth.test.mjs`, `tests/phase33.test.mjs`, `tests/saas.test.mjs`, `tests/ui/auth.test.tsx`, `tests/ui/tenant.test.tsx` and `e2e/smoke.spec.ts`. The current domain/UI suites passed; Chrome E2E did not reach browser assertions in this audit. This does not verify every combination. Browser storage manipulation cannot be considered an authorization bypass test of a production backend because no backend exists (ZA-003).

## Employee creation and activation

The owner creates a profile at Employees (`src/features/employees/pages/Employees.tsx:40-84`), selecting role, department, work center and warehouse. Account creation and temporary password issuance occur in Admin user management (`src/app/providers/AppProvider/AppContext.tsx:843-860`; `src/domain/auth.ts:296-312`). These are two UI steps; the profile alone does not permit login. The account is immediately active but `mustChangePassword:true`; routing to `ForcePasswordChange` and its form is at `src/features/auth/pages/AuthPages.tsx:275-300`. The employee cannot change role/membership in that form. `createUser` ignores caller-supplied `mustChangePassword` and forces true (`AppContext.tsx:853`). Existing account/login/email duplicates are refused (`src/domain/auth.ts:304-309`, `AppContext.tsx:852`). Employee profile creation enforces plan limits via the domain action; account creation checks an active subscription (`AppContext.tsx:847-851`).

Delegated managers need both employee and user rights and can assign only lower-rank roles within scope (`src/domain/access.ts:165-210,298-314,389-413`); the tests in `tests/phase33.test.mjs:43-84` cover branch writes and role assignment. Disabling an account or membership blocks further access, while employee archival retains records; reference checks block destructive deletion of linked records (`src/domain/actions.ts:4148-4169`). A temporary password ceases to verify once replaced, and password version invalidates old sessions (`src/domain/auth.ts:287-290,354-359`). **Missing:** invitation/activation expiry and secure delivery (ZA-007). A fresh company can create a scoped manager with no home site, producing an account whose located actions are refused (ZA-012). The app displays the temporary credential in the controlled local demo flow; a production flow needs one-time server token delivery. The separate profile/account steps can leave a profile without account after cancellation; this is valid draft state, but the UI should make activation status explicit.

## Recovery and password management

Owners receive a one-time displayed recovery key at signup; only its hash is stored (`src/shared/lib/crypto.ts:24-36`, `src/domain/auth.ts:19-20`). Recovery verifies an owner with active membership/tenant and rotates both password and recovery key (`AppContext.tsx:770-805`, `src/domain/auth.ts:220-227`). An alternative ECDSA ticket is bound to login, page nonce and expiry (`AuthPages.tsx:189-225`, `src/domain/auth.ts:211-212`, `src/shared/lib/crypto.ts:38-51`). Reusing the same ticket within a page visit verifies twice (ZA-005). Employee recovery is administrator password reset (`src/domain/auth.ts:344-351`), followed by forced change. Reset of a shared multi-tenant account by one tenant admin is refused (`AppContext.tsx:883-887`).

Current password is checked before self-change, new password policy is applied, and the current session timestamp is renewed (`AppContext.tsx:830-840`). Admin reset marks `mustChangePassword` and invalidates prior sessions on next check. A recovery commit's result is not checked before reporting success (`AppContext.tsx:771-776`); a storage-failure probe is needed before classifying this as a current defect. The signed recovery ticket has no server-side replay ledger; that remains a release blocker even if a client-side used flag is added.

## Verification summary

| Area | Status | Evidence/limit |
| --- | --- | --- |
| Owner-only public role | VERIFIED | Source, signup and SaaS tests |
| Duplicate account login/email | VERIFIED | Source and auth tests; cross-browser uniqueness absent |
| Tenant/trial creation | VERIFIED for browser demo | Source and SaaS/UI tests; interruption atomicity PARTIAL |
| Failed login/lockout | VERIFIED for browser demo | Domain tests and source; server rate limiting absent |
| Session expiry/role/status revocation | VERIFIED for browser demo | Domain/UI tests; multi-device revocation absent |
| Employee role/scope/first change | VERIFIED for tested flows | Phase 3.3 tests; invitation lifecycle MISSING |
| Owner recovery key | PARTIAL | Code and domain coverage; full Chrome flow not rerun |
| Signed ticket replay | CONFIRMED finding | Synthetic cryptographic probe; full browser repeat PARTIAL |
| Client-state tampering | BACKEND REQUIRED | All state is browser-owned |

## Phase 3.6 addendum

ZA-004, ZA-005, ZA-006 and ZA-012 are repaired in the tested frontend flow: strict public-owner entry, persisted signed-ticket consumption, live platform-ticket expiry, and scoped employee activation. Temporary passwords expire after seven days unused. The original findings above describe the pre-fix baseline. Atomic multi-key signup, cross-device replay prevention, invitation delivery and trusted authorization remain backend work; see `ZENIX_PHASE36_REPORT.md`.
