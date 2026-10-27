import type {AppearanceFamily,ThemeMode} from '../app/theme/themeRegistry'
import type {CurrencyCode} from '../utils/format'
export type {AppearanceFamily,ThemeMode,CurrencyCode}

export type StatusTone='success'|'warning'|'danger'|'info'|'neutral'|'purple'
export type PermissionAction='view'|'create'|'edit'|'delete'|'approve'|'export'|'execute'
export type PermissionMap=Record<string,Partial<Record<PermissionAction,boolean>>>
export type ProductionStatus='Qoralama'|'Tasdiqlangan'|'Material kutilmoqda'|'Jarayonda'|'Pauzada'|'Sifat nazoratida'|'Yakunlangan'|'Bekor qilingan'
export type ActionResult={ok:boolean;message:string;id?:string;
  /** Set when the action can go ahead only with an explicit override (e.g. scheduling onto an unavailable resource). */
  code?:'needs-override'}

export interface SettingsState{
  theme:ThemeMode;appearance:AppearanceFamily;accent:string;currency:CurrencyCode;fontSize:'small'|'standard'|'large';reducedMotion:boolean;
  /** Spacing / control height of the whole UI, and row height of every table (independent). */
  uiDensity:'compact'|'standard'|'comfortable';tableDensity:'compact'|'standard'|'comfortable';
  defaultBranchId:string;defaultWarehouseId:string;defaultLineId:string;language:'uz';
  notifications:{lowStock:boolean;quality:boolean;maintenance:boolean;delay:boolean;ai:boolean};
  ai:{enabled:boolean;credits:number};
  company:{name:string;currency:string;timezone:string;taxId:string};
  policies:{requireFinalQc:boolean;autoQualityChecks:boolean;overheadRate:number;machineRatePerHour:number;shiftMinutes:number;
    /** Company working days (0 = Sunday … 6 = Saturday); default Monday–Friday. A work center calendar can override it. */
    workingDays?:number[];
    /** A PO worth at least `poDualApprovalFrom` (UZS) is approved by someone other than its author. */
    poDualApproval?:boolean;poDualApprovalFrom?:number};
}
export interface Branch{id:string;name:string;code:string;status:'Faol'|'Arxiv'}
export interface Warehouse{id:string;name:string;code:string;branchId:string;type:'Raw'|'WIP'|'Finished'|'Mixed';status:'Faol'|'Arxiv';locations:string[]}
export interface WorkCenter{id:string;name:string;code:string;branchId:string;lineId:string;capacity:number;efficiency:number;status:string;machineIds:string[];costPerHour:number;
  /** Own working calendar; missing parts fall back to the company policy (working days, one shift of policies.shiftMinutes). */
  calendar?:{workingDays?:number[];shifts?:number;shiftMinutes?:number};
  /** Energy cost per running hour (UZS); without it production cost reports energy as not configured. */
  energyCostPerHour?:number}
export interface ProductionLine{id:string;name:string;code:string;branchId:string;shift:string;capacity:number;utilization:number;status:string}
/** A sellable / producible configuration of a product. Stock stays on the product (variants never hold their own balance). */
export interface ProductVariant{id:string;code:string;attributes:string;priceDelta:number;status:'Faol'|'Arxiv';
  /** Structured attribute values (e.g. Rang → kumush); `attributes` is their display text. Absent on variants saved before. */
  values?:Record<string,string>;barcode?:string}
export interface Product{id:string;name:string;sku:string;category:string;unit:string;status:string;type:'finished'|'semi';salePrice:number;standardCost:number;leadTime:number;defaultBomId:string;tracking:'none'|'lot'|'serial';procurement:'make'|'buy';variants:ProductVariant[];image?:string;createdAt:string}
export interface RawMaterial{id:string;name:string;sku:string;category:string;unit:string;status:string;standardCost:number;minStock:number;reorderPoint:number;supplierId:string;leadTime:number;lotTracking:boolean;expiryTracking:boolean}
export interface BomComponent{id:string;materialId:string;qty:number;unit:string;waste:number;subBomId?:string}
export interface BomOperation{id:string;name:string;workCenterId:string;setupMin:number;runMin:number;employeeCount:number;instructions:string;qualityCheck:boolean;dependsOn?:string[];worksheet?:string;barcodeStep?:boolean}
export interface Bom{id:string;code:string;productId:string;version:string;revision:number;status:'Faol'|'Draft'|'Arxiv';effectiveDate:string;waste:number;components:BomComponent[];operations:BomOperation[];byProducts?:{productId:string;qty:number;unit:string}[];notes:string;previousBomId?:string;createdAt?:string;
  /** Variant-specific revision; without it the BOM applies to the product and every variant without its own BOM. */
  variantId?:string;
  /** Release (activation) and archive stamps; `ecoId` = the engineering change that released this revision. */
  releasedAt?:string;releasedBy?:string;ecoId?:string;archivedAt?:string}
