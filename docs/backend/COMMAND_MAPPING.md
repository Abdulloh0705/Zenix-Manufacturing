# ZENIX 102-command source-to-API mapping

Status: design and parity register. Source: ../../src/app/providers/AppProvider/AppContext.tsx DOMAIN_ACTIONS, ../../src/domain/actions.ts, ../../src/domain/access.ts ACTION_RULES. Generated from the current frontend source, not a manually shortened feature list.

Each row maps to POST /api/v1/commands/{name}, with body {payload:{named fields below},requestVersion:1}. The server supplies state, Ctx, authenticated actor, tenant, timestamp and ID generator. The route is an explicit allowlist. A row means a typed handler and parity tests, not automatic exposure of arbitrary functions. All business writes include idempotency and transactional audit. The current ACTION_RULES expression is reproduced as an effective permission summary; record/site scope and role rank checks in access.ts still apply.

Source argument aliases such as CreateOrderPayload, ReceiveOptions, SalesPayload and RoleInput are defined in ../../src/domain/actions.ts and ../../src/types/index.ts. A backend DTO may narrow server-owned fields but must preserve every accepted client input and validation outcome. The frontend ActionResult message/code/id semantics are preserved by the API adapter.

## Manufacturing and planning

Owner: production/planning. Transaction effects: MO, work order, forecast, reservation, stock, cost.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 1 | createProductionOrder | p:CreateOrderPayload | production.create | actions.ts:685; access.ts:75 | Current action semantics and scope preserved. |
| 2 | updateProductionOrder | id:string; patch:Partial&lt;Pick&lt;ProductionOrder,'quantity'&#124;'due'&#124;'start'&#124;'priority'&#124;'lineId'&#124;'responsibleId'&gt;&gt; | production.edit | actions.ts:741; access.ts:75 | Current action semantics and scope preserved. |
| 3 | transitionProduction | id:string; status:ProductionStatus | Jarayonda/Pauzada/Sifat nazoratida: production.execute OR production.edit; boshqa status: production.edit | actions.ts:1036; access.ts:76 | Status-dependent permission and transition graph. |
| 4 | shortCloseProduction | id:string; reason='Qolgan miqdor bekor qilindi' | production.edit | actions.ts:1152; access.ts:75 | Current action semantics and scope preserved. |
| 5 | reportOutput | id:string; good:number; scrap=0; reason='Shop Floor scrap'; key?:string | production.execute OR production.edit | actions.ts:981; access.ts:81 | Current action semantics and scope preserved. |
| 6 | recordScrap | id:string; qty:number; reason:string | production.execute OR production.edit | actions.ts:1016; access.ts:81 | Current action semantics and scope preserved. |
| 7 | reconcileReworkOwnership | orderId:string; allocations:{lotId:string;qty:number}[]; reason:string | quality.edit OR production.edit | actions.ts:1705; access.ts:88 | Current action semantics and scope preserved. |
| 8 | issueExtraMaterial | orderId:string; materialId:string; qty:number; reason:string; entryUnit?:string | production.edit | actions.ts:1382; access.ts:81 | Current action semantics and scope preserved. |
| 9 | returnUnusedMaterial | orderId:string; issueId:string; qty:number; reason:string; key:string | production.edit OR warehouse.edit | actions.ts:1412; access.ts:81 | Current action semantics and scope preserved. |
| 10 | splitProduction | id:string; splitQty:number | production.edit | actions.ts:1472; access.ts:82 | Current action semantics and scope preserved. |
| 11 | mergeProduction | ids:string[] | production.edit | actions.ts:1507; access.ts:82 | Current action semantics and scope preserved. |
| 12 | createBackorder | id:string | production.edit | actions.ts:1539; access.ts:82 | Current action semantics and scope preserved. |
| 13 | unbuildProduct | productId:string; qty:number; recoveryPct=100 | production.edit | actions.ts:1610; access.ts:82 | Current action semantics and scope preserved. |
| 14 | checkAvailability | id:string | production.edit | actions.ts:1175; access.ts:82 | May update reservation/readiness; keep as command. |
| 15 | refreshMaterialReservation | id:string | production.edit | actions.ts:1190; access.ts:83 | Current action semantics and scope preserved. |
| 16 | startWorkOrder | orderId:string; workOrderId:string; employeeId?:string | production.execute OR production.edit | actions.ts:1221; access.ts:81 | Current action semantics and scope preserved. |
| 17 | pauseWorkOrder | orderId:string; workOrderId:string | production.execute OR production.edit | actions.ts:1293; access.ts:81 | Current action semantics and scope preserved. |
| 18 | finishWorkOrder | orderId:string; workOrderId:string | production.execute OR production.edit | actions.ts:1294; access.ts:81 | Current action semantics and scope preserved. |
| 19 | markSetupDone | orderId:string; workOrderId:string | production.execute OR production.edit | actions.ts:1300; access.ts:85 | Current action semantics and scope preserved. |
| 20 | reportOperationOutput | orderId:string; workOrderId:string; good:number; scrap=0; opts:OperationReportOptions={} | production.execute OR production.edit | actions.ts:1326; access.ts:85 | Current action semantics and scope preserved. |
| 21 | assignWorkOrder | orderId:string; workOrderId:string; employeeIds:string[] | production.edit | actions.ts:1360; access.ts:85 | Current action semantics and scope preserved. |
| 22 | rescheduleProductionOrder | id:string; start:string; opts:RescheduleOptions={} | production.edit | actions.ts:4571; access.ts:85 | Current action semantics and scope preserved. |
| 23 | confirmMrpSuggestion | key:string; opts:ConfirmSuggestionOptions={} | buy tavsiyasi: purchases.create; make tavsiyasi: production.create | actions.ts:4602; access.ts:87 | Suggestion becomes draft PO or MO exactly once. |
| 24 | setForecast | productId:string; period:string; qty:number; opts:{branchId?:string;variantId?:string}={} | production.edit | actions.ts:4642; access.ts:83 | Current action semantics and scope preserved. |
| 25 | recordMaterialScan | orderId:string; code:string | production.execute OR production.edit | actions.ts:1445; access.ts:81 | Current action semantics and scope preserved. |
| 26 | rollUpCosts | (none) | products.edit | actions.ts:4556; access.ts:83 | Current action semantics and scope preserved. |
| 27 | createReworkOrder | sourceOrderId:string; qty:number; reason:string | quality.edit OR production.create | actions.ts:1640; access.ts:88 | Preserve source LOT genealogy and custody. |

