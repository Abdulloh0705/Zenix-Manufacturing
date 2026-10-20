import type {AppearanceFamily,ThemeMode} from '../app/theme/themeRegistry'
import type {CurrencyCode} from '../utils/format'
export type {AppearanceFamily,ThemeMode,CurrencyCode}

export type StatusTone='success'|'warning'|'danger'|'info'|'neutral'|'purple'
export type PermissionAction='view'|'create'|'edit'|'delete'|'approve'|'export'|'execute'
export type PermissionMap=Record<string,Partial<Record<PermissionAction,boolean>>>
export type ProductionStatus='Qoralama'|'Tasdiqlangan'|'Material kutilmoqda'|'Jarayonda'|'Pauzada'|'Sifat nazoratida'|'Yakunlangan'|'Bekor qilingan'
export type ActionResult={ok:boolean;message:string;id?:string}

export interface SettingsState{
  theme:ThemeMode;appearance:AppearanceFamily;accent:string;currency:CurrencyCode;fontSize:'small'|'standard'|'large';reducedMotion:boolean;
  defaultBranchId:string;defaultWarehouseId:string;defaultLineId:string;language:'uz';
  notifications:{lowStock:boolean;quality:boolean;maintenance:boolean;delay:boolean;ai:boolean};
  ai:{enabled:boolean;credits:number};
  company:{name:string;currency:string;timezone:string;taxId:string};
  policies:{requireFinalQc:boolean;autoQualityChecks:boolean;overheadRate:number;machineRatePerHour:number;shiftMinutes:number;
    /** A PO worth at least `poDualApprovalFrom` (UZS) is approved by someone other than its author. */
    poDualApproval?:boolean;poDualApprovalFrom?:number};
}
export interface Branch{id:string;name:string;code:string;status:'Faol'|'Arxiv'}
export interface Warehouse{id:string;name:string;code:string;branchId:string;type:'Raw'|'WIP'|'Finished'|'Mixed';status:'Faol'|'Arxiv';locations:string[]}
export interface WorkCenter{id:string;name:string;code:string;branchId:string;lineId:string;capacity:number;efficiency:number;status:string;machineIds:string[];costPerHour:number}
export interface ProductionLine{id:string;name:string;code:string;branchId:string;shift:string;capacity:number;utilization:number;status:string}
export interface ProductVariant{id:string;code:string;attributes:string;priceDelta:number;status:'Faol'|'Arxiv'}
export interface Product{id:string;name:string;sku:string;category:string;unit:string;status:string;type:'finished'|'semi';salePrice:number;standardCost:number;leadTime:number;defaultBomId:string;tracking:'none'|'lot'|'serial';procurement:'make'|'buy';variants:ProductVariant[];image?:string;createdAt:string}
export interface RawMaterial{id:string;name:string;sku:string;category:string;unit:string;status:string;standardCost:number;minStock:number;reorderPoint:number;supplierId:string;leadTime:number;lotTracking:boolean;expiryTracking:boolean}
export interface BomComponent{id:string;materialId:string;qty:number;unit:string;waste:number;subBomId?:string}
export interface BomOperation{id:string;name:string;workCenterId:string;setupMin:number;runMin:number;employeeCount:number;instructions:string;qualityCheck:boolean;dependsOn?:string[];worksheet?:string;barcodeStep?:boolean}
export interface Bom{id:string;code:string;productId:string;version:string;revision:number;status:'Faol'|'Draft'|'Arxiv';effectiveDate:string;waste:number;components:BomComponent[];operations:BomOperation[];byProducts?:{productId:string;qty:number;unit:string}[];notes:string;previousBomId?:string;createdAt?:string}
export interface StockBalance{id:string;warehouseId:string;itemId:string;itemType:'raw'|'finished';onHand:number;reserved:number;incoming:number;quarantine?:number;unit:string;lot?:string;expiry?:string}
export interface StockMovement{id:string;date:string;type:string;itemId:string;itemType:'raw'|'finished';warehouseId:string;qty:number;source:string;note:string;user:string;lot?:string}

