# Authentication and company access (frontend demo)

This app has no backend. `localStorage`, browser sessions, role checks, tenant membership and plan checks organize the local demo. Anyone who controls the browser can alter them. A production SaaS must enforce all of these rules on a server and in a tenant scoped database.

## Existing components retained

Login accepts a normalized phone number, username or email. Passwords are salted PBKDF2-SHA-256 hashes made through WebCrypto; plain passwords are never stored. Five failures cause a 15 minute local lockout. Sessions expire after 12 hours, or 30 days with “remember me”; ordinary sessions also expire after 30 minutes idle. Password changes and recovery invalidate older sessions. The recovery key is one use; the optional signed ticket binds the login, page nonce and expiry. Its verification in a browser is demo protection only. No email or SMS is sent.

The existing role matrix in `domain/access.ts`, route guards, scoped views and command checks remain in use. `domain/actions.ts` still owns ERP workflows. Account and security events remain separate from business backup exports.

## Phase 1 model and migration

`zenix-manufacturing-v3-state` remains the original company's ERP state. Each subsequent company uses `zenix-erp-<tenant-id>-state`. The key resolver accepts only the explicit legacy ID or a generated UUID tenant ID. The React provider is keyed by tenant ID, so switching replaces the entire company context and all page component state. Backups, repair copies, migration copies, clean markers and activity archives are also tenant scoped; the original keys remain for the legacy tenant. A missing or unreadable new-company state does not silently fall back to the legacy state.

Schema v6 adds the `business_owner` role and changes every pre-v6 public `super_admin` employee assignment to that role. Employee IDs, role IDs of all other users, production records and other operational lists remain intact. The existing loader saves the original state under `zenix-manufacturing-before-v6` before migration; migration is repeat safe. If that backup cannot be stored, the loader keeps the original text in memory for download and warns before a write. Multi-tenant storage does not change the ERP schema version: it selects a separate key before loading that same schema.

`zenix-auth-v1` keeps the existing account store. `zenix-session-v1` adds an optional tenant ID; sessions without it remain assigned to the legacy tenant. `zenix-saas-v1` stores demo tenants, memberships, subscriptions and administrative events separately. On upgrade, an existing owner account binds the original ERP state to the explicit legacy tenant (`tenant-legacy-v3`); existing accounts receive memberships for that tenant. No account becomes a platform identity. If metadata is malformed, login and registration fail closed. A fresh browser signup gets a 14 day Enterprise demo trial; an old browser gets an active Enterprise compatibility subscription. These are demo defaults, not commercial entitlements.

New account records carry their original tenant ID. If the SaaS metadata key is later lost, legacy reconstruction excludes those new-company identities instead of assigning them to old ERP records. Old account records without a tenant ID remain eligible only for the original legacy mapping.

Security policy changes are stored per tenant in the auth store; the original policy remains the legacy/default fallback. A shared account's tenant employee ID and role come from its active membership. A tenant administrator may disable that membership without deleting the identity used by another tenant, but cannot reset that shared identity's global password.

The public registration form creates a **Business Owner**, never a Platform Super Admin. First setup keeps the original ERP key. Later signup creates a new tenant ID, a separate minimal ERP state (one owner, a starter branch and warehouse, empty operational and master collections), membership and trial. The new owner signs in after saving their recovery key. A duplicate login or email is rejected globally. Employee accounts are created through Admin Panel and linked to the current tenant. The final active owner cannot be disabled, archived, demoted or deleted through supported flows. No ownership is inferred from the oldest account during recovery.

Public pages keep initial demo data in memory until signup succeeds. If an ERP state is already stored but its account records are missing, signup is blocked: the app will not hand ambiguous historical data to a new account. Existing localStorage keys are never cleared automatically.

Company and employee roles remain separate from platform access. A company role cannot receive `platform` permission, and the company role assignment flow refuses `super_admin`. The legacy `super_admin` definition stays readable so older role records are not discarded, but v6 removes its prior public assignments. A platform demo ticket is signed by an offline key outside the app; true trusted provisioning and durable authorization require a backend.

The owner outranks the company admin; delegated production and supply managers outrank operational employees. A manager needs explicit `users.create` and `employees.create` grants before opening an employee account, and can assign only subordinate roles. `subscription.edit` remains owner only even if a custom role stores that flag.

## Plans and usage

`domain/saas.ts` defines Free, Plus, Pro and Enterprise as a data catalog, without prices. It records employee, branch, warehouse, module, AI and API limits. Usage derives from live ERP records. Role authorization and plan entitlement are checked together at the route/action entry points. New employees, branches and warehouses are blocked at a reached limit, including duplicate and reactivation paths. Downgrades do not remove historical data. An owner may choose a demo plan at `/subscription`; confirmation states that no payment occurs. Subscription history and a change event are kept in `zenix-saas-v1`.

Tenant switching lists only active memberships and changes the complete ERP workspace after confirmation. The active tenant ID is stored in the session and checked against membership, tenant status, employee status, role and subscription at action time. A suspended tenant or removed membership loses ordinary UI access. The provider remount clears in-progress company forms and derived page caches. This is application-level demo separation: anyone with browser storage access can read or edit every local company state.

There is no real billing, payment gateway, support impersonation, email invitation delivery or server health metric. Owner plan selections are marked as demo changes; trial selections keep their trial deadline. Platform plan overrides are explicitly administrative demo entries with reason and audit event, never proof of payment. AI and API quantities are catalog fields, not metered integrations.

## Separate platform demo workspace

