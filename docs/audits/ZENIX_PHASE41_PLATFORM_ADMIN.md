# ZENIX Phase 4.1 — Platform Super Admin (frontend demo)

Date: 2026-11-09 · Worktree: `C:\Users\user\Documents\ChatGPT\zenix` (main @ dbbe317 + uncommitted Phase 3.x/4.1 work) · Nothing committed.

**Security status: demo only.** Every rule below runs in the browser against `localStorage`/`sessionStorage`. Anyone controlling the browser can edit those keys and bypass the UI. Server-side enforcement is Phase 4.2.

## 1. Reused, not rewritten

| Existing piece | How Phase 4.1 uses it |
| --- | --- |
| `domain/saas.ts` — `PLAN_CATALOG`, tenants, memberships, append-only subscriptions, `setTenantStatus`, `platformOverridePlan`, `changePlan`, `entitlement`, `limitBlocker` | Single entitlement engine. Extended, not duplicated (see §4). |
| Signed platform ticket (`scripts/platform-provision.mjs`, `verifyRecoveryTicket`, `VITE_PLATFORM_PUBLIC_KEY`) | Unchanged gate; re-verified before every write. |
| `zenix-saas-v1`, `zenix-auth-v1` stores | Read for metadata; auth store only yields username, email (masked) and status. |
| Shared UI (`Card`, `KPI`, `Drawer`, `Modal`, `Confirm`, `Field`, `Timeline`, `InfoGrid`, `StatusBadge`, `Empty`, `SearchBox`), design tokens, light/dark theme | All platform screens. New CSS is scoped `pf-*` in `src/styles/access.css`. |

## 2. New features and business reasons

| Section (route) | What it does | Why |
| --- | --- | --- |
| Platform Overview `/platform` | Total/active/suspended companies, trial, expired, plan and status distribution, active memberships + unique accounts, trials ending ≤ 7 days, recent platform actions. MRR/uptime/latency shown as "Backend kerak". | Operator needs a true picture of the customer base; no invented numbers. |
| Companies `/platform/companies` | Search, status/plan/subscription filters, 5 sort orders, details drawer (owner username + masked email, memberships, plan, trial start/end, limits, restricted modules, subscription and admin history), suspend/reactivate with reason. | Core customer administration without access to tenant ERP data. |
| Plans & Subscriptions `/platform/subscriptions` | Plan catalog (limits, modules, AI credits marked "not metered", API), per-company subscription table, override modal (plan + `active`/`grace`/`expired`/`suspended`, reason, two-step confirm), override history, business rules. | Administrative plan control that never looks like payment. |
| Billing `/platform/billing` | Per-company billing status with payment verification always "Tasdiqlanmagan", source of last plan change, plan-change event history, unavailable cards for payments/invoices/refunds/recurring billing, API contract. | Honest state until a payment provider exists. |
| Support Center `/platform/support` | Manually logged tickets: company link (optional), category, priority, status workflow, assignee, notes, resolution timeline. Secret-like text (passwords, tickets, private keys) is rejected. | Operators can track requests received by other channels; no fake inbound integrations, no impersonation. |
| Feature Management `/platform/features` | Plan × module matrix; per-company module state; restrict/restore a plan module with reason; history. | Contract or abuse cases without changing plans or roles. |
| Security & Audit `/platform/security` | Current session (operator, ticket expiry), access rules, searchable/filterable platform audit (actor, action, target, company, reason, outcome, detail), mutability warning, backend requirements. | Accountability for platform actions, separate from tenant audit. |
| Platform Settings `/platform/settings` | Brand name, support e-mail/phone, default trial days (1–60), grace days (1–30), registration open/closed. Inline validation, reason required for sensitive fields, confirmation shows the diff. Backend-only settings listed, not built. | SaaS policy for future registrations without touching existing tenants. |
| System Health `/platform/health` | App version (from `package.json` via Vite `define`), build mode, browser storage estimate, localStorage/sessionStorage/Web Crypto/IndexedDB/online checks, store integrity, public-key configured, integrations "Ulanmagan", server metrics unavailable. | Diagnostics that are true for a browser app. |

Shell: sidebar grouped Umumiy / Mijozlar / Operatsiyalar / Boshqaruv; ticket countdown chip with a 5-minute warning; demo banner; skip link; mobile drawer (≤ 960 px) with labelled toggle, Escape and scrim close; unknown `/platform/*` paths show a not-found state. Every nav item is a working page.

## 3. Platform vs tenant separation

- `/platform` and `/platform/*` render outside the tenant shell, guard and session (`App.tsx`). No tenant role, including Business Owner, reaches it; there is no `platform` permission in tenant RBAC (`access.ts` returns false).
- A platform session lives in `sessionStorage` and is never a tenant session: with a valid platform ticket and no tenant session, `can('production','create')` is false and no tenant resolves (UI test).
- Platform screens receive only SaaS metadata and the platform store (`PlatformContext`). They never read `zenix-manufacturing-v3-state` or `zenix-erp-*-state`; usage counts are explicitly deferred to a backend API.
- A platform operator who is also a company member must sign in to that company through `/login` with their tenant account.
- Suspension: tenant status `suspended` removes the membership's tenant resolution → no tenant workspace (UI test). Records are preserved.

