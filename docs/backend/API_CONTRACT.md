# ZENIX API contract v1

Status: design contract, no endpoint implemented. Base tenant prefix: /api/v1. Platform prefix: /platform/v1. This contract is read together with COMMAND_MAPPING.md, REQUEST_DTO_CATALOG.md, DATABASE_SCHEMA.md, ERD.md and FINANCIAL_POSTING.md. The 102 current frontend commands are listed individually in COMMAND_MAPPING.md.

## Transport, authority and common types

- HTTPS JSON UTF-8. All instants are ISO 8601 UTC; business dates are YYYY-MM-DD evaluated in tenant timezone. Decimal quantity, money and exchange rate are JSON strings so JavaScript float cannot silently change a posting. IDs are server UUIDs; imported legacy IDs are lookup aliases, never authority.
- Tenant session is an opaque Secure HttpOnly SameSite cookie backed by revocable server state. Unsafe requests require CSRF protection. CORS is an explicit allowlist. Platform session uses separate cookie/authority and MFA.
- The selected tenant comes from the session and active membership, not a request body, header, URL ID or browser storage. A tenant path parameter, when present on a platform route, is a target checked under platform RBAC, not tenant authentication.
- Permission decision for every tenant route: valid user/session/password_version, active tenant/membership, plan entitlement, feature restriction, module/action grant, rank, branch/warehouse/workcenter scope, command-specific guard and source-record scope. Unknown commands and absent permission declarations deny by default.
- Idempotency-Key UUID is required on mutating business commands, registration, finance postings and platform changes. Key scope is authenticated principal + tenant + command + key, with request-hash matching and stored result. Reuse with a different payload returns 409 IDEMPOTENCY_CONFLICT.
- If-Match: resource version required on draft/master/settings edits. A stale version returns 412 VERSION_CONFLICT plus current version, not a silent overwrite. Long-running reads/exports use stable snapshotVersion.
- Every response carries X-Correlation-Id. Every list accepts limit (1..100), cursor, sort and documented filters; response is {items,nextCursor,snapshotVersion}. There is no unbounded whole-state response.
- Every successful command response is {data:{id?,version?,affected?},message,correlationId}. A validated no-op replay reports the original outcome, never posts again. The frontend adapter maps this to the existing ActionResult.
- Errors use {code,message,correlationId,fieldErrors?,currentVersion?}. HTTP: 400 malformed, 401 unauthenticated, 403 denied/plan/scope, 404 absent or hidden foreign record, 409 state/idempotency conflict, 412 stale version, 422 invariant or unresolved financial evidence, 429 rate/quota, 503 unavailable. Messages never reveal foreign tenant rows. A DB commit failure is never returned as success.
- Server generates actor, server time, audit ID and source links. Client cannot submit approvedBy, paymentVerified, costBasis=actual or tenant role as proof.
- Public OpenAPI schemas will be generated from the approved DTO registry. Request/response shape changes require a versioned contract and compatibility tests; hidden frontend fields are not dropped by accident.

## Command endpoint family

POST /api/v1/commands/{commandName}

The route is an explicit allowlist of the 102 names in COMMAND_MAPPING.md, not dynamic reflection. Body: {payload:{named DTO fields},requestVersion:1}. The mapping document records each command's frontend signature, handler owner, permission key, path and transaction class. State and Ctx parameters of today's pure actions are never client inputs. Reference identifiers in payload are resolved within selected tenant. Output is the common command response plus typed result, including generated document ID, status, balances and versions needed by the page. A command that returns needs-override in the current UI must return 409 OVERRIDE_REQUIRED with the required override fields; retry requires a reason and a fresh idempotency key.