`/platform` has separate navigation and no company role route. To provision an operator for a local demo, run `node scripts/platform-provision.mjs keygen` outside deployment, keep the private key outside the repository, set `VITE_PLATFORM_PUBLIC_KEY` in build settings and restart. Run `node scripts/platform-provision.mjs ticket --actor <operator-id>` to issue a short lived ticket. Enter that actor ID and ticket on `/platform`. The ticket is kept only in `sessionStorage` and its signature and expiry are rechecked before each platform mutation. Do not place the private key or a master password in browser storage or the build.

Phase 4.1 turns `/platform` into a routed workspace with nine sections (Overview, Companies, Plans & Subscriptions, Billing, Support, Features, Security & Audit, Settings, System Health). Domain logic lives in `src/domain/platform.ts`; platform settings, the platform audit log and demo support tickets are stored under `zenix-platform-v1`, separate from tenant audit logs. Feature restrictions are an optional append-only `featureOverrides` list in `zenix-saas-v1`: they can only switch a plan module off for one tenant (or back to the plan default) and never grant a module or an RBAC permission. The platform never opens a company's ERP state and never invents uptime, revenue, payment or API statistics. The registration policy (open/closed) and default trial length from platform settings apply to additional company signups only; existing subscriptions are not migrated. A browser owner can still modify local storage and bypass this demo UI. Details: `docs/audits/ZENIX_PHASE41_PLATFORM_ADMIN.md`.

AI credits and API access are catalog fields for a future server. The current UI checks the AI module entitlement, but does not meter AI requests or provide API integration. Branch and warehouse limits apply to supported creation/reactivation commands; a server must enforce all usage limits atomically across every write path.

## Backend integration contract

The server must own identities, credential hashes (prefer an appropriate server password hashing function), session revocation and rate limiting; issue HttpOnly Secure SameSite cookies; and verify recovery tickets or deliver reset links. Platform roles must be in a separate authority from tenant roles. Every API request must resolve an active membership for an explicit tenant ID, check tenant status, scope, role permission and plan entitlement, then execute the action against records constrained by that tenant ID. Tenant ID must come from authenticated server context, never merely from a client payload. Every ERP table, inventory movement, BOM reference, production reservation, lot/serial, financial ledger, notification, audit event and export query needs a tenant key enforced by database constraints and query predicates. A tenant switch must invalidate stale server-side caches and in-flight commands.

Store tenants, memberships, invitations, role assignments, subscriptions, plan changes and audit events in transactional tables. Enforce unique identifiers and membership constraints in the database. Enforce owner transfer and last owner rules transactionally. Define payment webhook and plan change contracts server side before activating paid plans. Serve platform analytics from actual stored records, with platform action audit and reason fields. Migrate the single legacy ERP state only after its legitimate owner explicitly claims a server tenant; never assign ambiguous records to a different company.

## Recovery ticket setup for the existing demo

Run `node scripts/auth-recovery.mjs keygen`, keep the private key outside the repository, and set `VITE_RECOVERY_PUBLIC_KEY` for the build. The “Kalitim yo‘q” page shows a command that signs a short lived, page bound ticket. A browser held verification key does not make local accounts secure against storage manipulation. The one use recovery key remains available without this configuration.

## Phase 3.6 activation and recovery update

New and reissued employee temporary passwords expire after seven days unused and require a password change. Activation checks the assigned role site, active tenant and plan limit. The administrator hands over credentials in the local demo flow; no email or SMS delivery is claimed. A used signed owner recovery ticket leaves a SHA-256 fingerprint in the browser auth store and is rejected on reuse in that store. Production needs server-side atomic ticket consumption, multi-device revocation and one-time activation delivery.

While `/platform` is open, a one-second expiry check removes the platform session and hides company metadata. Every write rechecks the ticket signature. The Billing, Support, Features, Settings and Health panels identify backend-dependent capabilities without fabricating live data.

## Business registration and employee activation (2026-11-09)

Root cause of "only Login is visible": the checkout at `Desktop/Proyects/zenix` (main @ 1ecaf89, used by the `zenix-dev` preview) predates PR #4. It has only a first-run `/setup` page that redirects to `/login` once any account exists. This worktree already had `/register`; the entry point was only a small tab and ignored the platform policy.

- Login shows **Yangi biznes yaratish** while public registration is open. When the platform closes it (`zenix-platform-v1` → `registration: closed`), Login explains this and `/register` shows a closed state. The first company of an empty browser is never blocked.
- Registration fields: owner name, company, phone (required, canonical `+digits`, also a sign-in identifier), login, optional e-mail, password + confirmation. There is no role choice: the account is always the tenant's Business Owner and never a platform identity. `registrationProblem` and `registerCompanyOwner` validate the same rules; AppContext rejects a login, e-mail or phone already used by any account before writing anything.
- A new company gets its own tenant ID, ERP key, membership and the platform's default trial length (Enterprise demo trial; no payment).
- The new-employee form now has a **Filial** selector limited to the actor's own branches; work centers and warehouses follow the branch. Domain scope rules (`employeeWriteBlocker`, `assignRoleBlocker`) stay the authority. A new company has no work centers yet, so an Operator role needs one created first.
- A deliberate sign-out returns to a plain `/login`; session expiry or idle keeps `?next=` so the same person returns to their page.

Backend-dependent: registration writes the ERP key, SaaS metadata and auth store separately and rolls back best-effort; a server must create tenant, owner, membership and trial in one transaction with unique constraints on login, e-mail and phone, verify the phone (OTP), rate-limit signups and deliver employee activation links instead of hand-over temporary passwords.