export type WorkOrderStatus='Kutilmoqda'|'Tayyor'|'Jarayonda'|'Pauzada'|'Yakunlangan'
export interface WorkOrder{id:string;operationId:string;name:string;workCenterId:string;sequence:number;status:WorkOrderStatus;plannedMin:number;actualMin:number;startedAt?:string;lastStartAt?:string;completedAt?:string;dependsOn:string[]}
export interface MaterialConsumption{materialId:string;itemType:'raw'|'finished';qty:number;lot?:string;date:string}
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
}
export type ExtraIssue={materialId:string;qty:number;reason:string;by:string;at:string}
export type CostSnapshot={material:number;labor:number;machine:number;overhead:number;total:number}
export interface Supplier{id:string;name:string;phone:string;leadTime:number;rating:number;status:string;debt:number;email?:string}
/**
 * Supplier ↔ material sourcing terms (many-to-many, one row per pair). Prices are quoted per purchase
 * unit in the supplier's currency; `unitFactor` = material stock units in one purchase unit. Last purchase
 * fields are written by confirmed purchase orders (UZS per stock unit).
 */
export interface SupplierMaterial{id:string;supplierId:string;materialId:string;supplierSku:string;price:number;currency:CurrencyCode;purchaseUnit:string;unitFactor:number;moq:number;leadTime:number;active:boolean;lastPrice?:number;lastPurchaseDate?:string;lastPurchaseOrderId?:string;createdAt:string}
export interface PurchaseReceipt{id:string;date:string;materialId:string;qty:number;lot:string;warehouseId?:string;key?:string}
/** PO line: `qty`/`received` in material stock units, `price` in UZS per stock unit; supplier terms are kept for display. */
export interface PurchaseLine{materialId:string;qty:number;received:number;price:number;linkId?:string;purchaseUnit?:string;unitFactor?:number;currency?:CurrencyCode;unitPrice?:number}
export interface PurchaseOrder{id:string;code:string;supplierId:string;warehouseId:string;status:'Qoralama'|'Tasdiqlangan'|'Yo‘lda'|'Qisman qabul'|'Qabul qilindi'|'Bekor';items:PurchaseLine[];total:number;invoiceStatus:string;paymentStatus:string;expectedDate:string;createdAt:string;receipts:PurchaseReceipt[];receivedAt?:string;source?:string;productionOrderIds?:string[];
  /** Who created and who approved the PO (separation of duties, A-M6). */
  createdBy?:string;approvedBy?:string;
  /** Set when the not-received rest was closed instead of received (BUG-09). */
  closedShort?:{date:string;reason:string;open:string}}
export interface Customer{id:string;name:string;phone:string;type:string;status:string;debt:number;email?:string}
export interface SalesOrder{id:string;code:string;customerId:string;status:'Yangi'|'Tasdiqlangan'|'Ishlab chiqarishda'|'Tayyor'|'Yetkazildi'|'Bekor';mode:'Make-to-stock'|'Make-to-order';items:{productId:string;qty:number;price:number;delivered:number;reserved:number;warehouseId?:string;reservations?:{warehouseId:string;qty:number}[]}[];productionOrderId?:string;productionOrderIds?:string[];total:number;paymentStatus:string;deliveryDate:string;createdAt:string;deliveredAt?:string}
export interface QualityCheck{id:string;type:'Kirish'|'Jarayon'|'Final';sourceType:'purchase'|'production'|'return'|'subcontract';sourceId:string;itemId:string;status:'Pending'|'Passed'|'Failed'|'Rework'|'Hold'|'Scrap';inspectorId:string;date:string;reason?:string;correctiveAction?:string;controlPointId?:string;lot?:string;receiptId?:string;measured?:string;
  /** Quantity of this check's receipt already shipped back to the supplier (N-03). */
  returnedQty?:number}
