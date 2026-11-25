# ZENIX entity relationship diagrams

These are logical ER diagrams for design review. Every ERP entity below is tenant scoped even when the TENANTS edge is omitted for readability. Exact columns and constraints are in DATABASE_SCHEMA.md. A row from one tenant cannot reference a row of another tenant.

## Identity, organization and SaaS

~~~mermaid
erDiagram
  USERS ||--o{ TENANT_MEMBERSHIPS : joins
  USERS ||--o{ SESSIONS : opens
  TENANTS ||--o{ TENANT_MEMBERSHIPS : has
  TENANTS ||--o{ TENANT_IDENTIFIERS : claims
  TENANTS ||--o{ BRANCHES : contains
  TENANTS ||--o{ SUBSCRIPTIONS : subscribes
  TENANTS ||--o{ FEATURE_RESTRICTIONS : restricts
  TENANTS ||--o{ USAGE_EVENTS : meters
  TENANTS ||--o{ PAYMENT_EVENTS : receives
  TENANTS ||--o{ INVOICES : billed
  PLAN_VERSIONS ||--o{ SUBSCRIPTIONS : selected
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  ROLES ||--o{ TENANT_MEMBERSHIPS : assigned
  EMPLOYEES ||--o| TENANT_MEMBERSHIPS : linked
  EMPLOYEES ||--o{ EMPLOYEE_BRANCHES : assigned
  BRANCHES ||--o{ EMPLOYEE_BRANCHES : scopes
  BRANCHES ||--o{ WAREHOUSES : owns
  BRANCHES ||--o{ PRODUCTION_LINES : owns
  PRODUCTION_LINES ||--o{ WORK_CENTERS : organizes
  WORK_CENTERS ||--o{ WORK_CENTER_CALENDARS : schedules
  WAREHOUSES ||--o{ WAREHOUSE_LOCATIONS : contains
  TENANT_MEMBERSHIPS ||--o{ MEMBERSHIP_SCOPES : grants
  TENANTS ||--o{ INVITATIONS : issues
  USERS ||--o{ RECOVERY_TOKENS : recovers
  TENANTS ||--o{ TENANT_SETTINGS : configures
~~~

A global user may belong to several tenants with different roles. An employee is a tenant record, not a global login. The tenant owner invariant is checked transactionally during registration, reassignment and deactivation. Display names are not identity keys; verified TENANT_IDENTIFIERS are jurisdiction scoped.

## Catalog, engineering, planning and equipment

~~~mermaid
erDiagram
  ITEMS ||--o| PRODUCTS : specializes
  ITEMS ||--o| MATERIALS : specializes
  ITEMS ||--o{ PACK_UNITS : converts
  ITEMS ||--o{ STOCK_SKUS : stocks
  PRODUCTS ||--o{ PRODUCT_VARIANTS : configures
  PRODUCT_VARIANTS |o--o| STOCK_SKUS : physical_when_enabled
  MATERIALS ||--o{ MATERIAL_SITE_SAFETY : plans
  BRANCHES ||--o{ MATERIAL_SITE_SAFETY : overrides
  SUPPLIERS ||--o{ SUPPLIER_MATERIAL_TERMS : quotes
  MATERIALS ||--o{ SUPPLIER_MATERIAL_TERMS : sourced
  PRODUCTS ||--o{ BOM_REVISIONS : engineered
  PRODUCT_VARIANTS |o--o{ BOM_REVISIONS : specialized
  BOM_REVISIONS ||--o{ BOM_COMPONENTS : includes
  ITEMS ||--o{ BOM_COMPONENTS : consumed
  BOM_REVISIONS ||--o{ BOM_OPERATIONS : routes
  WORK_CENTERS ||--o{ BOM_OPERATIONS : executes
  BOM_OPERATIONS ||--o{ BOM_OPERATION_DEPENDENCIES : depends
  BOM_REVISIONS ||--o{ BOM_BYPRODUCTS : yields
  PRODUCTS ||--o{ ENGINEERING_CHANGES : changes
  ENGINEERING_CHANGES ||--o{ ECO_CHANGES : proposes
  ENGINEERING_CHANGES ||--o{ ECO_EVENTS : records
  PRODUCTS ||--o{ FORECASTS : forecasts
  BRANCHES ||--o{ FORECASTS : sites
  MRP_RUNS ||--o{ MRP_SUGGESTIONS : proposes
  WORK_CENTERS ||--o{ SCHEDULE_VERSIONS : schedules
  WORK_CENTERS ||--o{ EQUIPMENT : houses
  EQUIPMENT ||--o{ EQUIPMENT_RUNTIME : measures
  EQUIPMENT ||--o{ DOWNTIME_EVENTS : stops
  EQUIPMENT ||--o{ MAINTENANCE_REQUESTS : requests
  EQUIPMENT ||--o{ MAINTENANCE_ORDERS : serviced
  EQUIPMENT ||--o{ REPAIR_ORDERS : repaired
~~~

The active BOM revision is copied to MO_BOM_SNAPSHOTS at MO creation; subsequent ECOs do not alter open/historical orders. MRP_RUNS freeze their input version and create suggestions, not approved physical or financial postings.

## Purchase, inventory, production, quality, sales and valuation

~~~mermaid
erDiagram
  SUPPLIERS ||--o{ PURCHASE_ORDERS : supplies
  PURCHASE_ORDERS ||--o{ PURCHASE_ORDER_LINES : contains
  PURCHASE_ORDERS ||--o{ PURCHASE_RECEIPTS : receives
  PURCHASE_RECEIPTS ||--o{ PURCHASE_RECEIPT_LINES : contains
  PURCHASE_RECEIPT_LINES ||--o{ QUALITY_CHECKS : inspected
  PURCHASE_RECEIPT_LINES ||--o{ SUPPLIER_REPLACEMENTS : may_request
  SUPPLIERS ||--o{ SUBCONTRACT_ORDERS : fulfills
  SUBCONTRACT_ORDERS ||--o{ SUBCONTRACT_DISPATCH_LINES : takes_material
  SUBCONTRACT_ORDERS ||--o{ SUBCONTRACT_RECEIPTS : returns_output
  SUBCONTRACT_ORDERS ||--o{ SUBCONTRACT_RETURNS : reconciles
  SUBCONTRACT_ORDERS ||--o{ SUBCONTRACT_COST_ADJUSTMENTS : adjusts
  PRODUCTS ||--o{ PRODUCTION_ORDERS : makes
  PRODUCTION_ORDERS ||--|| MO_BOM_SNAPSHOTS : freezes
  PRODUCTION_ORDERS ||--o{ WORK_ORDERS : schedules
  WORK_ORDERS ||--o{ WORK_ORDER_EVENTS : records
  WORK_ORDERS ||--o{ WORK_ORDER_ASSIGNMENTS : assigns
  PRODUCTION_ORDERS ||--o{ MATERIAL_ISSUES : consumes
  MATERIAL_ISSUES ||--o{ MATERIAL_RETURNS : reverses_unused
  PRODUCTION_ORDERS ||--o{ PRODUCTION_OUTPUTS : yields
  PRODUCTION_ORDERS ||--o{ SCRAP_EVENTS : loses
  PRODUCTION_ORDERS ||--o{ QUALITY_CHECKS : inspected
  QUALITY_CONTROL_POINTS ||--o{ QUALITY_CHECKS : requires
  QUALITY_CHECKS ||--o{ QUARANTINE_DISPOSITIONS : decides
  QUALITY_CHECKS ||--o{ QUALITY_ALERTS : raises
  QUALITY_ALERTS ||--o{ CAPA_EVENTS : resolves
  STOCK_SKUS ||--o{ STOCK_BALANCES : balances
  STOCK_SKUS ||--o{ STOCK_MOVEMENTS : moves
  WAREHOUSES ||--o{ STOCK_BALANCES : holds
  WAREHOUSE_LOCATIONS |o--o{ STOCK_BALANCES : bins
  LOTS ||--o{ STOCK_MOVEMENTS : traces
  LOTS ||--o{ SERIAL_UNITS : groups
  STOCK_SKUS ||--o{ LOTS : batches
  STOCK_SKUS ||--o{ STOCK_RESERVATIONS : reserves
  STOCK_RESERVATIONS |o--o{ LOTS : pins
  CUSTOMERS ||--o{ SALES_ORDERS : orders
  SALES_ORDERS ||--o{ SALES_ORDER_LINES : contains
  SALES_ORDERS ||--o{ SHIPMENTS : ships
  SHIPMENTS ||--o{ SHIPMENT_LINES : contains
  SHIPMENT_LINES ||--o{ CUSTOMER_RETURNS : may_return
  CUSTOMER_RETURNS ||--o{ RETURN_DISPOSITIONS : decides
  SHIPMENT_LINES ||--o{ LOT_ALLOCATIONS : values
  LOTS ||--o{ LOT_ALLOCATIONS : traced
  SUPPLIERS ||--o{ PAYABLE_ENTRIES : owes
  CUSTOMERS ||--o{ RECEIVABLE_ENTRIES : owes
  PRODUCTION_ORDERS ||--o{ COST_COMPONENTS : costs
  LOTS ||--o{ VALUATION_EVENTS : values
  COST_COMPONENTS ||--o{ COST_VARIANCE_ENTRIES : reconciles
  SHIPMENT_LINES ||--o{ COST_VARIANCE_ENTRIES : attributable
  RECONCILIATION_CASES |o--o{ COST_VARIANCE_ENTRIES : resolves
~~~

STOCK_MOVEMENTS are physical quantity history; STOCK_BALANCES are transactionally maintained read projections. A shipment and return retain exact LOT/serial allocations and frozen cost basis. A financial variance is a new row linked to its source, not an edit of a historical shipment or LOT.

## Platform, audit and operational controls

~~~mermaid
erDiagram
  PLATFORM_OPERATORS ||--o{ PLATFORM_SESSIONS : signs_in
  PLATFORM_ROLES ||--o{ PLATFORM_OPERATORS : assigned
  PLATFORM_OPERATORS ||--o{ PLATFORM_AUDIT_EVENTS : acts
  PLATFORM_OPERATORS ||--o{ SUPPORT_TICKETS : handles
  SUPPORT_TICKETS ||--o{ SUPPORT_NOTES : records
  TENANTS ||--o{ SUPPORT_TICKETS : associated
  TENANTS ||--o{ SUPPORT_ACCESS_GRANTS : authorizes
  SUPPORT_TICKETS ||--o{ SUPPORT_ACCESS_GRANTS : justifies
  TENANTS ||--o{ AUDIT_EVENTS : records
  TENANTS ||--o{ ACTIVITY_EVENTS : displays
  TENANTS ||--o{ OUTBOX_EVENTS : publishes
  TENANTS ||--o{ IDEMPOTENCY_KEYS : deduplicates
  TENANTS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ NOTIFICATION_READS : reads
  TENANTS ||--o{ ATTACHMENTS : owns
  TENANTS ||--o{ IMPORT_JOBS : imports
  IMPORT_JOBS ||--o{ IMPORT_QUARANTINE : isolates
  TENANTS ||--o{ RECONCILIATION_CASES : resolves
  TENANTS ||--o{ ACCOUNTING_PERIODS : controls
  RECONCILIATION_CASES ||--o{ RECONCILIATION_CASE_EVENTS : records
~~~

A PLATFORM_OPERATOR is not a TENANT_MEMBERSHIP. SUPPORT_ACCESS_GRANTS are narrow, consented and expiring; platform administration does not acquire manufacturing permissions. Denied requests are audited without exposing tenant data in the response.

## Cross-module dependency flow

~~~mermaid
flowchart LR
  Identity --> Access
  Access --> Catalog
  Catalog --> Planning
  Catalog --> Procurement
  Catalog --> Inventory
  Catalog --> Manufacturing
  Planning --> Procurement
  Planning --> Manufacturing
  Procurement --> Inventory
  Procurement --> Quality
  Procurement --> Payables
  Inventory --> Manufacturing
  Inventory --> Sales
  Manufacturing --> Quality
  Manufacturing --> Costing
  Equipment --> Planning
  Equipment --> Manufacturing
  Quality --> Inventory
  Quality --> Costing
  Sales --> Receivables
  Sales --> Costing
  Costing --> Reporting
  Payables --> Reporting
  Receivables --> Reporting
  Reporting --> Notifications
~~~

The arrows show business data or command dependencies, not source-code imports. A single application command handler coordinates synchronous stock/ledger transactions. Outbox drives asynchronous external work so no module has to import another module's persistence internals.