export interface StockBalance{id:string;warehouseId:string;itemId:string;itemType:'raw'|'finished';onHand:number;reserved:number;incoming:number;quarantine?:number;unit:string;lot?:string;expiry?:string}
export interface StockMovement{id:string;date:string;type:string;itemId:string;itemType:'raw'|'finished';warehouseId:string;qty:number;source:string;note:string;user:string;lot?:string}

export type WorkOrderStatus='Kutilmoqda'|'Tayyor'|'Jarayonda'|'Pauzada'|'Yakunlangan'|'Bekor qilingan'
export type WorkOrderEvent={at:string;action:'start'|'resume'|'pause'|'setup'|'complete'|'output'|'assign'|'cancel'|'split';by:string;minutes?:number;good?:number;scrap?:number;note?:string}
/**
 * Work order (job card) of one routing operation. `actualMin` is productive time only: the sum of closed
 * start→pause/finish intervals; the running interval is `lastStartAt` → now. Pauses never count.
 */
export interface WorkOrder{id:string;operationId:string;name:string;workCenterId:string;sequence:number;status:WorkOrderStatus;plannedMin:number;actualMin:number;startedAt?:string;lastStartAt?:string;completedAt?:string;dependsOn:string[];
  /** Operators assigned to the job card. */
  operatorIds?:string[];
  /** Good and scrapped units reported at this operation. */
  goodQty?:number;scrapQty?:number;
  /** Measured setup minutes (included in actualMin): the time before the operator marked setup done. */
  setupActualMin?:number;
  /** Machine and energy cost per hour frozen at the first start, so later rate changes do not rewrite actual cost. */
  machineRate?:number;energyRate?:number;
  history?:WorkOrderEvent[];
  /** Keys of operation reports already posted (a repeated submit is a no-op). */
  reportKeys?:string[]}
/** `unitCost` = UZS per stock unit at the moment of issue (lot purchase price or standard cost then); absent on older rows. */
export interface MaterialConsumption{materialId:string;itemType:'raw'|'finished';qty:number;lot?:string;date:string;unitCost?:number}
/** Stock one production order still holds in reserve for one component in one warehouse. */
export interface MaterialReservation{materialId:string;warehouseId:string;qty:number}
export interface ProductionOrder{
  id:string;code:string;productId:string;quantity:number;completed:number;scrap:number;bomId:string;bomVersion:string;bomSnapshot:Bom;warehouseId:string;lineId:string;workCenterId:string;responsibleId:string;status:ProductionStatus;start:string;due:string;progress:number;priority:'Past'|'Normal'|'Yuqori'|'Kritik';salesOrderId?:string;estimatedCost:number;actualCost:number;materialReserved:boolean;qualityStatus:string;createdAt:string;startedAt?:string;completedAt?:string;parentOrderId?:string;backorderOf?:string;source?:string;lot?:string;serialRange?:string;
  workOrders:WorkOrder[];consumed:MaterialConsumption[];reworkOf?:string;
  /** Per-order reservation; absent on orders saved before it existed (see orderReservations). */
  reservations?:MaterialReservation[];
  /** Units this order still holds in Final QC quarantine in `warehouseId`; absent on orders saved before it existed (see orderQcHold). */
  qcHeld?:number;
  /** Planned and actual cost frozen when the order completed, so later price changes do not rewrite history (BUG-08). */
  costSnapshot?:{planned:CostSnapshot;actual:CostSnapshot;at:string};
  /** Keys of output reports already posted, so a repeated submit is a no-op (BUG-13). */
  outputKeys?:string[];
  /** Material issued on top of the BOM plan, each with its reason and who allowed it (N-20). */
  extraIssues?:ExtraIssue[];
  /** Set when a planner scheduled the order onto an unavailable resource on purpose. */
  scheduleOverride?:{by:string;at:string;reason:string};
  /** Product variant being made; its BOM was resolved for this variant when the order was created. */
  variantId?:string;
}
export type ExtraIssue={materialId:string;qty:number;reason:string;by:string;at:string}
export type CostSnapshot={material:number;labor:number;machine:number;overhead:number;total:number;
  /** Energy of machine running time; absent on snapshots frozen before it was costed. */
  energy?:number}
