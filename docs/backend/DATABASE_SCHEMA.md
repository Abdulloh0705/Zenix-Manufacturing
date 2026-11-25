# ZENIX PostgreSQL logical schema

Status: design specification, not an executable migration. This schema covers the current ManufacturingState collections, nested document lines/events, SaaS metadata, platform administration and the approved FIN-01..04/TEN-01 decisions. Physical migrations must preserve these invariants and pass the contract mapping.

## Types, keys and shared conventions

- Tenant tables use primary key (tenant_id uuid, id uuid), FK tenant_id -> tenants.id, created_at timestamptz, updated_at timestamptz where mutable, and version bigint for optimistic edits. Their id is never reused. Historical browser IDs live in legacy_id text with UNIQUE (tenant_id, source_system, legacy_id) where imported.
- All tenant-to-tenant references use composite FKs, for example (tenant_id, warehouse_id) -> warehouses(tenant_id,id). Optional composite references must be either fully NULL or fully present. No tenant supplied in a request body proves authority.
- qty is numeric(20,3), money_uzs is numeric(20,2), original currency amounts are numeric(20,2), fx_rate is numeric(20,8), percentages/rates are exact numeric with a declared scale. API serializes decimals as strings; rounding points match current domain parity tests. Currency code is an explicit ISO-style code; UZS is the current accounting currency, while source currency and rate snapshots remain recorded.
- UTC instants are timestamptz; business_date is date and tenant timezone is an IANA zone. Old ambiguous wall-clock stamps remain labelled ambiguous in imported provenance.
- status is a constrained enum/check or lookup, never arbitrary free text. Historical status transitions have separate append-only event rows. archived_at is preferred to deleting referenced master data.
- Object files live outside PostgreSQL. The database stores attachment metadata, checksum, tenant/object key, upload/scan state and relation to the authorized entity.
- Outbox, stock movement, valuation event, payable/receivable entry, payment event and audit tables are append-only. A reversal is a new row with reverses_id and a uniqueness guard, never UPDATE/DELETE of the source.

## Global identity, tenant and SaaS

| Table | Required columns beyond shared keys | Constraints and relationships |
| --- | --- | --- |
| users | id uuid PK, normalized_login text, normalized_email text nullable, password_hash text, password_version int, status, created_at, updated_at | UNIQUE normalized_login; UNIQUE normalized_email when present; no tenant role here |
| tenants | id uuid PK, display_name, legal_name nullable, status, owner_user_id uuid, suspension_reason, created_at, updated_at | FK owner_user_id -> users; registration transaction also creates an active owner membership; suspension revokes tenant sessions |
| tenant_identifiers | tenant_id, id, country_code, identifier_type, normalized_value, issuing_authority, verification_status, verified_at, expires_at, evidence_attachment_id | Country-specific validator; partial unique (country_code,identifier_type,normalized_value) only for verified active claims; names are not unique |
| employees | tenant_id, id, name, department, shift, status, hourly_cost, primary_branch_id, home_warehouse_id, home_work_center_id, attendance, efficiency | Composite site FKs; active scoped assignment requires valid site; historic employee references prohibit unsafe delete |
| employee_branches | tenant_id, employee_id, branch_id, primary_flag, valid_from, valid_to | Composite FKs and no conflicting primary assignment |
| tenant_memberships | tenant_id, id, user_id, employee_id, role_id, status, valid_from, valid_to | UNIQUE (tenant_id,user_id); composite employee/role FKs; no active owner may be removed/demoted if last owner |
| roles | tenant_id, id, system_key nullable, name, rank, scope_kind, system_flag, status | system templates and legacy role restrictions; custom role rank/scope delegation guards |
| role_permissions | tenant_id, role_id, module_key, action_key, granted | PK (tenant_id,role_id,module_key,action_key); module/action must belong to frozen permission catalog |
| membership_scopes | tenant_id, membership_id, scope_kind, branch_id, warehouse_id, work_center_id, valid_from, valid_to | Exactly one matching scope target per row; scope never widens through delegation |
| sessions | id uuid PK, user_id, selected_tenant_id, token_hash, password_version, issued_at, expires_at, last_seen_at, revoked_at, device_meta | Selected tenant must have active membership at each request; cookie contains opaque token only |
| invitations | tenant_id, id, user_id nullable, employee_id, proposed_role_id, proposed_scope_json, token_hash, invited_by, expires_at, consumed_at, cancelled_at, delivery_status | Single-use; no later than current seven-day temporary-credential window without approved policy change |
| recovery_tokens | id uuid PK, user_id, token_hash, purpose, expires_at, consumed_at, issued_by | Atomic one-time consumption and password-version bump |
| security_policies | tenant_id, id, version, policy_json, effective_at, changed_by | Current login/lockout/session settings as versioned server policy |
| plan_versions | id uuid PK, plan_key, version, module_grants_json, max_employees, max_branches, max_warehouses, ai_credits, api_enabled, effective_at | Immutable versions of existing Free/Plus/Pro/Enterprise catalog |
| subscriptions | tenant_id, id, plan_version_id, status, starts_at, ends_at, grace_ends_at, source_kind, source_event_id, changed_by, reason | Append-only change history; verified payment and admin override are distinct sources |
| feature_restrictions | tenant_id, id, module_key, state, reason, actor_id, occurred_at | Append-only; latest per tenant/module; only restrict/restore a module already in plan |
| usage_events | tenant_id, id, metric, quantity, period_key, source_id, occurred_at | Unique source for metered API/AI; quota checked atomically |
| payment_events | id uuid PK, tenant_id, provider, provider_event_id, payload_hash, signature_verified, kind, amount, currency, occurred_at, received_at, processing_status | UNIQUE (provider,provider_event_id); verified event before paid entitlement |
| invoices | tenant_id, id, provider_ref, number, status, amount, tax_amount, currency, period_start, period_end, issued_at, paid_at | Tax meaning is provider/product policy, not a claimed GL posting |

