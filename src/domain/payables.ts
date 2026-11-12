import type {ManufacturingState,Supplier} from '../types'
import type {PurchaseOrder} from '../types'

type S=ManufacturingState
const money=(n:number)=>Math.round(n*100)/100
export const payableLedger=(s:Pick<S,'payables'>)=>s.payables||[]
export const supplierBalance=(s:Pick<S,'payables'>,supplierId:string)=>money(payableLedger(s).filter(e=>e.supplierId===supplierId).reduce((n,e)=>n+e.amount,0))
export const purchaseBalance=(s:Pick<S,'payables'>,purchaseOrderId:string)=>money(payableLedger(s).filter(e=>e.purchaseOrderId===purchaseOrderId).reduce((n,e)=>n+e.amount,0))
export function purchasePaymentStatus(s:Pick<S,'payables'>,po:Pick<PurchaseOrder,'id'|'paymentStatus'>){
  const rows=payableLedger(s).filter(e=>e.purchaseOrderId===po.id)
  if(!rows.length)return po.paymentStatus
  return purchaseBalance(s,po.id)<=0.005?'To‘langan':rows.some(e=>e.kind==='payment')?'Qisman':'To‘lanmagan'
}
export function withSupplierDebts(s:S,supplierIds?:string[]):S{
  const ids=supplierIds?new Set(supplierIds):undefined
  return {...s,suppliers:s.suppliers.map(x=>!ids||ids.has(x.id)?{...x,debt:supplierBalance(s,x.id)}:x)}
}
/** Historical debt is preserved as an opening figure; old receipt/payment provenance is never guessed. */
export function payableOpenings(suppliers:Pick<Supplier,'id'|'debt'>[],date:string){
  return suppliers.filter(x=>Number.isFinite(x.debt)&&Math.abs(x.debt)>0.005).map((x,i)=>({id:`apopen-${i+1}`,key:`opening:${x.id}`,supplierId:x.id,kind:'opening' as const,amount:money(x.debt),date,by:'system',reason:'Ledgerdan oldingi supplier qarzi',currency:'UZS' as const}))
}
