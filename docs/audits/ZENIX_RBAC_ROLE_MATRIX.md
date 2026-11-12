# ZENIX current role and permission matrix

**Source/date:** `src/domain/access.ts:12-36,41-63,74-116,133-210,228-413,453-549`; current worktree 2026-11-09. A tick below means `hasPermission` grants that action; an operation also requires its domain rule, scope, active membership/session and plan entitlement. `V` view, `C` create, `E` edit, `D` delete, `A` approve, `X` export, `R` execute. There is **no platform permission in any tenant role** (`access.ts:56`). Route exposure is governed by `src/routes/navigation.ts` and `src/App.tsx`; operation decisions are not inferred from a visible button.

## Actual roles discovered

| ID/key | Label | Rank | Default scope | Tenant/assignment note |
| --- | --- | ---: | --- | --- |
| `role0/super_admin` | Eski Super Admin | 5 | all | Legacy tenant role, effective view-only; not assignable; **not** platform identity |
| `role_owner/business_owner` | Biznes egasi | 4 | all | Public signup assigns this role only; subscription edit |
| `role1/admin` | Admin / Direktor | 3 | all | Full company administration below own rank; subscription view |
| `role2/production_manager` | Ishlab chiqarish menejeri | 2 | branch | Production/BOM/warehouse operations in home branch |
| `role7/supply_sales` | Ta’minot va sotuv menejeri | 2 | all | Purchases and sales management |
| `role5/operator` | Operator | 1 | workcenter | Shop-floor execute in home work center |
| `role3/quality` | Sifat nazoratchisi | 1 | branch | Quality approval in home branch |
| `role4/maintenance` | Texnik xizmat muhandisi | 1 | branch | Equipment/maintenance in home branch |
| `role6/warehouse` | Omborchi | 1 | warehouse | Warehouse actions at assigned warehouse |
| `role-*` (custom) | Tenant-defined | configured, default 1 | configured | Starts without grants; rank and scope bounded by creator |
| none (platform) | Platform operator | separate | browser-wide metadata | Signed ECDSA ticket; no tenant role or ERP data authority |

`src/domain/access.ts:41-46,532-549` defines ranks/defaults. `src/types/index.ts:225-227` defines custom role rank/scope. The legacy `role0` stores a full matrix for compatibility but `hasPermission` returns only `view` (`access.ts:53-63`); it should not be mistaken for an active platform role.

## Effective permission matrix

| Module | Legacy | Owner | Admin | Prod mgr | Supply mgr | Operator | Quality | Maintenance | Warehouse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production | V | VCEDAXR | VCEDAXR | VCEDAXR | V | VR | V | V | V |
| products | V | VCEDAX | VCEDAX | VCEDAX | V | V | V | — | V |
| materials | V | VCEDX | VCEDX | VCEDX | VEX | — | — | V | VX |
| warehouse | V | VCEDX | VCEDX | VEX | V | — | V | V | VCEDX |
| purchases | V | VCEDAX | VCEDAX | VCX | VCEDAX | — | V | — | VE |
| sales | V | VCEDAX | VCEDAX | VX | VCEDAX | — | V | — | VE |
| quality | V | VCEDAX | VCEDAX | VCX | — | VC | VCEDAX | — | V |
| equipment | V | VCEDAX | VCEDAX | VCEX | — | VC | — | VCEDAX | — |
| employees | V | VCEDX | VCEDX | V | — | — | — | — | — |
| costs | V | VCEDX | VCEDX | VX | V | — | — | — | — |
| reports | V | VX | VX | VX | VX | — | VX | VX | VX |
| ai | V | V | V | V | V | — | V | V | — |
| settings | V | VEX | VEX | — | — | — | — | — | — |
| users | V | VCED | VCED | — | — | — | — | — | — |
| roles | V | VCED | VCED | — | — | — | — | — | — |
| audit | V | VX | VX | — | — | — | — | — | — |
| subscription | V | VE | V | — | — | — | — | — | — |
| platform | — | — | — | — | — | — | — | — | — |

System-role grants are in `src/domain/access.ts:532-549`; `hasPermission` overrides legacy and subscription edit in `:53-63`. Custom roles have no fixed row: effective grants equal their stored `permissions`, subject to `roleRank`, `scopeMayDelegate`, creator checks and plan. `dashboard.view` is granted to every signed-in role in `hasPermission` (`:59-63`).

## Scope, pages and operations

| Scope | Read projection | Write boundary | Current gap |
| --- | --- | --- | --- |
| all | Entire tenant state | Tenant actions, subject to role/plan | Browser data is mutable by client |
| branch | Warehouse/order/quality/equipment by home branch | Location targets in `scopeBlocker` | Employees and unlinked financial rows remain global (ZA-001) |
| warehouse | Own warehouse stock/LOT and related records | Own warehouse for located stock actions | Some branch-wide non-stock views remain |
| workcenter | Home work-center orders/events | Work-center execution and branch checks | Master data remains global |