## Organization, master data and engineering

| Table | Required columns beyond shared keys | Constraints and relationships |
| --- | --- | --- |
| tenant_settings | tenant_id, id, version, company_currency, timezone, default_branch_id, default_warehouse_id, default_line_id, manufacturing_policy_json, notification_policy_json, ai_policy_json | Versioned; company timezone history separately recorded |
| timezone_history | tenant_id, id, zone, effective_at, source_quality | No invented timestamp for imported ambiguous history |
| user_ui_preferences | user_id, tenant_id nullable, theme, appearance, currency_display, font_size, reduced_motion, ui_density, table_density | UI only; never authorization or accounting currency |
| branches | tenant_id, id, code, name, status | UNIQUE (tenant_id,code) |
| warehouses | tenant_id, id, branch_id, code, name, type, status | Composite branch FK; cannot archive with open stock/reservations/orders |
| warehouse_locations | tenant_id, id, warehouse_id, code, status | UNIQUE (tenant_id,warehouse_id,code); composite warehouse FK |
| production_lines | tenant_id, id, branch_id, code, name, shift, capacity, status | Composite branch FK |
| work_centers | tenant_id, id, branch_id, line_id, code, name, capacity, efficiency, cost_per_hour, energy_cost_per_hour, status | Composite branch/line FK; line branch must match center branch |
| work_center_calendars | tenant_id, id, work_center_id, version, working_days, shift_start, shifts, shift_minutes, breaks_json, parallel_slots, effective_at | Preserve present calendar and override semantics |
| items | tenant_id, id, sku, name, kind, base_uom, tracking_mode, status, created_at | UNIQUE (tenant_id,normalized_sku) across products and raw materials |
| products | tenant_id, item_id PK/FK, category, product_type, sale_price, standard_cost, lead_time, procurement_mode, default_bom_id, variant_stock | Current Product projection |
| materials | tenant_id, item_id PK/FK, category, standard_cost, min_stock, reorder_point, default_supplier_id, lead_time, lot_tracking, expiry_tracking, serial_tracking | Current RawMaterial projection |
| product_variants | tenant_id, id, product_id, code, attributes_json, price_delta, barcode, status | UNIQUE tenant-wide code against SKU/variant namespace; used variant is archived, not deleted |
| stock_skus | tenant_id, id, item_id, variant_id nullable, unit, active | One physical stock identity per base or tracked variant; configuration-only variant uses base stock SKU |
| pack_units | tenant_id, id, item_id, unit, factor | Positive factor and UNIQUE (tenant_id,item_id,unit); frozen factor copied to PO/BOM line |
| material_site_safety | tenant_id, material_id, branch_id, safety_qty | PK tenant/material/branch; no cross-site netting |
| suppliers | tenant_id, id, name, phone, email, lead_time, rating, status | Historical payable references prevent unsafe delete |
| supplier_material_terms | tenant_id, id, supplier_id, material_id, supplier_sku, quoted_price, currency, purchase_unit, unit_factor, moq, lead_time, preferred, active, last_purchase_* | UNIQUE active supplier/material term as current rule; quoted unit conversion recorded |
| customers | tenant_id, id, name, phone, email, type, status | Debt is derived from receivable entries, not editable authority |
| bom_revisions | tenant_id, id, code, product_id, variant_id nullable, revision, version_label, status, effective_date, previous_bom_id, eco_id, released_at/by, archived_at | At most one effective active revision per product/variant/date under selected policy; active BOM immutable, MO snapshot separate |
| bom_components | tenant_id, id, bom_id, item_id, sub_bom_id nullable, qty, unit, factor, waste | FK item/sub-BOM; cycle detection and UOM validation |
| bom_operations | tenant_id, id, bom_id, work_center_id, sequence, name, setup_min, run_min, employee_count, instructions, quality_check, worksheet, barcode_step | Composite FKs |
| bom_operation_dependencies | tenant_id, bom_id, operation_id, depends_on_operation_id | No cycle; both operations same BOM |
| bom_byproducts | tenant_id, id, bom_id, product_id, qty, unit | Composite product FK |
| engineering_changes | tenant_id, id, code, product_id, source_bom_id, new_bom_id, status, effective_date, owner_id, approved_by, reason, fingerprint | Draft/Review/Approved/Applied/Rejected/Cancelled transitions; approval cannot mutate source snapshot |
| eco_changes, eco_events | tenant_id, id, eco_id, change fields or event fields, occurred_at, actor_id | Frozen review content and append-only history |