Important command DTO groups:
- MO: CreateOrderPayload; orderId/status; quantity/good/scrap; workOrderId/operatorIds; lot/material allocation, key/reason; reschedule override. Server checks BOM snapshot, site and work dependencies.
- PO: PurchasePayload, PurchaseLineInput, ReceiveOptions, inspection accepted/rejected and serials; source terms/rate snapshot; creator/second-approver policy.
- Inventory: stock SKU and source/destination site, qty, lot/serial pins, location, unit factor, adjustment/count reason and key. Balance and movement commit together.
- Sales: SalesPayload and line quantities, reservation/shipment allocations, CustomerPaymentInput, ReceivableAdjustmentInput, return decision and reason.
- QC/equipment/engineering: current domain status enums and source IDs; immutable review/approval snapshots, equipment calendar and maintenance source.
- Role/attachment: role rank/scope/permission patch; entityType mapped to an allowed module; file bytes are uploaded through the attachment flow, not embedded in a business command.

## Authentication, organization and SaaS routes

| Method/path | Request or filters | Response and rule |
| --- | --- | --- |
| POST /api/v1/auth/register | company name, owner name, login/email/password, jurisdiction and optional official ID claim, Idempotency-Key | user + tenant + owner employee/membership + trial in one transaction; no client-selected role/plan |
| POST /api/v1/auth/login | login,password,remember | cookie + user and active tenant summaries; rate/lockout applies |
| POST /api/v1/auth/logout | CSRF token | revoke server session and cookie |
| GET /api/v1/me | none | user, selected tenant, membership, effective role/scope/module grants, plan, session expiry; no password hash |
| GET /api/v1/tenants | none | only active memberships and tenant metadata visible to caller |
| POST /api/v1/tenants/select | tenantId | validates membership; rotates/updates selected context, invalidates tenant caches |
| POST /api/v1/auth/password/change | currentPassword,newPassword | password version increments and previous sessions revoked |
| POST /api/v1/auth/recovery/request | login or email | non-enumerating acknowledgement; one-time delivery through provider |
| POST /api/v1/auth/recovery/complete | token,newPassword | atomic consume, session revocation |
| POST /api/v1/auth/invitations | employeeId,roleId,scope,recipient | users.create + delegation checks; expiring one-time invite, delivery status |
| POST /api/v1/auth/invitations/accept | token,credential | binds invited identity without role/scope self-selection |
| GET/PATCH /api/v1/users/:id | safe profile fields, If-Match | users.view/edit and target rank/site guard |
| POST /api/v1/users/:id/status | status,reason,key | no last-owner lockout, active site required |
| POST /api/v1/users/:id/password-reset | controlled recipient/approval | no plaintext permanent credential |
| GET/PATCH /api/v1/roles/:id | role/scope/permission | roles.* plus no escalation beyond actor; legacy role view-only |
| GET/PATCH /api/v1/settings | company/site/manufacturing/notification policy, If-Match | settings.view/edit; versioned |
| GET /api/v1/subscription | none | plan version, status, deadlines, limits, usage, restrictions |
| POST /api/v1/subscription/selection | plan key | owner-only demo/self-service semantics; does not assert payment or upgrade active paid plan without verified billing |
| GET /api/v1/tenant-identifiers | none | verified/unverified official claims, masked as needed |
| POST /api/v1/tenant-identifiers | jurisdiction,type,value,evidence | creates pending verification; no automatic verified=true |

## Read APIs by existing page

| Existing route/module | Read resources | Scope and projections |
| --- | --- | --- |
| / dashboard | GET /api/v1/dashboard; GET /api/v1/activity | Same authorized source rows and calculation version as drill-down lists |
| /production | production-orders, work-orders, shop-floor, forecasts, mps, mrp-runs, capacity, schedules | Role and site filtered; MRP is versioned proposal |
| /products | products, variants, boms, routings, engineering-changes | Includes immutable revision/snapshot provenance |
| /materials | materials, requirements, shortages, material-stock | Site-specific safety and unit conversion |
| /warehouse | warehouses, locations, balances, movements, lots, serials, transfers, counts | Location/LOT scope; stock availability = onHand-reserved-quarantine |
| /purchases | suppliers, supplier-material-terms, purchase-orders, receipts, replacements, subcontract-orders, payables | Warehouse/site scope; status and amount provenance |
| /sales | customers, sales-orders, shipments, returns, receivables | Site and customer debt from scoped ledger |
| /quality | checks, alerts, control-points, capa, dispositions | Source-record scope, no foreign document leakage |
| /equipment | equipment, maintenance, repair, downtime, runtime, oee | Work-center/branch scope |
| /employees | employees, time-logs, roles, activity | Personnel and financial visibility follow scope |
| /costs | expenses, costing, valuation-events, cost-variance, reconciliation-cases | Basis actual/estimated/provisional/unreconciled explicit |
| /reports | production, costs, quality, inventory, efficiency, oee, profitability, traceability | Same tenant/site predicates as source lists; snapshot version |
| /admin | users, roles, organization, audit, security, system | Separate grants users/roles/audit/settings |
| /subscription | subscription, plan-catalog, usage | Owner edit only; billing verification separate |
| /settings | tenant settings, locations, policies, UI preferences | Server-owned business settings; local UI preferences allowed |
| /ai and AI dock | GET /api/v1/insights; POST /api/v1/ai/questions | Present rule-based answers preserved and module-gated; external model only after explicit decision |