export interface Supplier{id:string;name:string;phone:string;leadTime:number;rating:number;status:string;debt:number;email?:string}
/**
 * Supplier ↔ material sourcing terms (many-to-many, one row per pair). Prices are quoted per purchase
 * unit in the supplier's currency; `unitFactor` = material stock units in one purchase unit. Last purchase
 * fields are written by confirmed purchase orders (UZS per stock unit).
 */
export interface SupplierMaterial{id:string;supplierId:string;materialId:string;supplierSku:string;price:number;currency:CurrencyCode;purchaseUnit:string;unitFactor:number;moq:number;leadTime:number;active:boolean;lastPrice?:number;lastPurchaseDate?:string;lastPurchaseOrderId?:string;createdAt:string}
export type ReceiptInspection='none'|'pending'|'accepted'|'partial'|'rejected'
/**
 * One goods receipt of one PO line. `lot` is the internal lot; `supplierLot` the supplier's own number. Quantities are
 * stock units: accepted + rejected = qty once inspected; rejected units stay in quarantine until returned or scrapped.
 * Receipts saved before these fields existed are read through `receiptQuantities`.
 */
export interface PurchaseReceipt{id:string;date:string;materialId:string;qty:number;lot:string;warehouseId?:string;key?:string;
  supplierLot?:string;location?:string;receivedBy?:string;inspection?:ReceiptInspection;qualityCheckId?:string;
  accepted?:number;rejected?:number;returned?:number;scrapped?:number}
/** PO line: `qty`/`received` in material stock units, `price` in UZS per stock unit; supplier terms are kept for display. */
export interface PurchaseLine{materialId:string;qty:number;received:number;price:number;linkId?:string;purchaseUnit?:string;unitFactor?:number;currency?:CurrencyCode;unitPrice?:number}
export interface PurchaseOrder{id:string;code:string;supplierId:string;warehouseId:string;status:'Qoralama'|'Tasdiqlangan'|'Yo‘lda'|'Qisman qabul'|'Qabul qilindi'|'Bekor';items:PurchaseLine[];total:number;invoiceStatus:string;paymentStatus:string;expectedDate:string;createdAt:string;receipts:PurchaseReceipt[];receivedAt?:string;source?:string;productionOrderIds?:string[];
  /** Who created and who approved the PO (separation of duties, A-M6). */
  createdBy?:string;approvedBy?:string;
  /** Set when the not-received rest was closed instead of received (BUG-09). */
  closedShort?:{date:string;reason:string;open:string}}
export interface Customer{id:string;name:string;phone:string;type:string;status:string;debt:number;email?:string}
export interface SalesOrder{id:string;code:string;customerId:string;status:'Yangi'|'Tasdiqlangan'|'Ishlab chiqarishda'|'Tayyor'|'Yetkazildi'|'Bekor';mode:'Make-to-stock'|'Make-to-order';items:{productId:string;qty:number;price:number;delivered:number;reserved:number;warehouseId?:string;reservations?:{warehouseId:string;qty:number}[];variantId?:string}[];productionOrderId?:string;productionOrderIds?:string[];total:number;paymentStatus:string;deliveryDate:string;createdAt:string;deliveredAt?:string}
export interface QualityCheck{id:string;type:'Kirish'|'Jarayon'|'Final';sourceType:'purchase'|'production'|'return'|'subcontract';sourceId:string;itemId:string;status:'Pending'|'Passed'|'Failed'|'Rework'|'Hold'|'Scrap';inspectorId:string;date:string;reason?:string;correctiveAction?:string;controlPointId?:string;lot?:string;receiptId?:string;measured?:string;
  /** In-process checks: the work order (operation) and the operator who ran it. */
  workOrderId?:string;operatorId?:string;
  /** Quantity of this check's receipt already shipped back to the supplier (N-03). */
  returnedQty?:number;
  /** Incoming inspection split of the receipt: units released to stock and units rejected (kept apart for disposition). */
  acceptedQty?:number;rejectedQty?:number}
export interface QualityAlert{id:string;title:string;sourceId:string;severity:'Past'|'O‘rta'|'Yuqori';status:'Ochiq'|'Jarayonda'|'Yopilgan';reason:string;ownerId:string;createdAt:string;rootCause?:string;correctiveAction?:string;preventiveAction?:string;resolution?:string}
/** Preventive plan: every `interval` days / weeks / months, or every `interval` running hours (needs runtime readings). */
export interface MaintenancePlan{unit:'day'|'week'|'month'|'runtime';interval:number;
  /** Planned service duration (hours); without it a planned service blocks the whole day in capacity. */
  durationHours?:number}