## Planning, procurement and inventory

| Table | Required columns beyond shared keys | Constraints and relationships |
| --- | --- | --- |
| forecasts | tenant_id, id, product_id, variant_id, branch_id, period, qty | Unique source per product/variant/site/period according to current setForecast behaviour |
| mrp_runs | tenant_id, id, input_version, options_json, started_at, completed_at, status | Reproducible snapshot; never posts stock |
| mrp_suggestions | tenant_id, id, run_id, kind, item_id, site_id, qty, need_by, source_refs_json, status, created_document_id | Confirmation creates draft PO/MO once |
| schedule_versions | tenant_id, id, work_center_id, source_run_id, horizon, input_version, result_json | Calendar and downtime source references |
| purchase_orders | tenant_id, id, code, supplier_id, warehouse_id, status, created_by, approved_by, expected_date, total, created_at | Draft/approval/in-transit/partial/received/cancel; dual-approval policy |
| purchase_order_lines | tenant_id, id, po_id, material_id, qty, received_qty, unit_price_uzs, purchase_unit, unit_factor, source_currency, source_price | Snapshot supplier terms, positive quantities |
| purchase_receipts | tenant_id, id, po_id, warehouse_id, received_by, received_at, idempotency_key, status | Unique tenant/command key; partial reception permitted |
| purchase_receipt_lines | tenant_id, id, receipt_id, po_line_id, stock_sku_id, qty, accepted_qty, rejected_qty, supplier_lot, internal_lot_id, serial_set_ref, location_id | accepted + rejected = inspected qty; QC links to receipt |
| supplier_replacements | tenant_id, id, po_id, receipt_line_id, quality_check_id, supplier_id, material_id, qty, status, reason | Replacement receipt cannot double-count original PO line |
| subcontract_orders | tenant_id, id, code, supplier_id, product_id, warehouse_id, qty, status, service_currency, quoted_service_amount, frozen_fx_rate, frozen_service_uzs, material_cost_basis | Draft -> dispatched -> in progress -> partial/received; sent order never draft-cancelled |
| subcontract_dispatch_lines | tenant_id, id, order_id, stock_sku_id, lot_id, location_id, qty, frozen_unit_cost, source_movement_id | FIN-01 custody sum reconciled |
| subcontract_receipts | tenant_id, id, order_id, qty, lot_id, material_cost, service_cost, unit_cost, cost_basis, qc_status, key, received_at | UNIQUE tenant/order/key; cumulative allocation and final residual exact |
| subcontract_returns, subcontract_cost_adjustments | tenant_id, id, order_id, source_line/receipt_id, qty or signed_delta, evidence_id, status, reason, approved_by, occurred_at | FIN-01/02; valuation only after verified provenance |
| stock_movements | tenant_id, id, stock_sku_id, warehouse_id, location_id, lot_id, serial_id, signed_qty, kind, source_type, source_id, key, occurred_at, actor_id, frozen_unit_cost, cost_basis, reverses_id | Append-only; source and reversal unique; signed quantity matches physical posting |
| stock_balances | tenant_id, id, stock_sku_id, warehouse_id, location_id nullable, on_hand, reserved, quarantine, incoming, version | UNIQUE stock SKU/site/location; nonnegative and available = on_hand - reserved - quarantine >= 0 |
| stock_reservations | tenant_id, id, owner_type, owner_id, stock_sku_id, warehouse_id, lot_id nullable, qty, untracked_qty, status | Source order + pin; released/consumed once |
| lots | tenant_id, id, code, stock_sku_id, warehouse_id, location_id, source_type/id, qty, status, expiry, original_qty, cost_basis, frozen_unit_cost, genealogy | Unique code per tenant/stock policy; QC hold blocks issue |
| serial_units | tenant_id, id, serial_code, stock_sku_id, lot_id, warehouse_id, location_id, state, source_type/id, genealogy | UNIQUE (tenant_id,stock_sku_id,serial_code); a physical unit never twice available |
| stock_transfers, stock_counts, stock_adjustments | tenant_id, id, source/destination, item/lot/serial, qty, reason, actor, idempotency_key, posted_at | Each posts linked stock_movements atomically; count delta and evidence preserved |
| quarantine_dispositions | tenant_id, id, source_type/id, stock_sku_id, lot_id, qty, decision, reason, quality_check_id, occurred_at | Release/return/scrap/rework exactly once |

