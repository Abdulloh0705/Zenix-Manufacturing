import {useEffect,useState} from 'react'
import type {ManufacturingState} from '../../types'
import {splitKey} from '../../domain/inventory'

type S=ManufacturingState
const base=(id?:string)=>id?splitKey(id).itemId:id
export const productName=(s:S,id?:string)=>s.products.find(p=>p.id===id)?.name||id||'—'
export const materialName=(s:S,id?:string)=>s.rawMaterials.find(m=>m.id===id)?.name||s.products.find(p=>p.id===id)?.name||id||'—'
/** SKU of an item, or of a variant for a stock key (productId~variantId). */
export const itemSku=(s:S,id?:string)=>{const k=id?splitKey(id):undefined;const p=s.products.find(x=>x.id===k?.itemId);return (k?.variantId&&p?.variants.find(v=>v.id===k.variantId)?.code)||s.rawMaterials.find(m=>m.id===base(id))?.sku||p?.sku||''}
export const itemUnitOf=(s:S,id?:string)=>s.rawMaterials.find(m=>m.id===base(id))?.unit||s.products.find(p=>p.id===base(id))?.unit||''
export const employeeName=(s:S,id?:string)=>s.employees.find(e=>e.id===id)?.name||'—'
export const warehouseName=(s:S,id?:string)=>s.warehouses.find(w=>w.id===id)?.name||'—'
export const workCenterName=(s:S,id?:string)=>s.workCenters.find(w=>w.id===id)?.name||'—'
export const workCenterCode=(s:S,id?:string)=>s.workCenters.find(w=>w.id===id)?.code||'—'
export const supplierName=(s:S,id?:string)=>s.suppliers.find(x=>x.id===id)?.name||'—'
export const customerName=(s:S,id?:string)=>s.customers.find(x=>x.id===id)?.name||'—'
export const lineName=(s:S,id?:string)=>s.productionLines.find(l=>l.id===id)?.name||'—'
export const equipmentName=(s:S,id?:string)=>s.equipment.find(e=>e.id===id)?.name||'—'
export const orderCode=(s:S,id?:string)=>s.productionOrders.find(o=>o.id===id)?.code||'—'

/** Re-renders every `intervalMs` so live timers (running operations, relative times) stay current. */
export function useNow(intervalMs=30000){
  const [now,setNow]=useState(()=>new Date())
  useEffect(()=>{const t=window.setInterval(()=>setNow(new Date()),intervalMs);return()=>window.clearInterval(t)},[intervalMs])
  return now
}
