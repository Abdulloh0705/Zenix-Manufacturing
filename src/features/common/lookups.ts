import {useEffect,useState} from 'react'
import type {ManufacturingState} from '../../types'

type S=ManufacturingState
export const productName=(s:S,id?:string)=>s.products.find(p=>p.id===id)?.name||id||'—'
export const materialName=(s:S,id?:string)=>s.rawMaterials.find(m=>m.id===id)?.name||s.products.find(p=>p.id===id)?.name||id||'—'
export const itemSku=(s:S,id?:string)=>s.rawMaterials.find(m=>m.id===id)?.sku||s.products.find(p=>p.id===id)?.sku||''
export const itemUnitOf=(s:S,id?:string)=>s.rawMaterials.find(m=>m.id===id)?.unit||s.products.find(p=>p.id===id)?.unit||''
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