## Production, quality, equipment, sales and finance

| Table | Required columns beyond shared keys | Constraints and relationships |
| --- | --- | --- |
| production_orders | tenant_id, id, code, product_id, variant_id, qty, completed_qty, scrap_qty, status, warehouse_id, line_id, work_center_id, responsible_id, sales_order_id, parent/backorder/rework refs, start/due, priority, cost_basis | Status machine and site relations preserved |
| mo_bom_snapshots | tenant_id, id, mo_id UNIQUE, source_bom_id, source_revision, snapshot_json, fingerprint, frozen_at | Never reconstructed from today's BOM |
| work_orders | tenant_id, id, mo_id, operation_snapshot_id, work_center_id, sequence, status, planned_min, actual_min, setup_min, frozen_machine/energy_rates, started/completed_at | Dependencies and active interval constraints |
| work_order_dependencies, work_order_events, work_order_assignments | tenant_id, IDs, work_order refs, dependency/actor/event fields | Append-only events; operator scope checked |
| material_issues, material_returns | tenant_id, id, mo_id, stock_sku_id, lot_id, qty, frozen_unit_cost, warehouse/location, kind, source_issue_id, reason, actor, key | Returns reference a real issue; no over-return |
| production_outputs, scrap_events | tenant_id, id, mo_id, work_order_id, stock_sku_id, lot_id, good_qty/scrap_qty, reason, key, cost_basis | Output and QC hold/stock movements atomic |
| time_logs, downtime_events | tenant_id, id, employee/work_center/equipment/MO refs, start_at, end_at, minutes, frozen_hourly_rate, kind/reason | Durations and OEE/cost provenance |
| quality_control_points | tenant_id, id, product/operation scope, frequency, sample_rate, check_type, blocking, active | Current in-process gating |
| quality_checks | tenant_id, id, source_type/id, receipt_id, mo/work_order/return refs, stock_sku_id, lot_id, status, inspector_id, accepted/rejected qty, measurement, reason, occurred_at | Source-specific decision, never generic cross-tenant ID |
| quality_alerts, capa_events | tenant_id, id, source_id, severity, status, root_cause, corrective/preventive action, owner_id, occurred_at | History retained |
| equipment | tenant_id, id, work_center_id, model, serial, status, maintenance_plan, runtime_hours, cost rates | UNIQUE relevant equipment serial; center FK |
| equipment_runtime, maintenance_requests, maintenance_orders, repair_orders | tenant_id, IDs, equipment/technician refs, schedule, duration, status, cost, history | Downtime affects capacity and cost |
| sales_orders | tenant_id, id, code, customer_id, branch_id, mode, status, delivery_date, total, created_at | MTS/MTO and site semantics |
| sales_order_lines | tenant_id, id, so_id, product_id, variant_id, qty, price, reserved_qty, delivered_qty | Frozen commercial price and variant |
| shipments, shipment_lines | tenant_id, id, so_id, line_id, stock_sku_id, lot/serial allocation, qty, frozen_unit_cost, cost_basis, shipped_at | Shipment and receivable posting once |
| customer_returns, return_dispositions | tenant_id, id, so/shipment/line/lot refs, qty, reason, status, QC and rework refs | Return restores original shipment basis; credit reconciliation for legacy |
| receivable_entries | tenant_id, id, customer_id, so_id nullable, return_id nullable, kind, signed_amount, currency, occurred_at, key, reverses_id | Append-only; customer debt derived |
| payable_entries | tenant_id, id, supplier_id, po/subcontract/receipt refs, kind, signed_amount, currency, occurred_at, key, reverses_id | Append-only; supplier debt derived |
| expenses | tenant_id, id, branch_id, source_type/id, kind, amount, occurred_on, note, actor_id | Unlocated historical expense hidden from scoped roles until reconciled |
| cost_components | tenant_id, id, source_type/id, mo/lot refs, kind, amount, currency, basis, frozen_at | Material/labor/machine/energy/overhead/subcontract provenance |
| valuation_events | tenant_id, id, stock_sku/lot/MO/shipment refs, kind, signed_amount_uzs, source_event_id, occurred_at, accounting_date, status, reverses_id | FIN-02/03, append-only; not itself a full GL |
| cost_variance_entries | tenant_id, id, mo/lot/shipment/subcontract refs, allocation_kind, signed_amount_uzs, source_delta_id, accounting_date, status, approved_by, reverses_id | Sum allocated = source delta; no duplicate source allocation |
| reconciliation_cases | tenant_id, id, kind, source_type/id, amount_or_qty, reason, evidence_ref, status, opened_at, resolved_at/by | Unknown cost, custody or legacy credit never auto-approved |
| notifications | tenant_id, id, recipient_user_id, event_id, type, severity, title, text, path, created_at | Read state per recipient in notification_reads |
| activity_events, audit_events | tenant_id, id, actor_id, action, target_type/id, outcome, reason, correlation_id, occurred_at, previous_hash | Append-only; audit not truncated like browser activity |
| attachments | tenant_id, id, entity_type/id, object_key, filename, mime, size, checksum, scan_status, uploaded_by/at | Tenant-scoped storage key and authorized download |
| import_jobs, import_quarantine | tenant_id, id, source_checksum, source_version, owner_approval, state, source_id_map, reason | Unique checksum per target; ambiguous rows quarantined |