## 4. Entitlement rules

Sensitive tenant operation = **subscription entitlement ∧ feature availability ∧ RBAC permission**.

1. Entitlement — `PLAN_CATALOG[plan].modules` and an active subscription (`subscriptionActive`). Core modules (`dashboard`, `users`, `roles`, `audit`, `settings`, `subscription`) always remain, so an owner can see billing state.
2. Availability — new optional `featureOverrides` (append-only, latest per tenant+module wins) in `zenix-saas-v1`. Only `RESTRICTABLE_MODULES` (plan modules minus core) and only modules in the current plan can be restricted. There is **no grant operation**: restoring returns to the plan default.
3. RBAC — unchanged `hasPermission`; feature data never touches roles.

Subscription rules: owner self-service cannot upgrade an active plan or revive expired/suspended; trial deadline survives repeated selection; platform override cannot grant `trial`; `grace` always gets `endsAt = now + graceDays` (previously a grace override had no end and would never lapse); downgrade appends history and existing records stay (limit blockers stop only new excess records). Effective status treats a lapsed trial/active/grace end date as `expired`.

## 5. Audit and security behaviour

- New store `zenix-platform-v1`: `{settings, audit[≤2000], tickets[≤500]}`, validated by `normalizePlatformStore`; damaged → read-only, never overwritten.
- Every platform write (`run` in `PlatformPage.tsx`): busy lock against double submit → ticket live + signature re-verified → both stores re-read and validated → pure domain op (`op*` in `domain/platform.ts`) → result validated → concurrent-edit check on both raw values → write SaaS then platform; if the platform write fails the SaaS value is restored. Invalid ops return an error and change nothing (domain + UI tests).
- Audit entries: actor, action, target type/id, company, reason, outcome, detail; tenant/subscription ops link the SaaS event (`saasEventId`) so legacy SaaS-only platform events stay visible once. Session start/end/expiry are logged. No passwords, hashes, salts, recovery data or tickets are written or displayed.
- Ticket expiry is checked every second; on expiry all platform data is hidden and the expiry is logged.
- Registration policy and trial length are read by `setupSuperAdmin` for additional company signups only (first browser setup is unaffected).

## 6. Backend-only dependencies

Server platform identity + platform RBAC; HttpOnly session and cross-device revocation; append-only hash-chained audit with server time, IP/device metadata; verified payments, invoices, refunds, tax, recurring billing, webhooks; metered AI/API quotas; inbound support channels and consented support access; server-side tenant usage counts; monitoring (CPU, memory, DB, workers, latency, error rate, uptime); atomic company registration; real tenant isolation. API contracts: `docs/BACKEND_CONTRACT.md` § Platform administration API; TypeScript shapes at the end of `src/domain/platform.ts`.

## 7. Tests and results (2026-11-09)

| Check | Result |
| --- | --- |
| Domain (`npm run test:domain`) | 436/436 (10 new in `tests/platform41.test.mjs`) |
| UI (`npm run test:ui`) | 89/89 (`tests/ui/platform.test.tsx`: 14, was 4) |
| Chrome E2E (`PW_CHANNEL=chrome npx playwright test`) | 31/31 (new `e2e/platform.spec.ts`, 2 tests × desktop/mobile) |
| TypeScript, ESLint, production build, `git diff --check` | pass |

Covered: derived counts and no fabricated metrics; empty states; search/filter/sort; details privacy; suspend/reactivate reason, duplicate refusal, linked audit, ERP state untouched; override grace end, no trial, no-op refusal; self-service restrictions and trial deadline; feature restrict/restore, no grant, core protected, cross-tenant isolation, normalizer rejects bad overrides; settings validation, sensitive reason, diff, subscriptions untouched, closed registration blocks signup; ticket validation, transitions, closed final, secret rejection; store normalization and audit cap; tenant owner and forged session blocked; platform session grants no tenant permission; suspension blocks tenant; expired ticket hides data and blocks writes; modified/other-purpose ticket rejected; navigation to all 9 sections and not-found; mobile menu and no page overflow (E2E).

E2E isolation: `playwright.config.ts` generates a throwaway P-256 key pair per run; the public key is injected only into that test build, the private JWK stays in the test process environment.

## 8. Remaining limitations

- All authorization, audit and policy data is browser-local and editable; not legally reliable.
- Tenant usage (employees/branches/warehouses) is not shown on the platform side by design (no ERP reads).
- Plan catalog is code; editing plans needs a versioned server catalog.
- No "default feature policy" setting: a policy that grants modules would conflict with plan entitlements.
- Support tickets are manual; no notifications.

## 9. Phase 4.2 prerequisites

1. Platform identity service (separate authority), MFA, server sessions with revocation; replace offline tickets.
2. PostgreSQL schema from `BACKEND_CONTRACT.md` incl. `feature_restrictions`, `platform_settings` (versioned), `platform_audit` (append-only), `support_tickets`.
3. Implement the platform API table; move `op*` validation server-side with idempotency keys and single-transaction audit.
4. Payment provider integration before any paid entitlement; usage metering.
5. Monitoring stack feeding `SystemHealthContract`.
6. Swap the browser stores behind the existing `run(op)` boundary for API calls; keep the UI.
