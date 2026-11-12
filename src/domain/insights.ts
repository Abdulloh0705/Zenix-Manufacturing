// Rule-based manufacturing copilot. Every statement is derived from the current engine state,
// so the AI drawer and the AI workspace always agree with the rest of the product.
import type {ManufacturingState} from '../types'
import {calculateCapacityLoads,deliveryRisk,isOpenOrder,orderCosting,productionOee,stockOf,workCenterOee} from './manufacturingEngine'
import {branchPurchaseNeeds} from './planning'
import {todayISO,addDays} from '../utils/dates'

export type Insight={id:string;tone:'danger'|'warning'|'info'|'success';title:string;text:string;path:string;action:string}
/** Whether the asking user may see a module's data; the AI never reveals what the role cannot open (A-M1). */
export type ModuleGate=(module:string)=>boolean
const everything:ModuleGate=()=>true
const CLOSED='Bu ma’lumot sizning rolingiz uchun yopiq.'

export function buildInsights(s:ManufacturingState,allow:ModuleGate=everything):Insight[]{
  const out:Insight[]=[]
  const plan=branchPurchaseNeeds(s)
  for(const p of plan.filter(p=>p.shortage>0).slice(0,3)){
    const m=s.rawMaterials.find(x=>x.id===p.materialId)
    out.push({id:`buy-${p.branchId}-${p.materialId}`,tone:'warning',title:`${m?.name} · ${p.branchId} yetishmaydi`,text:`Rejali talab ${Math.round(p.required)} ${m?.unit}, available ${Math.round(p.available)} + yo‘lda ${Math.round(p.incoming)}. Tavsiya: ${p.suggested} ${m?.unit} xarid.`,path:'/materials?view=shortages',action:'Material'})
  }
  for(const o of s.productionOrders.filter(o=>deliveryRisk(s,o)).slice(0,3)){
    out.push({id:`risk-${o.id}`,tone:'danger',title:`${o.code} muddat riski`,text:`${s.products.find(p=>p.id===o.productId)?.name}: ${o.status}, due ${o.due}. ${o.status==='Material kutilmoqda'?'Material kutilmoqda.':'Qolgan ish hajmi smena sig‘imidan katta.'}`,path:`/production?view=orders&id=${o.id}`,action:'Buyurtmani ochish'})
  }
  for(const c of calculateCapacityLoads(s).filter(c=>c.overloaded).slice(0,2)){
    const day=c.days.find(d=>d.utilization>100)
    out.push({id:`cap-${c.workCenter.id}`,tone:'warning',title:`${c.workCenter.name} overload`,text:`${day?.date}: yuklama ${day?.utilization}% (${day?.load}/${day?.capacity} min). MOlarni qayta rejalashtiring.`,path:'/production?view=planning&mode=Capacity',action:'Capacity'})
  }
  for(const e of s.equipment.filter(e=>e.status!=='Ishlamoqda')){
    out.push({id:`eq-${e.id}`,tone:e.status==='To‘xtagan'?'danger':'info',title:e.status==='To‘xtagan'?`${e.name} to‘xtagan`:`${e.name}: servis yaqin`,text:`Keyingi servis ${e.nextMaintenance}. MTBF ${e.mtbf} soat, MTTR ${e.mttr} soat.`,path:`/equipment?view=equipment&id=${e.id}`,action:'Uskuna'})
  }
  for(const a of s.qualityAlerts.filter(a=>a.status!=='Yopilgan').slice(0,2)){
    out.push({id:`qa-${a.id}`,tone:'danger',title:a.title,text:a.reason,path:`/quality?view=alerts&id=${a.id}`,action:'CAPA'})
  }
  const eco=s.engineeringChanges.find(e=>['Review','Approved'].includes(e.status))
  if(eco)out.push({id:`eco-${eco.id}`,tone:'info',title:`${eco.code} — ${eco.status}`,text:`${eco.title}: ${eco.fromVersion} → ${eco.toVersion}.`,path:`/products?view=plm&id=${eco.id}`,action:'ECO'})
  // Each insight links into its module: a role sees only insights of modules it may open.
  return out.filter(i=>allow(i.path.split('?')[0].replace(/^\//,'')))
}

export function answerQuestion(s:ManufacturingState,question:string,allow:ModuleGate=everything){
  const t=question.toLowerCase()
  const plan=branchPurchaseNeeds(s)
  if(/material|xomash|tugay|shortage|xarid/.test(t)){
    if(!allow('materials'))return CLOSED
    const short=plan.filter(p=>p.shortage>0)
    if(!short.length){
      return 'Filiallar bo‘yicha rejalashtirilgan material yetishmovchiligi yo‘q.'
    }
    return short.map(p=>{const m=s.rawMaterials.find(x=>x.id===p.materialId);return `${m?.name} (${p.branchId}): talab ${Math.round(p.required)} ${m?.unit}, available ${Math.round(p.available)}, yo‘lda ${Math.round(p.incoming)} → ${p.suggested} ${m?.unit} xarid qiling`}).join(' · ')+'. Xaridni Xomashyo → Yetishmovchiliklar’dan yarating.'
  }
  if(/delay|kech|muddat|risk/.test(t)){
    if(!allow('production'))return CLOSED
    const risky=s.productionOrders.filter(o=>deliveryRisk(s,o))
    return risky.length?`${risky.map(o=>`${o.code} (${o.status}, due ${o.due})`).join(', ')} muddat bo‘yicha riskda. Avval material availability va work center capacity’ni tekshiring.`:'Hozir muddat riski aniqlanmadi — ochiq MOlar capacity ichida.'
  }
  if(/oee|samarador|line|liniya|sekin/.test(t)){
    if(!allow('production')&&!allow('equipment'))return CLOSED
    const rows=s.workCenters.map(w=>({w,o:workCenterOee(s,w.id)})).filter(r=>r.o.plannedMinutes>0).sort((a,b)=>a.o.oee-b.o.oee)
    const overall=productionOee(s)
    if(!rows.length)return 'OEE uchun oxirgi 7 kunda qayd etilgan ish vaqti yo‘q.'
    const worst=rows[0]
    return `Umumiy OEE ${overall.oee}% (A ${overall.availability}% · P ${overall.performance}% · Q ${overall.quality}%). Eng past: ${worst.w.name} — ${worst.o.oee}% (downtime ${worst.o.downtimeMinutes} min).`
  }
  if(/maintenance|servis|uskuna|ta’mir/.test(t)){
    if(!allow('equipment'))return CLOSED
    const soon=s.equipment.filter(e=>e.nextMaintenance<=addDays(todayISO(),7)||e.status!=='Ishlamoqda')
    return soon.length?soon.map(e=>`${e.name}: ${e.status}, keyingi servis ${e.nextMaintenance}`).join(' · '):'7 kun ichida maintenance talab qiladigan uskuna yo‘q.'
  }
  if(/eco|plm|bom|revision/.test(t)){
    if(!allow('products'))return CLOSED
    const open=s.engineeringChanges.filter(e=>['Draft','Review','Approved'].includes(e.status))
    return open.length?open.map(e=>`${e.code} — ${e.status} (${e.fromVersion} → ${e.toVersion})`).join(' · '):'Ochiq ECO yo‘q.'
  }
  if(/foyda|profit|margin|tannarx|cost/.test(t)){
    // Margins and cost variances are financial data (A-M1 / N-18).
    if(!allow('costs'))return CLOSED
    const done=s.productionOrders.filter(o=>o.status==='Yakunlangan').map(o=>({o,c:orderCosting(s,o)}))
    // Products without a sale price have no margin to compare (N-25: no division by zero).
    const margin=(p:{salePrice:number;standardCost:number})=>(p.salePrice-p.standardCost)/p.salePrice
    const best=[...s.products].filter(p=>p.type==='finished'&&p.salePrice>0).sort((a,b)=>margin(b)-margin(a))[0]
    const worst=done.sort((a,b)=>b.c.variancePct-a.c.variancePct)[0]
    return `${best?`Unit margin bo‘yicha eng foydali: ${best.name} (${Math.round((1-best.standardCost/best.salePrice)*100)}%).`:''}${worst?` Eng katta cost variance: ${worst.o.code} (${worst.c.variancePct>0?'+':''}${worst.c.variancePct}%).`:''}`
  }
  if(/waste|scrap|brak|sifat|quality/.test(t)){
    if(!allow('quality')&&!allow('production'))return CLOSED
    const done=s.productionOrders.filter(o=>o.completed+o.scrap>0)
    const scrap=done.reduce((a,o)=>a+o.scrap,0),total=done.reduce((a,o)=>a+o.completed+o.scrap,0)
    return `Scrap darajasi ${total?(scrap/total*100).toFixed(1):0}% (${scrap}/${total}). Ochiq quality alert: ${s.qualityAlerts.filter(a=>a.status!=='Yopilgan').length} ta. Asosiy sabablar: ${[...new Set(s.qualityAlerts.map(a=>a.reason))].slice(0,2).join('; ')||'—'}.`
  }
  const stockout=s.rawMaterials.filter(m=>{const st=stockOf(s,m.id);return st.available<m.reorderPoint}).length
  return `Hozir ${s.productionOrders.filter(o=>o.status==='Jarayonda').length} ta MO jarayonda, ${s.productionOrders.filter(o=>isOpenOrder(o)).length} ta ochiq, ${stockout} ta material reorder darajasidan past, ${s.qualityAlerts.filter(a=>a.status!=='Yopilgan').length} ta ochiq quality alert. Savolni aniqlashtiring: material, muddat, OEE, maintenance, ECO, tannarx yoki scrap.`
}

export const SUGGESTED_QUESTIONS=['Qaysi material tugayapti?','Qaysi buyurtma kechikadi?','OEE qaysi liniyada past?','Maintenance kerakmi?','Qaysi mahsulot foydali?','Scrap nega oshdi?']