Platform-only tables: platform_operators, platform_roles, platform_sessions, platform_settings_versions, platform_audit_events, support_tickets, support_notes, support_access_grants and health_samples. Operator authority never comes from tenant_memberships.

## Cross-table invariants and indexes

- Foreign keys: every order line, receipt, reservation, QC, issue, shipment, ledger and valuation source must resolve within the same tenant. Where source_type is polymorphic, a typed link table or source registry enforces valid source IDs; a free string is not accepted as a cross-tenant reference.
- Business checks: stock on_hand/reserved/quarantine nonnegative; available nonnegative; accepted + rejected <= received; MO completed + scrap <= ordered unless an approved explicit exception; serial qty 0/1; return qty <= shipped or issued; no duplicate ledger/valuation/event key.
- Partial unique indexes: active owner, active BOM per product/variant effective window, open idempotency key, one reversal per source, verified official company identifier. Effective-date overlap needs exclusion/transactional validation.
- Access indexes begin with tenant_id: site/status/date on orders; tenant+stock_sku+warehouse on balance; tenant+source on movement/ledger/audit; tenant+recipient+created_at on notifications. Cursor pagination for long logs/exports.
- RLS on tenant tables uses a transaction-local tenant context set by the API after membership validation. The runtime DB role neither owns protected tables nor has BYPASSRLS. Migration/platform maintenance uses separate credentials. No connection-pool session variable may leak between requests.
- Archive/retention and backup policies are configurable only after region, legal and operational retention decisions. Backup and restore must verify row counts and tenant isolation. Import never deletes original browser data.

## Current-state coverage