/**
 * `mtbf` / `mttr` are legacy stored numbers; reliability is computed from recorded failures (maintenance.ts reliabilityOf).
 * `runtimeHours` is the latest meter reading; `runtimeAtService` the reading when preventive service was last done.
 */
export interface Equipment{id:string;name:string;model:string;serial:string;workCenterId:string;status:'Ishlamoqda'|'Servis yaqin'|'To‘xtagan';lastMaintenance:string;nextMaintenance:string;mtbf:number;mttr:number;downtime:number;maintenanceCost:number;maintenanceIntervalDays:number;
  maintenancePlan?:MaintenancePlan;runtimeHours?:number;runtimeReadAt?:string;runtimeAtService?:number}
export type MaintenanceEvent={at:string;by:string;action:string;note?:string}
/** Requested → planned (Rejada) → in progress → completed; cancelled from planned. `scheduled` is the planned start. */
export interface MaintenanceOrder{id:string;code:string;equipmentId:string;type:'Preventive'|'Corrective'|'Emergency';status:'Rejada'|'Jarayonda'|'Yakunlangan'|'Bekor';scheduled:string;completed?:string;technicianId:string;cost:number;note:string;requestId?:string;startedAt?:string;
  /** Planned duration (hours): the planned end is scheduled + plannedHours. */
  plannedHours?:number;
  /** Machine stop minutes recorded while the work ran (from its downtime event). */
  downtimeMinutes?:number;
  /** Set when it was planned on top of another service of the same machine on purpose. */
  override?:{by:string;at:string;reason:string};
  history?:MaintenanceEvent[]}
export interface Employee{id:string;name:string;roleId:string;department:string;workCenterId:string;shift:string;status:string;attendance:number;efficiency:number;hourlyCost:number;
  /** Home warehouse for a "warehouse"-scoped role; without it the scope falls back to the employee's branch. */
  warehouseId?:string}
export type SystemRoleKey='super_admin'|'admin'|'production_manager'|'operator'|'quality'|'maintenance'|'warehouse'|'supply_sales'
export interface Role{id:string;name:string;scope:'all'|'branch'|'warehouse'|'workcenter';permissions:PermissionMap;
  /** Set on the eight built-in roles; they cannot be deleted. */
  key?:SystemRoleKey;system?:boolean;description?:string;createdAt?:string}
export interface Expense{id:string;date:string;type:'Electricity'|'Labor'|'Machine'|'Maintenance'|'Transport'|'Overhead';sourceId:string;amount:number;note:string}

/** One field of a BOM / routing an engineering change modifies, with its old and proposed value. */
export type EcoChange={kind:'add'|'remove'|'change';area:'component'|'operation'|'byproduct'|'header';target:string;field?:string;old?:string;proposed?:string;text:string}
export type EcoEvent={at:string;by:string;action:string;note?:string}
export interface EngineeringChange{id:string;code:string;title:string;productId:string;bomId:string;newBomId?:string;fromVersion:string;toVersion:string;status:'Draft'|'Review'|'Approved'|'Applied'|'Rejected'|'Cancelled';effectiveDate:string;ownerId:string;reason:string;changeSummary:string;documents:string[];createdAt:string;approvedBy?:string;
  /** The requested changes frozen when the ECO went to review; `fingerprint` = the proposed revision content then. */
  changes?:EcoChange[];fingerprint?:string;
  approvedAt?:string;appliedAt?:string;appliedBy?:string;
  history?:EcoEvent[]}
export interface QualityControlPoint{id:string;title:string;scope:'Incoming'|'In-process'|'Final';productId?:string;operationName?:string;frequency:'Every time'|'Random'|'Periodic'|'On demand';sampleRate:number;checkType:'Instructions'|'Measure'|'Pass-Fail'|'Photo';instructions:string;active:boolean;
  /** Mandatory: an open or failed in-process check of this point blocks the next operation. */
  blocking?:boolean}
