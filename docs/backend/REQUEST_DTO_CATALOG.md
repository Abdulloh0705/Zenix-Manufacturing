# ZENIX request DTO source catalog

Status: source-frozen design input for API_CONTRACT.md and COMMAND_MAPPING.md. These are the exact existing frontend input aliases/enums that appear in the 102 mapped signatures. They are not permission or server-validation substitutes. The server must validate an allowlisted wire DTO, convert JSON decimal strings to exact decimals, reject server-owned fields, and preserve accepted user intent and domain errors. Source changes require parity review.

## CreateOrderPayload

Source: actions.ts:673.

    export type CreateOrderPayload={productId:string;quantity:number;bomId?:string;lineId?:string;warehouseId?:string;workCenterId?:string;responsibleId?:string;start?:string;due?:string;priority?:ProductionOrder['priority'];salesOrderId?:string;source?:string;reworkOf?:string;variantId?:string;outputLocation?:string}

## OperationReportOptions

Source: actions.ts:1316.

    export type OperationReportOptions={reason?:string;
      /** Why more units than reached the operation are reported (min. 3 characters); without it the excess is refused. */
      override?:string;key?:string}

## RescheduleOptions

Source: actions.ts:4563.

    export type RescheduleOptions={override?:boolean;reason?:string}

## ConfirmSuggestionOptions

Source: actions.ts:4589.

    export type ConfirmSuggestionOptions={supplierId?:string;bucket?:'week'|'day';horizonWeeks?:number;horizonDays?:number}

## PurchaseLineInput

Source: actions.ts:1931.

    export type PurchaseLineInput={materialId:string;qty:number;price?:number}

## PurchasePayload

Source: actions.ts:1970.

    export type PurchasePayload={supplierId:string;lines?:PurchaseLineInput[];materialId?:string;qty?:number;price?:number;warehouseId?:string;expectedDate?:string;status?:'Qoralama'|'Tasdiqlangan';source?:string;productionOrderIds?:string[];allowBelowMoq?:boolean}

## ReceiveOptions

Source: actions.ts:2171.

    export type ReceiveOptions={warehouseId?:string;key?:string;
      /** The supplier's own lot number (kept beside the internal lot) and the storage location inside the warehouse. */
      supplierLot?:string;location?:string;
      /** Unit the quantity was typed in (default: the material's stock unit); converted through uom.ts (audit #24). */
      unit?:string;
      /** Serial numbers of the received units (serial-tracked material): exactly one per unit, never generated (audit #25). */
      serials?:string[]|string}

## LinkInput

Source: supplierMaterials.ts:208.

    export type LinkInput=Omit<SupplierMaterial,'id'|'createdAt'|'lastPrice'|'lastPurchaseDate'|'lastPurchaseOrderId'>

## SalesPayload

Source: actions.ts:2604.

    export type SalesPayload={customerId:string;lines?:{productId:string;qty:number;price?:number;variantId?:string}[];productId?:string;qty?:number;mode:SalesOrder['mode'];deliveryDate?:string;branchId?:string}

## CustomerPaymentInput

Source: actions.ts:2808.

    export type CustomerPaymentInput={customerId:string;amount:number|string;key:string;salesOrderId?:string;method?:string;note?:string}

## ReceivableAdjustmentInput

Source: actions.ts:2859.

    export type ReceivableAdjustmentInput={customerId:string;amount:number|string;reason:string;key:string}

## LotPin

Source: types/index.ts:115.

    export interface LotPin{lot:string;qty:number}

## AdjustOptions

Source: actions.ts:3258.

    export type AdjustOptions={
      /** Location the difference is in ('' = unassigned only); without it, an increase lands unassigned and a decrease follows the lots. */
      location?:string;
      /** Lots a decrease of a lot-tracked item writes off; FEFO over unreserved lots when not given. */
      lots?:LotPin[];
      /** Unit the difference was typed in (audit #24). */
      unit?:string;
      /** Form submit key: the same adjustment posted twice is refused, never deducted twice. */
      key?:string}

## MaintenanceInput

Source: actions.ts:3526.

    export type MaintenanceInput={equipmentId:string;type:S['maintenanceOrders'][number]['type'];scheduled:string;plannedHours?:number;technicianId?:string;note?:string;
      /** Plan it although another service of the same machine overlaps (both stay; the reason is recorded). */
      override?:string}

## RoleInput

Source: actions.ts:4478.

    export type RoleInput={name:string;description?:string;scope?:Role['scope'];rank?:number}

## ProductionStatus

Source: types/index.ts:8.

    export type ProductionStatus='Qoralama'|'Tasdiqlangan'|'Material kutilmoqda'|'Jarayonda'|'Pauzada'|'Sifat nazoratida'|'Yakunlangan'|'Bekor qilingan'

## DowntimeReason

Source: types/index.ts:261.

    export type DowntimeReason='Setup / changeover'|'Unplanned stop'|'Maintenance'|'Material wait'|'Quality hold'

## PermissionAction

Source: types/index.ts:6.

    export type PermissionAction='view'|'create'|'edit'|'delete'|'approve'|'export'|'execute'

## Wire conversion and validation rules

| Frontend input | API wire rule |
| --- | --- |
| number quantity, price, money, rate | decimal string with bounded scale; reject NaN, infinity, exponent outside policy and excess precision; convert before domain validation |
| optional field | absence means use documented server default; null is distinct and accepted only when explicitly declared |
| ID, code, SKU, LOT, serial | normalized for lookup only after selected-tenant scope; preserve display/code value where current rule requires |
| date and clock | ISO date/instant; business date evaluated in tenant timezone; old ambiguous import time stays tagged |
| key in old action payload | bridged to Idempotency-Key header and preserved as source key where existing ledger expects it |
| state, Ctx, by, approvedBy, tenantId, status derived from payment | always server-derived; client value ignored or rejected |
| Attachment.dataUrl | adapter uploads bytes through scoped upload intent; server command receives verified attachment ID/metadata, with same visible add/remove outcome |

Nested domain entities referenced by these aliases, such as Bom, ProductionOrder, QualityCheck, Attachment, SupplierMaterial and Role, are defined in ../../src/types/index.ts. A command accepts only its edit-safe fields and versions; it cannot submit a whole trusted entity graph. Current enum labels, output messages, accepted defaults and validation cases are frozen by source tests until an approved API-version change.
