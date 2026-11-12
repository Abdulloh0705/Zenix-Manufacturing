# ZENIX Phase 3.2 — Role & Permission Matrix

Generated from source on 2026-11-07 (`src/domain/access.ts` `SYSTEM_ROLES`, `hasPermission`, `roleRank`) with a probe that calls `hasPermission` for every role × module × action. Browser demo enforcement only (BR-01).

## 1. Roles discovered in source

| Level | Role (key) | id | Rank | Scope | Notes |
|---|---|---|---|---|---|
| Platform | Platform operator | — | — | — | Not a company role. `/platform` gated by signed ECDSA ticket (`PlatformPage.tsx`); `hasPermission(*, 'platform')` is always false for every company role. |
| Tenant | Legacy Super Admin (`super_admin`) | role0 | 5 | all | Described as read-only legacy, **but `hasPermission` grants everything** and bypasses rank checks. Not assignable via UI; reachable via backup import (P32-001). |
| Tenant | Business Owner (`business_owner`) | role_owner | 4 | all | All modules; only role with `subscription.edit`. Given at registration (`setupFirstAdmin`). |
| Tenant | Admin / Director (`admin`) | role1 | 3 | all | All modules; `subscription` view only. Manages roles/users below rank 3. |
| Tenant | Production Manager (`production_manager`) | role2 | 2 | branch | "Manager" tier. No user/role rights by default. |
| Tenant | Supply & Sales Manager (`supply_sales`) | role7 | 2 | all | |
| Tenant | Operator (`operator`) | role5 | 1 | workcenter | |
| Tenant | Quality Inspector (`quality`) | role3 | 1 | branch | |
| Tenant | Maintenance Engineer (`maintenance`) | role4 | 1 | branch | |
| Tenant | Warehouse Keeper (`warehouse`) | role6 | 1 | warehouse | Seed has no employee with this role. |
| Tenant | Custom roles | role-* | **1 (fixed)** | chosen, default `all` | Created by `roles.create`; start with no permissions (P32-003, P32-009). |

There is no separate "Company Admin" vs "Director" role; one `admin` role covers both.

## 2. Module permissions (system roles)

V view · C create · E edit · D delete · A approve · X export · R execute. `dashboard.view` is open to every signed-in role.

| Module | super_admin | business_owner | admin | production_manager | operator | quality | maintenance | warehouse | supply_sales |
|---|---|---|---|---|---|---|---|---|---|
| production | VCEDAXR | VCEDAXR | VCEDAXR | VCEDAXR | VR | V | V | V | V |
| products | VCEDAX | VCEDAX | VCEDAX | VCEDAX | V | V | — | V | V |
| materials | VCEDX | VCEDX | VCEDX | VCEDX | — | — | V | VX | VEX |
| warehouse | VCEDX | VCEDX | VCEDX | VEX | — | V | V | VCEDX | V |
| purchases | VCEDAX | VCEDAX | VCEDAX | VCX | — | V | — | VE | VCEDAX |
| sales | VCEDAX | VCEDAX | VCEDAX | VX | — | V | — | VE | VCEDAX |
| quality | VCEDAX | VCEDAX | VCEDAX | VCX | VC | VCEDAX | — | V | — |
| equipment | VCEDAX | VCEDAX | VCEDAX | VCEX | VC | — | VCEDAX | — | — |
| employees | VCEDX | VCEDX | VCEDX | V | — | — | — | — | — |
| costs | VCEDX | VCEDX | VCEDX | VX | — | — | — | — | V |
| reports | VX | VX | VX | VX | — | VX | VX | VX | VX |
| ai | V | V | V | V | — | V | V | — | V |
| settings | VEX | VEX | VEX | — | — | — | — | — | — |
| users | VCED | VCED | VCED | — | — | — | — | — | — |
| roles | VCED | VCED | VCED | — | — | — | — | — | — |
| audit | VX | VX | VX | — | — | — | — | — | — |
| subscription | VE | VE | V | — | — | — | — | — | — |
| platform | — | — | — | — | — | — | — | — | — |

Effective access = role permission **AND** plan entitlement (`saas.entitlement`, AppContext `can`/`allowed`). Plans: Free = production, products, materials, warehouse, employees, settings; Plus adds purchases, sales, quality, equipment, costs, reports; Pro/Enterprise add ai. `dashboard/users/roles/audit/settings/subscription` are never plan-gated. Entitlement never widens RBAC (verified in `allowed`, `AppContext.tsx:375-383`).

## 3. Domain action rules (selected)

Every domain command goes through `commandBlocker` = `ACTION_RULES` (any listed rule suffices) + `scopeBlocker`; unlisted commands are refused. Highlights:

| Action | Rule | Scope target |
|---|---|---|
| createProductionOrder | production.create | warehouse, work center, line branch |
| transitionProduction → run/pause/QC | production.execute or .edit | MO work centers + warehouse |
| other transitions (confirm, close, cancel) | production.edit | same |
| reportOutput, recordScrap, start/finishWorkOrder | production.execute or .edit | work order center |
| createPurchaseOrder (non-draft) / confirmPurchase | purchases.approve | PO warehouse |
| receivePurchase | purchases.edit or warehouse.edit | receipt warehouse |
| inspectReceipt, resolveQuality | quality.edit | source warehouse / MO |
| recordSupplierPayment, adjustSupplierBalance | purchases.approve or costs.edit | PO warehouse (payment only) |
| deliverSalesOrder | sales.edit or warehouse.edit | SO sites |
| recordCustomerPayment / adjustCustomerBalance | sales.edit / sales.approve | none (customer level) |
| transfer/adjust/countStock | warehouse.edit | warehouses |
| reconcileReworkOwnership | quality.edit or production.edit | MO |
| create/update/deleteRole, updateRolePermission | roles.* | **none** (P32-003) |
| entity CRUD (employees) | employees.* ; roleId/archive → users.edit; delete → users.delete | **none for employees** (P32-002) |
| backup import / reset transactions | settings.edit | none (P32-001) |
| changePlan | subscription.edit (owner only) | — |

## 4. Scopes

| Scope | Reads (`scopedView`) | Writes (`scopeBlocker`) |
|---|---|---|
| all | everything | everything |
| branch | stock, MOs, POs, SOs, returns, QC, equipment, notifications of own branch; master data complete | sites of own branch |
| warehouse | stock of own warehouse (branch if none); orders of branch | own warehouse only |
| workcenter | MOs/events of own work center; branch stock | shop-floor work only at own work center, rest inside branch |

A scoped role without a home (work center / warehouse) is refused every located action.

## 5. Delegation boundaries

| Rule | Implemented | Verified |
|---|---|---|
| Nobody edits own role / own permissions | yes (`rolePermissionBlocker`, `assignRoleBlocker`, `employeeWriteBlocker`) | probe A5, A6 |
| Grant only permissions you hold | yes (`rolePermissionBlocker`, `duplicateRole`) | existing tests |
| Assign only roles ranked below you | yes (rank table) | probe A4 |
| Super Admin role never assignable in UI | yes | probe A6 |
| Last active owner cannot be removed/demoted | yes (`superAdminEmployees`, `superAdminInvariant`) | existing tests |
| Scope cannot be widened by delegation | **no** | P32-003 |
| Employee/user admin limited to own branch | **no** | P32-002 |
| Backup import respects all of the above | **no** | P32-001 |
| Custom roles can delegate | **no** (rank 1) | P32-009 |
| Company roles never get platform rights | yes | probe A7, UI test |

## 6. Denied-action results (probe `rbac.mjs` + existing tests)

| # | Attempt | Result |
|---|---|---|
| 1 | Operator changes own role via `updateEntity` | DENIED ("O‘z rolingizni o‘zgartira olmaysiz"); also lacks users.edit |
| 2 | Manager (with users rights) assigns Business Owner / Admin / Supply&Sales | DENIED (rank) |
| 3 | Manager assigns Operator | allowed (expected) |
| 4 | Admin assigns self or others Business Owner | DENIED |
| 5 | Admin → Business Owner via backup import | **ALLOWED** (P32-001) |
| 6 | b1 Manager archives / re-homes b2 employee | **ALLOWED** (P32-002) |
| 7 | b1 Manager widens system Operator role to `all`, grants production.edit | **ALLOWED** (P32-003) |
| 8 | Quality inspector adjusts stock | DENIED |
| 9 | Operator creates PO | DENIED |
| 10 | Manager creates non-draft PO (approve) | DENIED |
| 11 | b1 Manager transfers stock to b2 warehouse | DENIED (branch scope) |
| 12 | Unlisted command | DENIED |
| 13 | Archived employee signs in | DENIED (`signInBlocker`) |
| 14 | Company role `platform` permission | DENIED for all roles |
| 15 | Company session opens `/platform` management | DENIED (UI test `platform.test.tsx`) |
| 16 | Disabled membership / suspended tenant / expired subscription | DENIED (UI test `tenant.test.tsx`, `saas.test.mjs`) — but see P32-004 for self-reactivation |
| 17 | Role change while signed in | takes effect on next render (role read from state, not session) |
| 18 | Removed membership while signed in | logout within 15 s timer or next change (`AppContext.tsx` session check) |

## 7. Unverified permission paths

- Every UI button's disabled state per role (only representative pages; operator Purchases block covered by E2E).
- `supply_sales` (scope `all`, rank 2) across modules beyond rule review.
- Warehouse role behaviour — no seed employee; rules reviewed only.
- Attachments (`ATTACHMENT_MODULE`) and expense entities per role.
- AI answers per role (`answerQuestion` receives a module gate; outputs not compared per role).
