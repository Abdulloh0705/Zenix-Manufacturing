import type {ManufacturingState as S} from '../types'
import {branchOf,notify} from './actions'
import type {Ctx} from './actions'
import {isOpenOrder,itemName,materialShortages} from './manufacturingEngine'
import {maintenanceDue} from './maintenance'
import {runMrp} from './planning'
import {addDays,isoDate} from '../utils/dates'

/*
 * State-driven notifications (audit #27). After every successful, durably saved command the app runs this scan over
 * the committed data: each condition that holds becomes one notification keyed by the event, so a re-run, a second
 * tab or a page reload never posts it twice, and a refused command (whose state is never committed) posts nothing.
 * Event-driven ones (QC rejection, completed MO, replacement, receipt exceptions) are posted by their commands.
 *
 * Event keys: delay:<MO>:<due> · maint:<equipment>:<due day> · shortage:<material>:<day> · po-late:<PO>:<expected>
 * · mrp:<day>:<suggestion keys>. A shortage / MRP digest is at most one per day while the condition lasts.
 */
export function scanNotifications(s:S,ctx:Ctx):S{
  const today=isoDate(ctx.now)
  let next=s
  // Production delayed: an open order past its due date (a new due date is a new event).
  for(const o of s.productionOrders){
    if(!isOpenOrder(o)||!o.due||o.due>=today)continue
    next=notify(next,ctx,'delay','Ishlab chiqarish kechikmoqda',`${o.code} · ${itemName(s,o.productId)}: muddat ${o.due} o‘tdi (${o.completed}/${o.quantity})`,'warning',`/production?view=orders&id=${o.id}`,{key:`delay:${o.id}:${o.due}`,branchId:branchOf(s,o.warehouseId)})
  }
  // Maintenance due / overdue by the machine's own plan (calendar or runtime readings).
  for(const e of s.equipment){
    const due=maintenanceDue(e,today)
    if(due.state!=='due'&&due.state!=='overdue')continue
    if(s.maintenanceOrders.some(m=>m.equipmentId===e.id&&m.type==='Preventive'&&(m.status==='Rejada'||m.status==='Jarayonda')))continue
    const branch=s.workCenters.find(w=>w.id===e.workCenterId)?.branchId
    next=notify(next,ctx,'maintenance',due.state==='overdue'?'Servis kechikdi':'Servis vaqti keldi',`${e.name}: ${due.reason}`,'warning',`/equipment?view=equipment&id=${e.id}`,{key:`maint:${e.id}:${e.nextMaintenance||''}:${e.runtimeAtService??''}`,branchId:branch})
  }
  // Material shortage by MRP netting (need + safety above available + incoming).
  for(const row of materialShortages(s)){
    if(!row.critical)continue
    next=notify(next,ctx,'low-stock','Material yetishmovchiligi',`${row.m.name}: yetishmaydi ${Math.round(row.shortage)} ${row.m.unit} · available ${Math.round(row.available)}`,'danger',`/materials?view=all&id=${row.m.id}`,{key:`shortage:${row.m.id}:${today}`})
  }
  // Receiving exception: a confirmed PO not fully received by its expected date.
  for(const po of s.purchaseOrders){
    if(!['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(po.status)||!po.expectedDate||po.expectedDate>=today)continue
    const open=po.items.reduce((a,i)=>a+Math.max(0,i.qty-i.received),0)
    if(open<=1e-9)continue
    const supplier=s.suppliers.find(x=>x.id===po.supplierId)?.name||'Supplier'
    next=notify(next,ctx,'purchase','Xarid kechikmoqda',`${po.code} (${supplier}): kutilgan sana ${po.expectedDate}, hali qabul qilinmagan qism bor`,'warning',`/purchases?view=orders&id=${po.id}`,{key:`po-late:${po.id}:${po.expectedDate}`,branchId:branchOf(s,po.warehouseId)})
  }
  // MRP recommendations to release now (computed netting, not AI): one digest per day and set of suggestions.
  const plan=runMrp(s,{today})
  const due=plan.suggestions.filter(x=>!x.existing&&!x.blocked&&x.releaseDate<=addDays(today,0))
  if(due.length){
    const keys=due.map(x=>x.key).sort().join('|')
    next=notify(next,ctx,'mrp','MRP tavsiyasi',`${due.length} ta buyurtma bugun ochilishi kerak: ${due.slice(0,3).map(x=>`${x.type==='buy'?'xarid':'ishlab chiqarish'} ${itemName(s,x.itemId)} ${x.qty}`).join(', ')}${due.length>3?' …':''}`,'info','/production?view=mrp',{key:`mrp:${today}:${hash(keys)}`})
  }
  return next
}

/** Short stable fingerprint of a text (FNV-1a). */
function hash(text:string){
  let h=0x811c9dc5
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)}
  return (h>>>0).toString(36)
}