`homeOf` derives branch from assigned warehouse or work center (`src/domain/access.ts:435-440`). `scopeTargets` covers entity and domain command arguments (`:228-355`); `scopeBlocker` refuses unknown/foreign locations (`:389-413`). `scopedView` projects read state (`:453-519`). It is this projection, not a server query. A role with `module.view` can reach that module's route/menu entry according to `src/routes/navigation.ts` and `src/App.tsx`; representative direct-route denial is tested for operator Purchases and company user `/platform` (`tests/ui/platform.test.tsx:25-31`, `e2e/smoke.spec.ts`). A full page-by-page, role-by-role UI sweep was **not** run, so allowed pages are the modules with `V`, subject to plan and route mappings, not a claim that every subview works.

A clean tenant starts without work centers, and the employee form permits a branch-scoped role with neither work center nor warehouse. That account is created but its located actions are denied because `homeOf` cannot derive a branch (ZA-012). A synthetic direct probe reproduced this state.

`ACTION_RULES` maps named domain commands to module actions (`src/domain/access.ts:74-116`), and `commandBlocker` combines rule and scope (`:356-364`). Unlisted commands are denied. Entity CRUD uses `ENTITY_MODULE` and action mapping (`:121-131`). Create/update/delete/approve/export are therefore distinguished per module above; a permission alone does not authorize every named command. Examples: production execution accepts `production.execute` or `.edit`, PO confirmation needs `purchases.approve`, stock adjustments need `warehouse.edit`, and account reset needs `users.edit` plus target rank/scope (`access.ts:74-116`, `src/domain/auth.ts:128-141,344-351`). Exports consume the scoped state and module export grants; ZA-001 may affect their content.

## Delegation and targeted security results

| Probe/condition | Current result | Evidence |
| --- | --- | --- |
| Public manager/employee/platform role choice | Denied by form and action contract | `AuthPages.tsx:148-185`; `auth.ts:189-203` |
| Manager self-promotion/other high-rank assignment | Denied | `access.ts:165-181`; `tests/access.test.mjs`, `tests/phase33.test.mjs` |
| Custom role escalation and scope widening | Denied in tested paths | `access.ts:139-181`; `tests/phase33.test.mjs:57-72` |
| Cross-branch employee write/password reset | Denied in tested paths | `access.ts:196-210,307-314`; `auth.ts:128-141`; `phase33.test.mjs:43-55` |
| Cross-branch employee/expense read | **Allowed** (ZA-001) | Synthetic `em2` b1 probe returned b2 `em7` and all expenses; `access.ts:494-519` |
| Cross-tenant action via tenant ID or direct route | Denied in supported UI; backend required | `AppContext.tsx:371-419,959-977`; `saas.ts:22-38`; `tests/ui/tenant.test.tsx` |
| Disabled user/membership/suspended company reuse | Denied on render/action in tests | `AppContext.tsx:371-419`; `auth.ts:260-291`; `saas.test.mjs` |
| Privileged action after role downgrade | Current role read from state; tested in domain/UI | `AppContext.tsx:377-419`; `tests/access.test.mjs` |
| Final active owner removal | Denied | `access.ts:185-210`; `auth.ts:106-116,331-369`; `AppContext.tsx:431-432` |
| Subscription bypass via self-plan change | Denied for expired/suspended; local storage mutable | `saas.ts:65-87`; `tests/phase33.test.mjs:88-105` |
| Backup import escalation | Denied in tested payloads | `src/domain/backupSecurity.ts`; `tests/phase33.test.mjs:21-40` |
| Shared identity across tenants | Tenant admin cannot reset global password or delete global account through its membership | `AppContext.tsx:644-648,870-900`; `tests/ui/tenant.test.tsx` |
| Platform direct route with company session | Denied in test | `PlatformPage.tsx:9-35`; `tests/ui/platform.test.tsx:25-31` |

**Platform separation:** `scripts/platform-provision.mjs:11-28` generates an ECDSA key outside the repository and issues a 1–60 minute ticket for a syntactically valid operator ID. There is no operator registry, MFA or ticket revocation in this demo. The ticket signs operator ID and expiry (`PlatformPage.tsx:12-13`); companies and subscriptions are metadata-only (`:58-66`). Platform view expiry is ZA-006, support access is ZA-011, and production trust is ZA-003. Platform actions write mutable browser SaaS metadata and events, not an immutable server audit. There is no tenant ERP read route in the platform page.

**Unverified at the original audit:** exhaustive 9-role × all routes × every action export; warehouse-role live UI with assigned user; forged localStorage state in a browser (known non-boundary); concurrent cross-tab authorization race; actual server/API checks (none exist). The original Chrome E2E stall was caused by the restricted local socket; Phase 3.6 ran 27/27 Chrome desktop/mobile cases outside that sandbox.

## Phase 3.6 matrix delta

No module permission was granted to a tenant role. Scope enforcement now filters employee, site, expense and financial projections and checks expense/subcontract writes by site. Explicit branch IDs permit authorized multi-branch workers while a scoped role without a site cannot activate. Business Owner and company Admin remain tenant roles; the separately ticketed `/platform` operator has no manufacturing permissions. Manager delegation continues to require employee and user rights, lower-rank target roles and no permission/scope expansion. The frontend permission matrix is a demo boundary until server enforcement exists.
