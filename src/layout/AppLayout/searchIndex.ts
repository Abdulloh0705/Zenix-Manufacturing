import type {ManufacturingState} from '../../types'

export type SearchResult={type:string;title:string;subtitle:string;path:string;icon:string}

/**
 * Every searchable record with the address that opens it: `?id=` opens the record's drawer/modal,
 * `?q=` filters the list to it where a record has no drawer (lots, serials, warehouses).
 * Only modules the person may open are indexed. Serials come from real serial lots only.
 */
export function buildSearchIndex(s:ManufacturingState,can:(m:string)=>boolean):SearchResult[]{
  const name=(id:string)=>s.products.find(p=>p.id===id)?.name||s.rawMaterials.find(m=>m.id===id)?.name||id
  const sourceCode=(type:string,id:string)=>type==='purchase'?s.purchaseOrders.find(p=>p.id===id)?.code:type==='production'?s.productionOrders.find(o=>o.id===id)?.code:type==='return'?s.returns.find(r=>r.id===id)?.code:type==='subcontract'?s.subcontractOrders.find(o=>o.id===id)?.code:undefined
  const rows:SearchResult[]=[]
  if(can('production'))rows.push(...s.productionOrders.map(o=>({type:'Ishlab chiqarish buyurtmasi',title:o.code,subtitle:`${name(o.productId)} · ${o.status}`,path:`/production?view=orders&id=${o.id}`,icon:'factory'})))
  if(can('products'))rows.push(...s.products.map(p=>({type:'Mahsulot',title:p.name,subtitle:p.sku,path:`/products?view=all&id=${p.id}`,icon:'box'})),...s.boms.map(b=>({type:'BOM',title:`${b.code} ${b.version}`,subtitle:`${name(b.productId)} · ${b.status}`,path:`/products?view=bom&id=${b.id}`,icon:'layers'})),...s.engineeringChanges.map(e=>({type:'ECO',title:e.code,subtitle:e.title,path:`/products?view=plm&id=${e.id}`,icon:'refresh'})))
  if(can('materials'))rows.push(...s.rawMaterials.map(m=>({type:'Xomashyo',title:m.name,subtitle:m.sku,path:`/materials?view=all&id=${m.id}`,icon:'layers'})))
  if(can('warehouse'))rows.push(...s.warehouses.map(w=>({type:'Ombor',title:w.name,subtitle:`${w.code} · ${w.type}`,path:`/warehouse?view=warehouses&q=${encodeURIComponent(w.code)}`,icon:'warehouse'})))
  if(can('warehouse')||can('reports'))rows.push(...s.lots.map(l=>({type:l.kind==='serial'?'Serial':'Lot',title:l.code,subtitle:`${name(l.itemId)} · ${l.sourceCode}`,path:`/reports?view=traceability&q=${encodeURIComponent(l.kind==='serial'?l.serialFrom||l.code:l.code)}`,icon:'barcode'})))
  if(can('purchases'))rows.push(...s.purchaseOrders.map(p=>({type:'Purchase Order',title:p.code,subtitle:`${s.suppliers.find(x=>x.id===p.supplierId)?.name} · ${p.status}`,path:`/purchases?view=orders&id=${p.id}`,icon:'cart'})),...s.suppliers.map(x=>({type:'Yetkazib beruvchi',title:x.name,subtitle:x.phone,path:`/purchases?view=suppliers&id=${x.id}`,icon:'truck'})))
  if(can('sales'))rows.push(...s.salesOrders.map(o=>({type:'Sales Order',title:o.code,subtitle:`${s.customers.find(c=>c.id===o.customerId)?.name} · ${o.status}`,path:`/sales?view=orders&id=${o.id}`,icon:'truck'})),...s.customers.map(c=>({type:'Mijoz',title:c.name,subtitle:c.phone,path:`/sales?view=customers&id=${c.id}`,icon:'users'})))
  if(can('quality'))rows.push(
    ...s.qualityChecks.map(c=>({type:'Sifat tekshiruvi',title:`${c.type} · ${sourceCode(c.sourceType,c.sourceId)||name(c.itemId)}`,subtitle:`${name(c.itemId)} · ${c.status}`,path:`/quality?view=checks&id=${c.id}`,icon:'shield'})),
    ...s.qualityAlerts.map(a=>({type:'Quality alert',title:a.title,subtitle:a.status,path:`/quality?view=alerts&id=${a.id}`,icon:'shield'})))
  if(can('equipment'))rows.push(...s.equipment.map(e=>({type:'Uskuna',title:e.name,subtitle:`${e.model} · ${e.serial}`,path:`/equipment?view=equipment&id=${e.id}`,icon:'wrench'})),...s.maintenanceOrders.map(m=>({type:'Maintenance',title:m.code,subtitle:`${s.equipment.find(e=>e.id===m.equipmentId)?.name} · ${m.status}`,path:`/equipment?view=maintenance&id=${m.id}`,icon:'wrench'})))
  if(can('employees'))rows.push(...s.employees.map(e=>({type:'Xodim',title:e.name,subtitle:e.department,path:`/employees?view=all&id=${e.id}`,icon:'user'})))
  return rows
}

/** All words must match (title, subtitle or type). Results stay grouped by type, at most `limit`. */
export function searchRecords(index:SearchResult[],query:string,limit=20){
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if(!terms.length)return []
  return index.filter(r=>{const t=`${r.title} ${r.subtitle} ${r.type}`.toLowerCase();return terms.every(x=>t.includes(x))}).slice(0,limit)
}