export interface MaintenanceRequest{id:string;code:string;equipmentId:string;type:'Preventive'|'Corrective'|'Emergency';priority:'Normal'|'Yuqori'|'Kritik';status:'Yangi'|'Tasdiqlangan'|'Jarayonda'|'Yakunlangan';requestedBy:string;scheduled:string;reason:string;downtimeHours:number;startedAt?:string}
export interface SubcontractOrder{id:string;code:string;supplierId:string;productId:string;qty:number;status:'Draft'|'Material yuborildi'|'Ishlab chiqarishda'|'Qabul qilindi';materialIds:string[];expectedDate:string;cost:number;
  /** Where the receipt went and how much of it still waits for incoming QC (N-07). */
  warehouseId?:string;qcHeld?:number}
export interface RepairOrder{id:string;code:string;equipmentId:string;status:'Yangi'|'Diagnostika'|'Ta’mirda'|'Sinov'|'Yakunlangan';issue:string;technicianId:string;partsCost:number;laborHours:number;createdAt:string}

export interface TimeLog{id:string;orderId:string;workOrderId:string;employeeId:string;workCenterId:string;start:string;end?:string;minutes:number;
  /** Wage per hour frozen when the interval started; `kind` = setup when the operator marked it as setup time. */
  hourlyRate?:number;kind?:'setup'|'run'}
export type DowntimeReason='Setup / changeover'|'Unplanned stop'|'Maintenance'|'Material wait'|'Quality hold'
export interface DowntimeEvent{id:string;equipmentId:string;workCenterId:string;reason:DowntimeReason;start:string;end?:string;minutes:number;note:string;sourceId?:string}
export interface LotRecord{id:string;code:string;kind:'lot'|'serial';itemId:string;itemType:'raw'|'finished';qty:number;originalQty?:number;warehouseId:string;status?:'available'|'quarantine'|'hold'|'rework';sourceType:'purchase'|'production'|'return'|'adjustment';sourceId:string;sourceCode:string;createdAt:string;expiry?:string;serialFrom?:string;serialTo?:string;consumedBy:string[]}
export interface Forecast{id:string;productId:string;period:string;qty:number}
export interface CustomerReturn{id:string;code:string;salesOrderId:string;customerId:string;productId:string;qty:number;reason:string;status:'Qabul qilindi'|'Inspection'|'Omborga qaytarildi'|'Rework'|'Scrap';createdAt:string;qualityCheckId?:string;reworkOrderId?:string;lot?:string;
  /** Set on returns received into quarantine when they were registered: the receiving warehouse and the shipped lots they came back from. */
  warehouseId?:string;allocations?:{lot?:string;qty:number}[]}
export interface Attachment{id:string;entityType:string;entityId:string;name:string;size:number;mime:string;addedBy:string;addedAt:string;dataUrl?:string}

export interface NotificationItem{id:string;type:string;title:string;text:string;severity:'info'|'warning'|'danger'|'success';read:boolean;date:string;path?:string;
  /** Employees who have read it; `read` stays true only for items read before per-user reading existed (A-M5). */
  readBy?:string[]}
export interface ActivityItem{id:string;date:string;user:string;
  /** Employee id of the actor (A-M2); absent on entries written before it was recorded and on system entries. */
  userId?:string;action:string;module:string;source?:string;severity:'info'|'warning'|'danger'|'success';detail?:string}
export interface ManufacturingState{
  settings:SettingsState;branches:Branch[];warehouses:Warehouse[];productionLines:ProductionLine[];workCenters:WorkCenter[];products:Product[];rawMaterials:RawMaterial[];boms:Bom[];stockBalances:StockBalance[];stockMovements:StockMovement[];productionOrders:ProductionOrder[];suppliers:Supplier[];supplierMaterials:SupplierMaterial[];purchaseOrders:PurchaseOrder[];customers:Customer[];salesOrders:SalesOrder[];qualityChecks:QualityCheck[];qualityAlerts:QualityAlert[];equipment:Equipment[];maintenanceOrders:MaintenanceOrder[];employees:Employee[];roles:Role[];expenses:Expense[];engineeringChanges:EngineeringChange[];qualityControlPoints:QualityControlPoint[];maintenanceRequests:MaintenanceRequest[];subcontractOrders:SubcontractOrder[];repairOrders:RepairOrder[];notifications:NotificationItem[];activity:ActivityItem[];currentEmployeeId:string;
  timeLogs:TimeLog[];downtimeEvents:DowntimeEvent[];lots:LotRecord[];forecasts:Forecast[];returns:CustomerReturn[];attachments:Attachment[];
  /** Data model version written by `migrateState` (src/domain/migrations.ts); absent on data saved before versioning. */
  schemaVersion?:number;
}
export interface SearchRecord{type:string;title:string;subtitle:string;path:string;view?:string}
