# ZENIX AppProvider and non-domain function mapping

Status: design parity register. Source: ../../src/app/providers/AppProvider/AppContext.tsx AppContextValue. All current provider properties and methods are accounted for below. This complements the 102 DOMAIN_ACTIONS rows in COMMAND_MAPPING.md; it does not count UI state as a server command.

| Provider member | Class | Production equivalent |
| --- | --- | --- |
| state | Read cache | Module GET resources; no whole-state authority |
| resolvedTheme | UI only | Local theme resolver |
| toasts | UI only | Local notification surface |
| dismissToast | UI only | Dismiss local toast |
| sidebarMobile | UI only | Local shell state |
| setSidebarMobile | UI only | Local shell state |
| searchOpen | UI only | Local shell state |
| setSearchOpen | UI only | Local shell state |
| notifOpen | UI only | Local shell state |
| setNotifOpen | UI only | Local shell state |
| aiOpen | UI only | Local shell state |
| setAiOpen | UI only | Local shell state |
| currentEmployee | Read | GET /api/v1/me |
| currentRole | Read | GET /api/v1/me |
| can | Read/UX | GET /api/v1/me effectiveCapabilities; server rechecks every request |
| auth | Read | GET /api/v1/me and /api/v1/auth/session-policy |
| saas | Read | GET /api/v1/tenants and /api/v1/subscription |
| switchTenant | Write | POST /api/v1/tenants/select |
| changePlan | Write | POST /api/v1/subscription/selection; never payment verification |
| login | Write | POST /api/v1/auth/login |
| logout | Write | POST /api/v1/auth/logout |
| clearAuthNotice | UI only | Clear local banner |
| setupSuperAdmin | Write | POST /api/v1/auth/register; always creates Business Owner, not platform operator |
| recoverWithKey | Write | POST /api/v1/auth/recovery/complete method=recovery_code after server verification |
| recoverWithTicket | Write | POST /api/v1/auth/recovery/complete method=one_time_ticket |
| createRecoveryKey | Write | POST /api/v1/auth/recovery-codes/issue after step-up; one-time display |
| changePassword | Write | POST /api/v1/auth/password/change |
| createUser | Write | POST /api/v1/auth/invitations or POST /api/v1/users/issue-temporary-access |
| updateUser | Write | PATCH /api/v1/users/:id |
| setUserStatus | Write | POST /api/v1/users/:id/status |
| resetUserPassword | Write | POST /api/v1/users/:id/password-reset; expiring delivery |
| deleteUser | Write | DELETE /api/v1/tenant-memberships/:id; global shared identity preserved |
| updateSecurityPolicy | Write | PATCH /api/v1/security-policy with version and audit |
| toast | UI only | Show local toast |
| saveSettings | Write | PATCH /api/v1/settings; UI display preferences excluded |
| setPreferences | UI only | Local display preference; optional PATCH /api/v1/preferences sync |
| setTheme | UI only | Local display preference |
| setAppearance | UI only | Local display preference |
| setCurrency | UI only | Display currency preference; never accounting currency |
| resetTransactions | Controlled | Demo reset only; production POST /api/v1/restores/validate plus separately approved reset workflow |
| importState | Controlled | POST /api/v1/imports/validate then /commit with owner confirmation |
| importPrivilegedState | Controlled | Step-up owner recovery/import review; no direct role escalation |
| restoreLastBackup | Controlled | Demo local restore; production validated restore workflow |
| lastBackup | Read | GET /api/v1/backups/latest or local demo copy |
| markAllRead | Write | POST /api/v1/notifications/read-all |
| markNotificationRead | Write | POST /api/v1/notifications/:id/read |
| activityArchive | Read | GET /api/v1/activity?cursor=... |
| recovery | UI/local | Local unreadable/newer-store recovery state; server import errors shown separately |
| startClean | Controlled | Demo clean start only; production new tenant onboarding or reviewed restore |
| recoveryCopies | Read/local | Local original copies remain downloadable; server GET /api/v1/backups/recovery-copies |
| storageError | UI/health | Server failed-write state plus local draft storage error |
| storageUsage | UI/health | Local browser usage; server quota from GET /api/v1/subscription |
| createEntity | Write | POST /api/v1/entities/:kind; 18-kind allowlist |
| updateEntity | Write | PATCH /api/v1/entities/:kind/:id with If-Match |
| deleteEntity | Write | DELETE /api/v1/entities/:kind/:id with reference guard |
| duplicateEntity | Write | POST /api/v1/entities/:kind/:id/duplicate |

Coverage: 56/56 AppContextValue members. Methods with browser demo security semantics keep a visible safe equivalent but never gain production authority from localStorage. A server cutover requires an end-to-end test for every write, recovery and data export path.

Additional direct frontend domain reads: dashboardSnapshot, productionControl, runMrp/createMpsRows/capacity, inventoryIssues, maintenanceDue/reliability, receivableAging/orderReceivable, purchasePaymentStatus, profitabilityByProduct, buildInsights/answerQuestion and scanNotifications become server-backed read projections or event consumers while preserving screen results. Existing UI routes and view query parameters stay stable.

Platform demo operations opTenantStatus, opOverride, opFeature, opSettings, opTicketCreate, opTicketUpdate and sessionAudit map to the explicit /platform/v1 endpoints in API_CONTRACT.md, with independent operator identity, audit and tenant consent for support.