Read resource paths follow /api/v1/{resource}; detail GET /api/v1/{resource}/:id. Query parameters include documented site/status/date/search filters and cursor. A foreign or out-of-scope detail returns 404. The frontend keeps its present routes and view query parameters; only the data adapter changes.

## Resource writes beyond the 102 domain actions

| Method/path | Behaviour |
| --- | --- |
| POST /api/v1/entities/:kind, PATCH /api/v1/entities/:kind/:id, DELETE /api/v1/entities/:kind/:id, POST /api/v1/entities/:kind/:id/duplicate | Exact allowlist of the current 18 EntityKeyName kinds. Map entityRules, referenceBlocker, SKU/UOM/site and rank guards. Referenced master data is archived rather than hard-deleted where required. |
| POST /api/v1/attachments/upload-intents | entityType/entityId/name/size/mime/checksum; permission from ATTACHMENT_MODULE; returns short-lived scoped upload target. |
| POST /api/v1/attachments/:id/complete; GET /api/v1/attachments/:id/download; DELETE /api/v1/attachments/:id | Verify upload/checksum/scan, tenant and entity visibility; no browser dataUrl authority. |
| GET /api/v1/notifications; POST /api/v1/notifications/:id/read; POST /api/v1/notifications/read-all | Per-recipient read state; no foreign notification links. |
| GET/PATCH /api/v1/preferences | Theme/appearance/display preferences only, never identity or financial currency. |
| POST /api/v1/exports; GET /api/v1/exports/:id; GET /api/v1/exports/:id/download | Source permission + scope + snapshot version + audit; download expiry. |
| POST /api/v1/imports/validate; POST /api/v1/imports/commit; GET /api/v1/imports/:id | Read-only source snapshot, checksum, owner approval, schema/cross-reference validation, quarantine and idempotent commit. Original browser data never cleared automatically. |
| POST /api/v1/backups/request; GET /api/v1/backups/:id; POST /api/v1/restores/validate | Controlled tenant export/restore. Live restore/transaction reset requires a separately approved operations policy; demo reset remains available only in demo/sandbox. |
| GET /api/v1/audit | Append-only tenant audit, filtered by audit.view/export and site privacy. |

## Finance, correction and reconciliation routes

| Method/path | Required input and effect |
| --- | --- |
| POST /api/v1/subcontracts/:id/material-returns | Dispatch line/LOT/qty, condition, QC route, supplier evidence, reason, key; posts original-cost return or documented loss. |
| POST /api/v1/subcontracts/:id/service-adjustments | Signed supplier document, source currency/rate/date, affected receipts, reason, approval; creates pending reconciliation until provenance checks pass. |
| POST /api/v1/reconciliations/:id/approve | Authorized decision, exact allocation, evidence, period, reason, If-Match, key; posts linked WIP/inventory/COGS variance, never edits source. |
| POST /api/v1/reconciliations/:id/reject | Reason and audit; no valuation. |
| POST /api/v1/production-orders/:id/final-cost-reconcile | Final frozen inputs, allocation preview, approved period, key; posts variance only if exact sum and provenance pass. |
| POST /api/v1/valuation-events/:id/reverse | Reason, approval, open period, key; compensating event, one reversal per source. |
| GET /api/v1/finance/reconciliations; GET /api/v1/finance/valuation; GET /api/v1/finance/payables; GET /api/v1/finance/receivables | Scoped, paginated and auditable; unknown cost never shown as actual. |