export interface QualityAlert{id:string;title:string;sourceId:string;severity:'Past'|'O‘rta'|'Yuqori';status:'Ochiq'|'Jarayonda'|'Yopilgan';reason:string;ownerId:string;createdAt:string;rootCause?:string;correctiveAction?:string;preventiveAction?:string;resolution?:string}
export interface Equipment{id:string;name:string;model:string;serial:string;workCenterId:string;status:'Ishlamoqda'|'Servis yaqin'|'To‘xtagan';lastMaintenance:string;nextMaintenance:string;mtbf:number;mttr:number;downtime:number;maintenanceCost:number;maintenanceIntervalDays:number}
export interface MaintenanceOrder{id:string;code:string;equipmentId:string;type:'Preventive'|'Corrective'|'Emergency';status:'Rejada'|'Jarayonda'|'Yakunlangan'|'Bekor';scheduled:string;completed?:string;technicianId:string;cost:number;note:string;requestId?:string;startedAt?:string}
export interface Employee{id:string;name:string;roleId:string;department:string;workCenterId:string;shift:string;status:string;attendance:number;efficiency:number;hourlyCost:number}
export type SystemRoleKey='super_admin'|'admin'|'production_manager'|'operator'|'quality'|'maintenance'|'warehouse'|'supply_sales'
export interface Role{id:string;name:string;scope:'all'|'branch'|'warehouse'|'workcenter';permissions:PermissionMap;
  /** Set on the eight built-in roles; they cannot be deleted. */
  key?:SystemRoleKey;system?:boolean;description?:string;createdAt?:string}
export interface Expense{id:string;date:string;type:'Electricity'|'Labor'|'Machine'|'Maintenance'|'Transport'|'Overhead';sourceId:string;amount:number;note:string}

export interface EngineeringChange{id:string;code:string;title:string;productId:string;bomId:string;newBomId?:string;fromVersion:string;toVersion:string;status:'Draft'|'Review'|'Approved'|'Applied'|'Rejected';effectiveDate:string;ownerId:string;reason:string;changeSummary:string;documents:string[];createdAt:string;approvedBy?:string}
export interface QualityControlPoint{id:string;title:string;scope:'Incoming'|'In-process'|'Final';productId?:string;operationName?:string;frequency:'Every time'|'Random'|'Periodic'|'On demand';sampleRate:number;checkType:'Instructions'|'Measure'|'Pass-Fail'|'Photo';instructions:string;active:boolean}
export interface MaintenanceRequest{id:string;code:string;equipmentId:string;type:'Preventive'|'Corrective'|'Emergency';priority:'Normal'|'Yuqori'|'Kritik';status:'Yangi'|'Tasdiqlangan'|'Jarayonda'|'Yakunlangan';requestedBy:string;scheduled:string;reason:string;downtimeHours:number;startedAt?:string}
export interface SubcontractOrder{id:string;code:string;supplierId:string;productId:string;qty:number;status:'Draft'|'Material yuborildi'|'Ishlab chiqarishda'|'Qabul qilindi';materialIds:string[];expectedDate:string;cost:number;
  /** Where the receipt went and how much of it still waits for incoming QC (N-07). */
  warehouseId?:string;qcHeld?:number}
export interface RepairOrder{id:string;code:string;equipmentId:string;status:'Yangi'|'Diagnostika'|'Ta’mirda'|'Sinov'|'Yakunlangan';issue:string;technicianId:string;partsCost:number;laborHours:number;createdAt:string}

export interface TimeLog{id:string;orderId:string;workOrderId:string;employeeId:string;workCenterId:string;start:string;end?:string;minutes:number}
export type DowntimeReason='Setup / changeover'|'Unplanned stop'|'Maintenance'|'Material wait'|'Quality hold'
export interface DowntimeEvent{id:string;equipmentId:string;workCenterId:string;reason:DowntimeReason;start:string;end?:string;minutes:number;note:string;sourceId?:string}
export interface LotRecord{id:string;code:string;kind:'lot'|'serial';itemId:string;itemType:'raw'|'finished';qty:number;originalQty?:number;warehouseId:string;status?:'available'|'quarantine'|'hold'|'rework';sourceType:'purchase'|'production'|'return'|'adjustment';sourceId:string;sourceCode:string;createdAt:string;expiry?:string;serialFrom?:string;serialTo?:string;consumedBy:string[]}
export interface Forecast{id:string;productId:string;period:string;qty:number}
export interface CustomerReturn{id:string;code:string;salesOrderId:string;customerId:string;productId:string;qty:number;reason:string;status:'Qabul qilindi'|'Inspection'|'Omborga qaytarildi'|'Rework'|'Scrap';createdAt:string;qualityCheckId?:string;reworkOrderId?:string;lot?:string}
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
