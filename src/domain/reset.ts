// Clean data state: master data without any transaction history.
// Used for the first run, for Tizim → "Tranzaksiyalarni tozalash" and for the one-time cleanup of a
// browser that still holds the old generated demo history. Pure — callers decide when to commit.
import type {ManufacturingState} from '../types'
import {rollUpStandardCosts} from './manufacturingEngine'
import {addDays,isoDate} from '../utils/dates'

/** Collections that only hold transactions, documents of a workflow or records derived from them. */
export const TRANSACTION_KEYS=[
  'productionOrders','stockBalances','stockMovements','lots','timeLogs','purchaseOrders','subcontractOrders','salesOrders','returns',
  'qualityChecks','qualityAlerts','maintenanceOrders','maintenanceRequests','repairOrders','downtimeEvents','expenses',
  'engineeringChanges','forecasts','notifications','activity','receivables','supplierReplacements','receivableReconciliations',
] as const satisfies readonly (keyof ManufacturingState)[]

/** Master collections; their records survive a reset (attachments survive only on master records). */
const MASTER_KEYS=['branches','warehouses','productionLines','workCenters','products','rawMaterials','boms','suppliers','supplierMaterials','customers','equipment','employees','qualityControlPoints'] as const satisfies readonly (keyof ManufacturingState)[]
const MASTER_ATTACHMENTS:Record<string,keyof ManufacturingState>={product:'products',bom:'boms',material:'rawMaterials',supplier:'suppliers',customer:'customers',equipment:'equipment'}

/**
 * Ids produced by the demo-history generator (`prefix-N`, see the former createSeedState replay).
 * Static master ids have no dash (`p1`) and ids created in the app are `prefix-<time36>-<random>`.
 */
export const isGeneratedDemoId=(id:unknown)=>typeof id==='string'&&/^[a-z]+-\d+$/.test(id)

/** True when every transaction and every non-static record was produced by the demo generator. */
export function holdsOnlyDemoRecords(s:Partial<ManufacturingState>){
  const rows=(key:keyof ManufacturingState)=>Array.isArray(s[key])?s[key] as unknown as {id?:unknown}[]:[]
  const transactions=[...TRANSACTION_KEYS,'attachments' as const].every(key=>rows(key).every(r=>isGeneratedDemoId(r.id)))
  const masters=MASTER_KEYS.every(key=>rows(key).every(r=>typeof r.id==='string'&&(!r.id.includes('-')||isGeneratedDemoId(r.id))))
  return transactions&&masters
}

/**
 * Removes every transaction (orders, stock, lots, purchasing, sales, QC, maintenance, downtime,
 * costs, ECOs, forecasts, notifications, activity) and every record the demo generator created,
 * keeps master data, settings, roles and the signed-in employee, and resets master fields that only
 * summarise the removed history. Stock starts at zero; reorder signals then follow the master rules.
 */
export function clearTransactions(s:ManufacturingState,now=new Date()):ManufacturingState{
  const today=isoDate(now)
  const keep=<T extends {id:string}>(rows:T[])=>rows.filter(r=>!isGeneratedDemoId(r.id))
  let next={...s} as ManufacturingState
  for(const key of TRANSACTION_KEYS)(next as unknown as Record<string,unknown[]>)[key]=[]
  for(const key of MASTER_KEYS)(next as unknown as Record<string,{id:string}[]>)[key]=keep(s[key] as {id:string}[])

  // A demo BOM revision that was active is gone: the latest remaining revision of that product takes over.
  const boms=next.boms
  next.boms=boms.map(b=>{
    if(b.status!=='Arxiv'||boms.some(x=>x.productId===b.productId&&x.status==='Faol'))return b
    const latest=boms.filter(x=>x.productId===b.productId&&x.status==='Arxiv').sort((x,y)=>y.revision-x.revision)[0]
    if(latest.id!==b.id)return b
    const {archivedAt:_a,...active}=b
    return {...active,status:'Faol' as const}
  })
  next.boms=next.boms.map(b=>b.previousBomId&&!next.boms.some(x=>x.id===b.previousBomId)?{...b,previousBomId:undefined}:b)
  // Engineering changes are transactions: a revision does not keep pointing at a removed one.
  next.boms=next.boms.map(b=>{if(!b.ecoId)return b;const {ecoId:_e,...rest}=b;return rest})
  next.products=next.products.map(p=>p.defaultBomId&&!next.boms.some(b=>b.id===p.defaultBomId&&b.status==='Faol')
    ?{...p,defaultBomId:next.boms.find(b=>b.productId===p.id&&b.status==='Faol')?.id??''}:p)

  // Fields that summarise the removed history: last purchase, open balances, machine statistics.
  next.supplierMaterials=next.supplierMaterials.map(({lastPrice:_p,lastPurchaseDate:_d,lastPurchaseOrderId:_o,...link})=>link)
  next.suppliers=next.suppliers.map(x=>({...x,debt:0}))
  next.customers=next.customers.map(x=>({...x,debt:0}))
  // No service history remains: the first service is planned one interval from today.
  next.equipment=next.equipment.map(e=>({...e,status:'Ishlamoqda' as const,lastMaintenance:'',nextMaintenance:addDays(today,e.maintenanceIntervalDays||30),mtbf:0,mttr:0,downtime:0,maintenanceCost:0}))
  next.equipment=next.equipment.map(e=>e.nextMaintenance<=addDays(today,3)?{...e,status:'Servis yaqin' as const}:e)

  const masterExists=(type:string,id:string)=>{const key=MASTER_ATTACHMENTS[type];return Boolean(key)&&(next[key] as unknown as {id:string}[]).some(r=>r.id===id)}
  next.attachments=s.attachments.filter(a=>!isGeneratedDemoId(a.id)&&masterExists(a.entityType,a.entityId))
  if(!next.employees.some(e=>e.id===next.currentEmployeeId))next.currentEmployeeId=next.employees[0]?.id??''

  next=rollUpStandardCosts(next)
  return next
}