ManufacturingState settings, branches, warehouses, productionLines, workCenters, products, rawMaterials, boms, stockBalances, stockMovements, productionOrders, suppliers, supplierMaterials, purchaseOrders, customers, salesOrders, qualityChecks, qualityAlerts, equipment, maintenanceOrders, employees, roles, expenses, engineeringChanges, qualityControlPoints, maintenanceRequests, subcontractOrders, repairOrders, notifications, activity, timeLogs, downtimeEvents, lots, forecasts, returns, attachments, receivables, payables, supplierReplacements, receivableReconciliations and quarantinedRecords all have an owner above. currentEmployeeId moves to validated session/membership context; schemaVersion moves to migrations/import manifest. No business record is represented solely by browser localStorage.


## Supporting tables and platform detail

| Table | Required columns | Integrity |
| --- | --- | --- |
| lot_allocations | tenant_id, id, owner_type, owner_id, stock_sku_id, lot_id, serial_id nullable, warehouse_id, location_id, qty, frozen_unit_cost, cost_basis, allocated_at | Owner is a typed reservation, issue or shipment line; one allocation cannot exceed physical LOT/serial balance; returns reference the original allocation |
| notification_reads | tenant_id, notification_id, user_id, read_at | PK tenant/notification/user; recipient or authorized broadcast only |
| idempotency_keys | tenant_id, id, principal_id, command_name, key, request_hash, response_status, response_body_hash, resource_id, created_at, expires_at | UNIQUE tenant/principal/command/key; same key/different hash is conflict; retention covers client retry window and billing events retain provider-specific uniqueness independently |
| outbox_events | tenant_id, id, topic, aggregate_type/id, payload_version, payload_json, created_at, available_at, attempts, delivered_at, dead_letter_at | Written in the same transaction as source; worker delivery is at least once and consumer deduplicates event ID |
| platform_operators | id uuid PK, normalized_login, status, mfa_enrolled_at, credential_version | Separate from tenant roles/memberships; provisioned by trusted server process |
| platform_roles, platform_role_permissions | id, role_key, permission_key, granted | Separate platform RBAC; no tenant ERP grant |
| platform_sessions | id uuid PK, operator_id, token_hash, issued_at, expires_at, revoked_at, mfa_verified_at | Independent platform cookie and cross-device revocation |
| platform_settings_versions | id uuid PK, version, trial_days, grace_days, registration_state, support_contacts, reason, changed_by, effective_at | Versioned; changes apply prospectively under current contract |
| platform_audit_events | id uuid PK, operator_id, action, target_type/id, tenant_id nullable, outcome, reason, correlation_id, occurred_at, previous_hash, row_hash | Append-only, separate from tenant audit |
| support_tickets | id uuid PK, tenant_id nullable, category, priority, status, subject, assignee_id, source_channel, inbound_message_id, created_at, updated_at | Unique inbound channel/message ID; no secret content |
| support_notes | id uuid PK, ticket_id, actor_id, kind, redacted_text, occurred_at | Append-only status/assignment/note trail |
| support_access_grants | id uuid PK, ticket_id, tenant_id, approved_by_user_id, purpose, allowed_scope_json, starts_at, expires_at, revoked_at, status | Tenant approval; no unrestricted impersonation; every read checked and audited |
| health_samples | id uuid PK, component, collected_at, status, latency_ms, error_rate, queue_depth, replication_lag_ms | Monitoring source only; browser estimates never populate server health |

For stock_skus and stock_balances, nullable variant_id/location_id need explicit partial unique indexes for the base/unassigned cases; ordinary UNIQUE with nullable columns is insufficient for the intended single-row balance. All typed source references need an FK-bearing link or registry constraint. Outbox and idempotency rows are infrastructure state, not tenant-visible business records.


## Accounting period and posting state

| Table | Required columns | Integrity |
| --- | --- | --- |
| accounting_periods | tenant_id, id, period_start, period_end, state, locked_at, locked_by, reason, version | No overlapping periods per tenant; state open/locked; no historical posting into locked period |
| reconciliation_case_events | tenant_id, id, case_id, from_status, to_status, actor_id, reason, evidence_ref, occurred_at | Append-only status trail; approval preview and source version frozen |

Financial proposal rows and reconciliation cases may change status under version checks and preserve an event trail. Payable, receivable, valuation and cost-variance ledger rows are inserted only as posted; they are immutable thereafter. A reversal is a new posted row, not a status edit.