These are new approved-policy capabilities, not replacements for existing commands. Posting and reversal require source links; an ambiguous case remains open. A future GL/tax integration consumes immutable events and adds account/tax mapping without changing old sources.

## Platform routes

The existing ../BACKEND_CONTRACT.md platform paths are preserved:
GET /platform/v1/overview; GET /platform/v1/tenants; GET /platform/v1/tenants/:id; POST /platform/v1/tenants/:id/status; POST /platform/v1/tenants/:id/subscription-overrides; POST /platform/v1/tenants/:id/feature-restrictions; GET /platform/v1/plans; GET /platform/v1/billing; GET /platform/v1/invoices; GET /platform/v1/support/tickets; POST /platform/v1/support/tickets; PATCH /platform/v1/support/tickets/:id; GET /platform/v1/audit; GET /platform/v1/health; GET/PUT /platform/v1/settings. Support grants use POST /platform/v1/support/tickets/:id/access-requests, POST /api/v1/support/access-requests/:id/decision by tenant owner, and POST /platform/v1/support/access-grants/:id/revoke. No unrestricted impersonation.

Payment provider ingress is POST /platform/v1/webhooks/:provider: verify signature against provider configuration and raw payload, deduplicate provider_event_id, store raw event hash, then update subscription only in the verified workflow. Platform operator override is explicitly source_kind=manual_override and never becomes payment.succeeded. MRR is computed from verified billing facts only. Health values come from monitoring, not browser estimates.

## Contract verification

A generated test must prove all 102 DOMAIN_ACTIONS names appear exactly once in COMMAND_MAPPING.md, all 18 EntityKeyName kinds have a resource route, all 17 permission modules have server policy coverage, and every existing route has a read source. Contract tests call forbidden paths directly, not only hidden buttons. No frontend command is cut over until its API result, error, authorization and transaction tests pass. The source frontend can remain a demo while the API is built; production cannot use localStorage as a fallback.


## AppProvider parity endpoints and concrete wire examples

PROVIDER_MAPPING.md accounts for all 56 current AppContextValue members, including functions outside DOMAIN_ACTIONS. In addition to the routes above: POST /api/v1/auth/recovery-codes/issue issues server-verified one-time recovery codes after step-up; GET /api/v1/auth/session-policy returns safe security policy metadata; POST /api/v1/users/issue-temporary-access creates an expiring first-use credential under current seven-day maximum; DELETE /api/v1/tenant-memberships/:id removes tenant access without deleting a shared global user; PATCH /api/v1/security-policy is versioned and audited; GET /api/v1/backups/latest and GET /api/v1/backups/recovery-copies expose authorized recovery metadata. POST /api/v1/suppliers/upsert-with-terms is the transactional equivalent of saveSupplier: supplier and sourcing links commit together.

Example current command bridge:

    POST /api/v1/commands/receivePurchase
    Idempotency-Key: 7e96d816-5b73-49e7-b76d-21f62d04ce28
    If-Match: "purchase-order-version-4"
    Content-Type: application/json

    {"requestVersion":1,"payload":{"purchaseId":"<uuid>","materialId":"<uuid>","qty":"5.000","lotOverride":"LOT-42","opts":{"warehouseId":"<uuid>","key":"receipt-42"}}}

    200 OK
    {"data":{"id":"<receipt-uuid>","version":5,"affected":{"stockMovementIds":["<uuid>"],"qualityCheckIds":["<uuid>"]}},"message":"Qabul saqlandi","correlationId":"<uuid>"}

The example message is illustrative; Uzbek success and validation messages are parity-checked against current tests. The actor, tenant and verified status do not appear in the client payload. An unresolved financial correction returns 422 RECONCILIATION_REQUIRED with case ID and missing evidence, not a success response. A duplicate idempotency key with the same body returns the stored outcome; a changed body returns 409. A scoped read of another tenant's ID returns 404 without revealing the record.