## Quality

Owner: quality. Transaction effects: QC, alert, stock disposition.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 28 | createQualityCheck | payload:Partial&lt;QualityCheck&gt; | quality.create OR production.execute OR production.edit | actions.ts:1711; access.ts:88 | Current action semantics and scope preserved. |
| 29 | resolveQuality | id:string; status:QualityCheck['status']; reason=''; measured=''; qty?:number | quality.edit | actions.ts:1747; access.ts:88 | QC release, scrap and accounting effects are atomic. |
| 30 | createQualityAlert | payload:{title:string;sourceId:string;severity:'Past'&#124;'O‘rta'&#124;'Yuqori';reason:string;ownerId?:string} | quality.create | actions.ts:1921; access.ts:88 | Current action semantics and scope preserved. |

## Procurement and subcontract

Owner: procurement. Transaction effects: PO, receipt, supplier, payable, QC, stock, subcontract.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 31 | createPurchaseOrder | p:PurchasePayload | Draft: purchases.create; tasdiqqa tayyor: purchases.approve | actions.ts:2022; access.ts:90 | Draft versus non-draft approval rule. |
| 32 | createPurchaseOrders | orders:PurchasePayload[] | hammasi Draft: purchases.create; aks holda: purchases.approve | actions.ts:2053; access.ts:91 | Batch atomicity and all-draft permission rule. |
| 33 | linkSupplierMaterial | input:LinkInput | purchases.edit OR materials.edit | actions.ts:2471; access.ts:92 | Current action semantics and scope preserved. |
| 34 | updateSupplierMaterial | id:string; patch:Partial&lt;LinkInput&gt; | purchases.edit OR materials.edit | actions.ts:2480; access.ts:92 | Current action semantics and scope preserved. |
| 35 | removeSupplierMaterial | id:string | purchases.edit OR materials.edit | actions.ts:2494; access.ts:92 | Current action semantics and scope preserved. |
| 36 | setPreferredSupplier | materialId:string; supplierId:string | materials.edit OR purchases.edit | actions.ts:2504; access.ts:92 | Current action semantics and scope preserved. |
| 37 | confirmPurchase | id:string | purchases.approve | actions.ts:2066; access.ts:93 | Current action semantics and scope preserved. |
| 38 | markPurchaseInTransit | id:string | purchases.edit | actions.ts:2082; access.ts:93 | Current action semantics and scope preserved. |
| 39 | cancelPurchase | id:string | purchases.edit | actions.ts:2124; access.ts:93 | Current action semantics and scope preserved. |
| 40 | closePurchaseShort | id:string; reason:string | purchases.edit | actions.ts:2139; access.ts:93 | Current action semantics and scope preserved. |
| 41 | updatePurchaseMeta | id:string; patch:{invoiceStatus?:string;paymentStatus?:string;expectedDate?:string} | purchases.edit | actions.ts:2112; access.ts:93 | Current action semantics and scope preserved. |
| 42 | recordSupplierPayment | p:{supplierId:string;amount:number;key:string;purchaseOrderId?:string;method?:string;reason:string} | purchases.approve OR costs.edit | actions.ts:1941; access.ts:94 | Current action semantics and scope preserved. |
| 43 | adjustSupplierBalance | p:{supplierId:string;amount:number;key:string;reason:string} | purchases.approve OR costs.edit | actions.ts:1959; access.ts:94 | Current action semantics and scope preserved. |
| 44 | receivePurchase | purchaseId:string; materialId:string; qty:number; lotOverride?:string; expiryOverride?:string; opts:ReceiveOptions={} | purchases.edit OR warehouse.edit | actions.ts:2185; access.ts:93 | Receipt, lot, quarantine, payable and incoming decrement atomic. |
| 45 | returnPurchaseToSupplier | qualityCheckId:string; qty?:number; note='' | purchases.edit OR warehouse.edit | actions.ts:2390; access.ts:93 | No duplicate return or credit posting. |
| 46 | updatePurchaseDraft | id:string; p:{lines:PurchaseLineInput[];warehouseId?:string;expectedDate?:string;allowBelowMoq?:boolean} | purchases.edit | actions.ts:2093; access.ts:96 | Current action semantics and scope preserved. |
| 47 | inspectReceipt | qualityCheckId:string; accepted:number; reason=''; measured=''; rejectedSerials?:string[]&#124;string | quality.edit | actions.ts:2286; access.ts:96 | Accepted/rejected quantities and quarantine reconcile. |
| 48 | scrapRejectedReceipt | qualityCheckId:string; reason:string; qty?:number | quality.edit | actions.ts:2395; access.ts:96 | Current action semantics and scope preserved. |
| 49 | requestSupplierReplacement | p:{qualityCheckId:string;qty?:number&#124;string;note?:string;key:string} | purchases.edit | actions.ts:2408; access.ts:98 | Current action semantics and scope preserved. |
| 50 | receiveSupplierReplacement | replacementId:string; qty:number; opts:ReceiveOptions&{lot?:string;expiry?:string}={} | purchases.edit OR warehouse.edit | actions.ts:2436; access.ts:98 | Does not inflate original PO line receipt. |
| 51 | closeSupplierReplacement | replacementId:string; reason:string | purchases.edit | actions.ts:2453; access.ts:98 | Current action semantics and scope preserved. |
| 52 | advanceSubcontract | id:string; receivedQty?:number; receiptKey?:string | purchases.edit | actions.ts:4129; access.ts:93 | Current dispatch/partial-receipt allocation and QC retained. |
| 53 | correctSubcontractServiceCost | id:string; cost:number; exchangeRate:number; reason:string | purchases.edit | actions.ts:4105; access.ts:93 | Existing command remains pre-first-receipt only; FIN-02 adds separate adjustment workflow. |
| 54 | cancelSubcontract | id:string; reason:string | purchases.edit | actions.ts:4120; access.ts:93 | Existing Draft-only cancellation remains; FIN-01 adds return-and-close. |

## Sales and receivables

Owner: sales. Transaction effects: SO, shipment, return, receivable, stock, valuation.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 55 | createSalesOrder | p:SalesPayload | sales.create | actions.ts:2606; access.ts:101 | Current action semantics and scope preserved. |
| 56 | reserveSalesOrder | id:string | sales.edit | actions.ts:2672; access.ts:101 | Current action semantics and scope preserved. |
| 57 | deliverSalesOrder | id:string; quantities?:Record&lt;string,number&gt; | sales.edit OR warehouse.edit | actions.ts:2679; access.ts:101 | LOT/serial allocation and frozen delivery cost. |
| 58 | cancelSalesOrder | id:string | sales.edit | actions.ts:2915; access.ts:101 | Current action semantics and scope preserved. |
| 59 | updateSalesMeta | id:string; patch:{paymentStatus?:string;deliveryDate?:string} | sales.edit | actions.ts:2780; access.ts:101 | Current action semantics and scope preserved. |
| 60 | recordCustomerPayment | p:CustomerPaymentInput | sales.edit | actions.ts:2815; access.ts:101 | Current action semantics and scope preserved. |
| 61 | adjustCustomerBalance | p:ReceivableAdjustmentInput | sales.approve | actions.ts:2865; access.ts:101 | Current action semantics and scope preserved. |
| 62 | resolveReturnCredit | p:{returnId:string;decision:'credit'&#124;'no-credit';reason:string} | sales.approve | actions.ts:2890; access.ts:100 | Legacy credit must be explicit, not guessed. |
| 63 | createReturn | p:{salesOrderId:string;productId:string;qty:number;reason:string;serials?:string[]&#124;string} | sales.create OR quality.edit | actions.ts:2941; access.ts:101 | Current action semantics and scope preserved. |
| 64 | dispositionReturn | id:string; decision:'Omborga qaytarildi'&#124;'Rework'&#124;'Scrap' | quality.edit | actions.ts:3010; access.ts:101 | Original shipment cost and linked variance reversed. |

## Inventory

Owner: inventory. Transaction effects: balance, movement, reservation, LOT/serial, location.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 65 | transferStock | itemId:string; from:string; to:string; qty:number; lots?:LotPin[]; opts:{fromLocation?:string;toLocation?:string;unit?:string}={} | warehouse.edit | actions.ts:3111; access.ts:102 | Current action semantics and scope preserved. |
| 66 | moveStockBin | p:{warehouseId:string;itemId:string;from:string;to:string;qty:number;lot?:string;unit?:string} | warehouse.edit | actions.ts:3207; access.ts:104 | Current action semantics and scope preserved. |
| 67 | assignVariantStock | p:{warehouseId:string;productId:string;variantId:string;qty:number;lot?:string;note?:string} | warehouse.edit | actions.ts:3392; access.ts:104 | Current action semantics and scope preserved. |
| 68 | setVariantStock | productId:string; on:boolean | products.edit | actions.ts:3369; access.ts:104 | Cannot silently reinterpret existing balances. |
| 69 | allocateLegacyLots | kind:'mo'&#124;'so'; id:string | MO: warehouse.edit OR production.edit; SO: warehouse.edit OR sales.edit | actions.ts:3430; access.ts:105 | MO/SO-dependent permission and no invented LOT provenance. |
| 70 | adjustStock | itemId:string; warehouseId:string; delta:number; note:string; opts:AdjustOptions={} | warehouse.edit | actions.ts:3273; access.ts:102 | Reason and idempotency key mandatory. |
| 71 | countStock | balanceId:string; counted:number; note:string; opts:{location?:string;lots?:LotPin[];key?:string}={} | warehouse.edit | actions.ts:3348; access.ts:102 | Count evidence and exact movement delta. |

## Equipment and maintenance

Owner: equipment. Transaction effects: equipment, downtime, maintenance, capacity input.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 72 | startDowntime | equipmentId:string; reason:DowntimeReason; note=''; sourceId?:string | equipment.edit OR production.execute OR production.edit | actions.ts:3483; access.ts:106 | Current action semantics and scope preserved. |
| 73 | endDowntime | eventId:string | equipment.edit OR production.execute OR production.edit | actions.ts:3497; access.ts:106 | Current action semantics and scope preserved. |
| 74 | approveMaintenanceRequest | id:string | equipment.approve | actions.ts:3579; access.ts:106 | Current action semantics and scope preserved. |
| 75 | startMaintenance | id:string | equipment.edit | actions.ts:3592; access.ts:106 | Current action semantics and scope preserved. |
| 76 | completeMaintenance | id:string; cost?:number; note='' | equipment.edit | actions.ts:3608; access.ts:106 | Current action semantics and scope preserved. |
| 77 | cancelMaintenance | id:string; reason='' | equipment.edit | actions.ts:3636; access.ts:106 | Current action semantics and scope preserved. |
| 78 | planPreventiveMaintenance | horizonDays=14 | equipment.edit | actions.ts:3686; access.ts:106 | Current action semantics and scope preserved. |
| 79 | advanceRepair | id:string | equipment.edit | actions.ts:3721; access.ts:106 | Current action semantics and scope preserved. |
| 80 | createMaintenanceOrder | p:MaintenanceInput | equipment.edit | actions.ts:3550; access.ts:108 | Current action semantics and scope preserved. |
| 81 | updateMaintenanceOrder | id:string; patch:{scheduled?:string;plannedHours?:number;technicianId?:string;note?:string;override?:string} | equipment.edit | actions.ts:3566; access.ts:108 | Current action semantics and scope preserved. |
| 82 | saveMaintenancePlan | equipmentId:string; plan:{unit:string;interval:number;durationHours?:number}&#124;null; nextDate?:string | equipment.edit | actions.ts:3647; access.ts:108 | Current action semantics and scope preserved. |
| 83 | recordEquipmentRuntime | equipmentId:string; hours:number | equipment.edit | actions.ts:3668; access.ts:108 | Current action semantics and scope preserved. |

## Catalog, BOM and ECO

Owner: catalog/engineering. Transaction effects: item, variant, BOM, routing, ECO.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 84 | createBomDraft | productId:string; fromBomId?:string; variantId?:string | products.create | actions.ts:3814; access.ts:109 | Current action semantics and scope preserved. |
| 85 | saveBom | bom:Bom | products.edit | actions.ts:3835; access.ts:109 | Current action semantics and scope preserved. |
| 86 | deleteBomDraft | id:string | products.delete | actions.ts:3960; access.ts:109 | Current action semantics and scope preserved. |
| 87 | activateBom | id:string | products.approve | actions.ts:3918; access.ts:109 | Current action semantics and scope preserved. |
| 88 | createEngineeringChange | p:{productId:string;title:string;reason:string;changeSummary:string;effectiveDate:string} | products.create | actions.ts:4019; access.ts:109 | Current action semantics and scope preserved. |
| 89 | setEcoStatus | id:string; status:'Review'&#124;'Approved'&#124;'Rejected'; note='' | Review: products.edit OR products.approve; boshqa qaror: products.approve | actions.ts:4040; access.ts:111 | Review versus approval permission differs. |
| 90 | applyEngineeringChange | id:string | products.approve | actions.ts:4082; access.ts:109 | New BOM revision; old MO snapshot unchanged. |
| 91 | cancelEngineeringChange | id:string; reason:string | products.edit OR products.approve | actions.ts:4067; access.ts:112 | Current action semantics and scope preserved. |
| 92 | archiveBom | id:string; reason:string | products.approve | actions.ts:3947; access.ts:112 | Current action semantics and scope preserved. |
| 93 | saveRouting | bomId:string; operations:BomOperation[] | products.edit | actions.ts:3898; access.ts:112 | Current action semantics and scope preserved. |
| 94 | copyRouting | targetBomId:string; sourceBomId:string | products.edit | actions.ts:3906; access.ts:112 | Current action semantics and scope preserved. |
| 95 | saveVariant | productId:string; input:{id?:string;code:string;values:Record&lt;string,string&gt;;barcode?:string;priceDelta:number;status:ProductVariant['status']} | products.edit | actions.ts:3974; access.ts:112 | Current action semantics and scope preserved. |

## Roles and permission

Owner: access. Transaction effects: role, role permission, audit.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 96 | updateRolePermission | roleId:string; module:string; action:PermissionAction; value:boolean | roles.edit | actions.ts:4463; access.ts:113 | No self-escalation or scope widening. |
| 97 | createRole | p:RoleInput | roles.create | actions.ts:4481; access.ts:113 | Current action semantics and scope preserved. |
| 98 | duplicateRole | roleId:string; name?:string | roles.create | actions.ts:4497; access.ts:113 | Current action semantics and scope preserved. |
| 99 | updateRole | roleId:string; patch:RoleInput | roles.edit | actions.ts:4514; access.ts:113 | Current action semantics and scope preserved. |
| 100 | deleteRole | roleId:string | roles.delete | actions.ts:4531; access.ts:113 | Current action semantics and scope preserved. |

## Attachments

Owner: attachments. Transaction effects: attachment metadata and object lifecycle.

| # | Frontend command / API suffix | Named payload fields from source | Effective permission | Source line | Extra invariant |
| ---: | --- | --- | --- | --- | --- |
| 101 | addAttachment | a:Omit&lt;Attachment,'id'&#124;'addedAt'&#124;'addedBy'&gt; | ATTACHMENT_MODULE[entityType].edit | actions.ts:4543; AppContext rule | Binary upload uses scoped upload flow; command finalizes metadata. |
| 102 | removeAttachment | id:string | ATTACHMENT_MODULE[entityType].edit | actions.ts:4550; AppContext rule | Requires mapped entity permission and audit. |

## Generic entity and provider operations beyond the 102

These operations are separate AppProvider methods and are not silently counted as one of the 102 DOMAIN_ACTIONS.

| Entity kind | Module for generic create/update/delete/duplicate |
| --- | --- |
| products | products |
| rawMaterials | materials |
| suppliers | purchases |
| customers | sales |
| employees | employees |
| expenses | costs |
| qualityAlerts | quality |
| maintenanceOrders | equipment |
| engineeringChanges | products |
| qualityControlPoints | quality |
| maintenanceRequests | equipment |
| subcontractOrders | purchases |
| repairOrders | equipment |
| warehouses | warehouse |
| workCenters | equipment |
| productionLines | settings |
| equipment | equipment |
| branches | settings |

Generic entity operations also require their action-specific reference, rank and scope guards. The provider additionally exposes saveSupplier, createEntity/updateEntity/deleteEntity/duplicateEntity, registration/login/logout/recovery/password/user management, tenant switch, plan change, settings/preferences, import/backup/reset/recovery, notification read, activity archive and toast/UI state. API_CONTRACT.md covers their server or UI-only equivalent. Platform opTenantStatus/opOverride/opFeature/opSettings/opTicketCreate/opTicketUpdate and session audit remain separately mapped to /platform/v1 routes in ../BACKEND_CONTRACT.md and API_CONTRACT.md. Read-only selectors in dashboard/planning/inventory/maintenance/receivables/payables/profitability/insights/notifications are covered by module read APIs and parity tests.

## Mechanical completion gate

Current DOMAIN_ACTIONS count: 102. Unique mapped rows: 102. ACTION_RULES-mapped: 100. Attachment-module-gated: 2. Generic entity kinds: 18. Any source addition, removal or rename makes this register stale and blocks backend cutover until remapped. All current domain tests plus two-tenant authorization, concurrency and financial reversal tests must pass.
