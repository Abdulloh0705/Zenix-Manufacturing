// Context-aware help: what the signed-in person can do *here*, derived only from the existing access-control and
// workflow rules (commandBlocker, stockScope, homeOf, maintenance assignment, record status). Nothing in this file
// writes state; every answer is a read of the same checks the domain commands run when the user submits.
// Browser-side only: it explains the UI, it is not server authorization.
import {actionRules,commandBlocker,employeeBranchIds,homeOf,isSuperAdminRole,PERMISSION_ACTIONS,PERMISSION_MODULES,stockScope} from '../../domain/access'
import type {Rule} from '../../domain/access'
import type {Employee,MaintenanceOrder,ManufacturingState,PermissionAction,Role} from '../../types'
import {canUseGuide,HELP_GUIDES,HELP_TOPICS,requirementRules} from './helpContent'
import type {Can,HelpGuide} from './helpContent'

type S=ManufacturingState
/**
 * `state` is what the user sees (the scoped view); `can` is the role right plus the subscription entitlement;
 * `blocker` is the app's own domain gate on the full data (records outside the view keep their real names in reasons).
 * Without it (tests on full data) commandBlocker runs on `state`.
 */
export type HelpCtx={state:S;employee:Employee;role:Role;can:Can;company?:string;blocker?:(name:string,args:unknown[])=>string|null}
export type Check={ok:boolean;reason?:string}

const moduleLabel=(m:string)=>PERMISSION_MODULES.find(x=>x.key===m)?.label||m
const actionLabel=(a:PermissionAction)=>PERMISSION_ACTIONS.find(x=>x.key===a)?.label||a
export const ruleLabel=([m,a]:Rule)=>`${moduleLabel(m)}: ${actionLabel(a)}`
const OPEN_MAINTENANCE:MaintenanceOrder['status'][]=['Rejada','Jarayonda']
const activeWarehouses=(s:S)=>s.warehouses.filter(w=>w.status!=='Arxiv')
const warehouseName=(s:S,id:string)=>s.warehouses.find(w=>w.id===id)?.name||id

/** A domain command for this person and these arguments: the role/tariff right first, then the command's own blocker. */
export function actionCheck(ctx:HelpCtx,name:string,args:unknown[]):Check{
  const rules=actionRules(name,args)||[]
  if(!rules.some(([m,a])=>ctx.can(m,a)))return {ok:false,reason:`Rolingiz yoki tarifingizda “${rules.map(ruleLabel).join('” yoki “')}” ruxsati yo‘q`}
  const blocked=ctx.blocker?ctx.blocker(name,args):commandBlocker(ctx.state,ctx.employee,name,args)
  return blocked?{ok:false,reason:blocked}:{ok:true}
}

/* ------------------------------------------------------------------ where the person works -- */

export type WorkContext={company:string;scope:Role['scope'];branches:string[];allBranches:boolean;warehouses:string[];allWarehouses:boolean;workCenter?:string;assigned:MaintenanceOrder[];assignmentRule:boolean}
export function workContext(ctx:HelpCtx):WorkContext{
  const s=ctx.state,role=ctx.role
  const unrestricted=isSuperAdminRole(role)||!role.scope||role.scope==='all'
  const home=homeOf(s,ctx.employee)
  const scope=stockScope(s,ctx.employee)
  return {
    company:ctx.company||'',
    scope:role.scope,
    allBranches:unrestricted,
    branches:unrestricted?[]:employeeBranchIds(s,ctx.employee).map(id=>s.branches.find(b=>b.id===id)?.name||id),
    allWarehouses:scope===null,
    warehouses:scope===null?activeWarehouses(s).map(w=>w.name):[...scope].map(id=>warehouseName(s,id)),
    workCenter:home.workCenter?.name,
    // Only the Maintenance Engineer role is bound to its own orders (maintenancePartAssignmentBlocker).
    assignmentRule:role.key==='maintenance',
    assigned:s.maintenanceOrders.filter(m=>m.technicianId===ctx.employee.id&&OPEN_MAINTENANCE.includes(m.status)),
  }
}

/* --------------------------------------------------- role/capability explanations per area -- */

export type ContextNote={id:string;title:string;text:string;ok?:boolean;reason?:string}
const some=(ctx:HelpCtx,name:string,argsList:unknown[][]):Check=>{
  let first:Check={ok:false,reason:'Doirangizda mos yozuv yo‘q'}
  for(const args of argsList){const c=actionCheck(ctx,name,args);if(c.ok)return c;if(first.reason==='Doirangizda mos yozuv yo‘q')first=c}
  return first
}
const scopedWarehouseIds=(ctx:HelpCtx)=>{const scope=stockScope(ctx.state,ctx.employee);return scope?[...scope]:activeWarehouses(ctx.state).map(w=>w.id)}

/** Can this person dispatch a transfer anywhere? Every (own → other) pair is checked against the real blocker. */
export function transferCheck(ctx:HelpCtx):Check{
  const from=scopedWarehouseIds(ctx),all=activeWarehouses(ctx.state).map(w=>w.id)
  const pairs=from.flatMap(a=>all.filter(b=>b!==a).map(b=>[{from:a,to:b}]))
  if(!pairs.length)return actionCheck(ctx,'dispatchTransfer',[{}]).ok?{ok:false,reason:'Transfer uchun kamida ikkita faol ombor kerak'}:actionCheck(ctx,'dispatchTransfer',[{}])
  return some(ctx,'dispatchTransfer',pairs)
}

export function contextNotes(ctx:HelpCtx,module:string):ContextNote[]{
  const notes:ContextNote[]=[],s=ctx.state,wc=workContext(ctx)
  if(['warehouse','purchases','sales','materials'].includes(module)&&ctx.can('warehouse')){
    const receipt=actionCheck(ctx,'receivePurchase',[])
    const transfer=transferCheck(ctx)
    const issue=some(ctx,'issueMaintenancePart',s.maintenanceOrders.filter(m=>OPEN_MAINTENANCE.includes(m.status)).map(m=>[m.id,{}]))
    const delivery=actionCheck(ctx,'deliverSalesOrder',[])
    notes.push(
      {id:'wh-scope',title:'Ombor doirangiz',text:wc.allWarehouses?`Barcha omborlar (${wc.warehouses.length} ta): ${wc.warehouses.join(', ')}.`:wc.warehouses.length?`Siz faqat shu omborlarda ishlaysiz: ${wc.warehouses.join(', ')}. Boshqa ombor qoldig‘i ro‘yxatlarda ko‘rinmaydi va unda amal bajarilmaydi.`:'Sizga ombor yoki filial biriktirilmagan — administratorga murojaat qiling.',ok:wc.allWarehouses||wc.warehouses.length>0},
      {id:'wh-receive',title:'Qabul (kirim)',text:'Yetkazib beruvchidan kelgan tovar Xaridlar → Qabul qilish orqali PO ga bog‘lab omborga kiritiladi; qoldiq shu paytda oshadi.',...receipt},
      {id:'wh-issue',title:'Chiqim',text:'Ombordan sarf alohida hujjatlar bilan yoziladi: sotuv jo‘natmasi (Sotuv → Yetkazib berish), maintenance ehtiyot qismi (Ombor → Ehtiyot qism chiqimi) va ishlab chiqarish materiali (MO orqali). Karantindagi miqdor chiqarilmaydi; maintenance qismi faqat bo‘sh qoldiqdan beriladi, sotuv jo‘natmasida esa avval shu buyurtma rezervi ishlatiladi.',ok:delivery.ok||issue.ok,reason:delivery.ok||issue.ok?undefined:delivery.reason||issue.reason},
      {id:'wh-transfer',title:'Transfer',text:'Transfer qoldiqni bir ombordan boshqasiga ko‘chiradi: manbada “Yo‘lga chiqarish”, qabul omborida “Qabul qilish”. Umumiy qoldiq o‘zgarmaydi.',...transfer},
    )
  }
  if(module==='production'&&ctx.can('production')){
    const run=['execute','edit'].some(a=>ctx.can('production',a as PermissionAction))
    const forbidden=[!ctx.can('production','create')&&'MO yaratish',!ctx.can('production','edit')&&'MOni tahrirlash, rejalash, tasdiqlash va xodim biriktirish'].filter(Boolean)
    notes.push({id:'op-scope',title:wc.scope==='workcenter'?'Ish markazingiz':'Ish doirangiz',
      text:wc.scope==='workcenter'?(wc.workCenter?`Siz faqat ${wc.workCenter} ish markazidagi operatsiyalarni bajarasiz: START, SETUP TUGADI, NATIJA, SCRAP, YAKUNLASH va to‘xtashni qayd etish.`:'Rolingiz ish markaziga bog‘langan, lekin sizga ish markazi biriktirilmagan — administratorga murojaat qiling.'):wc.allBranches?'Barcha filiallar va ish markazlari.':`Filial: ${wc.branches.join(', ')||'biriktirilmagan'}.`,
      ok:run&&(wc.scope!=='workcenter'||Boolean(wc.workCenter)),reason:run?undefined:'Rolingizda “Ishlab chiqarish: Bajarish” yoki “Ishlab chiqarish: Tahrir” ruxsati yo‘q'})
    if(forbidden.length)notes.push({id:'op-limits',title:'Sizga yopiq',text:`${forbidden.join('; ')} — bu amallar rolingizda yo‘q, shuning uchun ular uchun ko‘rsatma berilmaydi.`,ok:false})
  }
  if(module==='quality'&&ctx.can('quality')){
    const decide=actionCheck(ctx,'resolveQuality',[]),verify=actionCheck(ctx,'verifyCapaAction',[]),rework=actionCheck(ctx,'createReworkOrder',[])
    notes.push(
      {id:'q-inspect',title:'Tekshiruv',text:'“Pending” tekshiruvga bir marta natija beriladi: Passed, Hold, Failed, Rework yoki Scrap. Passed’dan boshqa natijada sabab majburiy; qaror yakuniy — qayta tekshiruv uchun yangi tekshiruv yaratiladi.',...decide},
      {id:'q-quarantine',title:'Karantin va chiqarish',text:'Kirish tekshiruvida qabul qilingan qism zaxiraga o‘tadi, rad etilgan qism karantinda qoladi va supplierga qaytariladi yoki scrap qilinadi. Karantindagi miqdor available qoldiqqa kirmaydi.',ok:decide.ok,reason:decide.reason},
      {id:'q-rework',title:'Rework',text:'Rework MO nomuvofiq miqdorni qayta ishlashga yuboradi (Sifat → NCR → “Rework MO yaratish”).',...rework},
      {id:'q-capa',title:'CAPA tekshiruvi',text:'CAPA chorasini bajarilgan deb belgilash Sifat: Tahrir, natijani tasdiqlash (“Tekshirish”) esa Sifat: Tasdiqlash ruxsatini talab qiladi.',...verify},
    )
  }
  if((module==='equipment'||module==='warehouse')&&wc.assignmentRule){
    notes.push({id:'mt-assigned',title:'Sizga biriktirilgan ishlar',text:wc.assigned.length?`Ehtiyot qismni faqat sizga biriktirilgan ochiq ishlarga berasiz: ${wc.assigned.map(m=>m.code).join(', ')}.`:'Hozir sizga biriktirilgan ochiq (Rejada / Jarayonda) maintenance ishi yo‘q. Boshqa texnikning ishiga qism bera olmaysiz.',ok:wc.assigned.length>0,reason:wc.assigned.length?undefined:'Biriktirilgan ochiq ish yo‘q'})
  }
  return notes
}

/* --------------------------------------------- can the guide's action be done right now? -- */

export type ProbeState='ready'|'blocked'|'idle'
export type Probe={state:ProbeState;text:string}
const openMaintenance=(s:S)=>s.maintenanceOrders.filter(m=>OPEN_MAINTENANCE.includes(m.status))

/** Record-level availability for guides whose action depends on assignment, scope or open work; others are general. */
export function guideProbe(ctx:HelpCtx,guide:HelpGuide):Probe|undefined{
  const s=ctx.state,wc=workContext(ctx)
  switch(guide.id){
    case 'maintenance':case 'warehouse-maintenance':{
      const orders=guide.id==='maintenance'&&wc.assignmentRule?wc.assigned:openMaintenance(s)
      if(!orders.length)return {state:'idle',text:wc.assignmentRule?'Hozir sizga biriktirilgan ochiq maintenance ishi yo‘q — qism berish faqat o‘z ishingizda mumkin.':'Doirangizda ochiq (Rejada / Jarayonda) maintenance ishi yo‘q.'}
      const ok=orders.filter(m=>actionCheck(ctx,'issueMaintenancePart',[m.id,{}]).ok)
      if(!ok.length)return {state:'blocked',text:actionCheck(ctx,'issueMaintenancePart',[orders[0].id,{}]).reason||'Amal rad etiladi'}
      return {state:'ready',text:`${ok.length} ta ochiq ishga qism bera olasiz: ${ok.slice(0,4).map(m=>m.code).join(', ')}${ok.length>4?'…':''}. Ombor tanlanganda ombor doirasi yana tekshiriladi.`}
    }
    case 'transfer':{
      const c=transferCheck(ctx)
      const receive=(s.stockTransfers||[]).filter(t=>t.status==='Yo‘lda'||t.status==='Qisman qabul qilindi').filter(t=>actionCheck(ctx,'receiveTransfer',[t.id]).ok)
      if(c.ok)return {state:'ready',text:`Manba ombor: ${wc.warehouses.join(', ')}.${receive.length?` Qabul kutayotgan transfer: ${receive.length} ta.`:''}`}
      return {state:receive.length?'ready':'blocked',text:`Jo‘natish: ${c.reason}.${receive.length?` Sizga kelgan ${receive.length} ta transferni qabul qila olasiz.`:''}`}
    }
    case 'stock-count':{
      const ids=scopedWarehouseIds(ctx)
      const c=some(ctx,'createStockCount',ids.map(id=>[{warehouseId:id}]))
      return c.ok?{state:'ready',text:`Inventarizatsiya qila oladigan omborlar: ${ids.filter(id=>actionCheck(ctx,'createStockCount',[{warehouseId:id}]).ok).map(id=>warehouseName(s,id)).join(', ')}.`}:{state:'blocked',text:c.reason||'Amal rad etiladi'}
    }
    case 'shop-floor':{
      if(wc.scope==='workcenter'&&!wc.workCenter)return {state:'blocked',text:'Sizga ish markazi biriktirilmagan — operatsiyani boshlay olmaysiz.'}
      const live=s.productionOrders.filter(o=>['Tasdiqlangan','Jarayonda','Pauzada'].includes(o.status)).flatMap(o=>o.workOrders.filter(w=>!['Yakunlangan','Bekor qilingan'].includes(w.status)).map(w=>({o,w})))
      const mine=live.filter(({o,w})=>actionCheck(ctx,'startWorkOrder',[o.id,w.id]).ok)
      return mine.length?{state:'ready',text:`${wc.workCenter?`${wc.workCenter}: `:''}${mine.length} ta ochiq operatsiya.`}:{state:'idle',text:`${wc.workCenter?`${wc.workCenter}da `:''}hozir boshlash mumkin bo‘lgan ochiq operatsiya yo‘q.`}
    }
    case 'quality-check':{
      const pending=s.qualityChecks.filter(q=>q.status==='Pending'&&q.sourceType!=='return')
      const mine=pending.filter(q=>actionCheck(ctx,'resolveQuality',[q.id,'Passed']).ok)
      return mine.length?{state:'ready',text:`${mine.length} ta ochiq tekshiruv natija kutmoqda.`}:{state:'idle',text:'Doirangizda natija kutayotgan tekshiruv yo‘q.'}
    }
    case 'maintenance-run':{
      const orders=openMaintenance(s).filter(m=>actionCheck(ctx,m.status==='Rejada'?'startMaintenance':'completeMaintenance',[m.id]).ok)
      return orders.length?{state:'ready',text:`${orders.length} ta ochiq ish: ${orders.slice(0,4).map(m=>`${m.code} (${m.status})`).join(', ')}.`}:{state:'idle',text:'Doirangizda boshlanadigan yoki yakunlanadigan maintenance ishi yo‘q.'}
    }
    default:return undefined
  }
}

/** Guides of a page that this person may not run, with the exact missing right (no steps are shown for them). */
export function unavailableGuides(ctx:HelpCtx,topicId:string):Array<{guide:HelpGuide;reason:string}>{
  return HELP_GUIDES.filter(g=>g.topic===topicId&&!canUseGuide(g,ctx.can)).map(guide=>{
    const missing=guide.requirements.map(requirementRules).filter(rules=>!rules.some(([m,a])=>ctx.can(m,a)))
    return {guide,reason:missing.length?`Kerakli ruxsat: ${missing.map(rules=>rules.map(ruleLabel).join(' yoki ')).join(' va ')}`:'Bu sahifa sizga ochiq emas'}
  })
}

/* ------------------------------------------------------------ the record open on the page -- */

export type RecordAction={label:string;ok:boolean;reason?:string}
export type RecordHelp={kind:'maintenance'|'quality'|'production';title:string;status:string;facts:string[];actions:RecordAction[];next:string;links:Array<{label:string;to:string}>}
const act=(label:string,c:Check):RecordAction=>({label,ok:c.ok,reason:c.reason})
const gate=(label:string,allowed:boolean,why:string,c:()=>Check):RecordAction=>allowed?act(label,c()):{label,ok:false,reason:why}

/** The record behind ?id= / ?mo= on the pages where record-level context can be read reliably; otherwise undefined. */
export function recordContext(ctx:HelpCtx,pathname:string,search:string):RecordHelp|'missing'|undefined{
  const p=new URLSearchParams(search),view=p.get('view')||'',s=ctx.state,me=ctx.employee
  const maintenanceId=pathname==='/equipment'&&view==='maintenance'?p.get('id'):pathname==='/warehouse'&&view==='maintenance'?p.get('mo'):null
  if(maintenanceId){
    const m=s.maintenanceOrders.find(x=>x.id===maintenanceId)
    if(!m)return 'missing'
    const open=OPEN_MAINTENANCE.includes(m.status)
    const tech=s.employees.find(e=>e.id===m.technicianId)
    const links=[ctx.can('equipment')&&pathname!=='/equipment'?{label:'Uskunalar → Maintenance’da ochish',to:`/equipment?view=maintenance&id=${m.id}`}:null,ctx.can('warehouse')&&pathname!=='/warehouse'?{label:'Ombor → Ehtiyot qism chiqimida ochish',to:`/warehouse?view=maintenance&mo=${m.id}`}:null].filter((x):x is {label:string;to:string}=>Boolean(x))
    return {kind:'maintenance',title:m.code,status:m.status,
      facts:[`Texnik: ${tech?.name||'—'}${m.technicianId===me.id?' (siz)':''}`,`Uskuna: ${s.equipment.find(e=>e.id===m.equipmentId)?.name||'—'}`],
      actions:[
        gate('Qism berish',open,`Ish holati “${m.status}” — qism faqat Rejada yoki Jarayonda ishlarga beriladi`,()=>actionCheck(ctx,'issueMaintenancePart',[m.id,{}])),
        gate('Boshlash',m.status==='Rejada',`Faqat “Rejada” holatidagi ish boshlanadi (hozir “${m.status}”)`,()=>actionCheck(ctx,'startMaintenance',[m.id])),
        gate('Yakunlash',m.status==='Jarayonda',`Faqat “Jarayonda” holatidagi ish yakunlanadi (hozir “${m.status}”)`,()=>actionCheck(ctx,'completeMaintenance',[m.id])),
      ],
      next:m.status==='Rejada'?'Keyingi qadam: ishni “Boshlash” — uskuna to‘xtaydi, shu work center operatsiyalari pauzaga o‘tadi. Qismni oldindan ham berish mumkin.'
        :m.status==='Jarayonda'?'Keyingi qadam: kerakli qismni bering yoki ortiqchasini qaytaring, so‘ng xarajat va bajarilgan ishni kiritib “Yakunlash”.'
        :'Ish yopilgan: qism berish, qaytarish va xarajat kiritish endi mumkin emas.',
      links}
  }
  const checkId=pathname==='/quality'&&view==='checks'?p.get('id'):null
  if(checkId){
    const q=s.qualityChecks.find(x=>x.id===checkId)
    if(!q)return 'missing'
    const pending=q.status==='Pending'
    const viaReturn=q.sourceType==='return'
    const decide=gate('Natijani kiritish',pending&&!viaReturn,viaReturn?'Mijoz qaytarishi tekshiruvi Sotuv → Qaytarishlar bo‘limida qaror bilan yopiladi':`Qaror yakuniy (${q.status}) — qayta tekshiruv uchun yangi tekshiruv yarating`,()=>actionCheck(ctx,'resolveQuality',[q.id,'Passed']))
    const rejected=!pending&&q.sourceType==='purchase'&&['Failed','Hold','Rework'].includes(q.status)
    return {kind:'quality',title:`${q.type} tekshiruv`,status:q.status,
      facts:[`Manba: ${q.sourceType==='purchase'?'xarid qabuli':q.sourceType==='production'?'ishlab chiqarish':q.sourceType==='return'?'mijoz qaytarishi':'subcontract'}`,...(q.lot?[`LOT: ${q.lot}`]:[])],
      actions:[decide,...(rejected?[gate('Rad etilgan qismni scrap qilish',true,'',()=>actionCheck(ctx,'scrapRejectedReceipt',[q.id])),gate('Supplierga qaytarish',true,'',()=>actionCheck(ctx,'returnPurchaseToSupplier',[q.id]))]:[])],
      next:viaReturn?'Qaror Sotuv → Qaytarishlar bo‘limida qabul qilinadi.'
        :pending?'Natija tanlang; Passed’dan boshqa natijada sabab yozing. Kirish tekshiruvida qabul qilinadigan miqdorni kiritsangiz, qolgani karantinda qoladi.'
        :rejected?'Rad etilgan qism karantinda: uni supplierga qaytaring yoki scrap qiling (ochiq rad etilgan miqdor bo‘lsa tugma chiqadi).'
        :q.status==='Passed'?'Qabul qilingan miqdor available qoldiqqa o‘tgan; keyingi bosqich ishlatish yoki jo‘natish.':'Qaror qayd etilgan; tizimli muammo bo‘lsa NCR va CAPA oching.',
      links:viaReturn&&ctx.can('sales')?[{label:'Sotuv → Qaytarishlar',to:'/sales?view=returns'}]:[]}
  }
  const orderId=pathname==='/production'?p.get('id'):null
  if(orderId){
    const o=s.productionOrders.find(x=>x.id===orderId)
    if(!o)return 'missing'
    const running=['Tasdiqlangan','Jarayonda','Pauzada'].includes(o.status)
    const wo=o.workOrders.find(w=>!['Yakunlangan','Bekor qilingan'].includes(w.status))
    const center=s.workCenters.find(w=>w.id===(wo?.workCenterId||o.workCenterId))?.name
    return {kind:'production',title:o.code,status:o.status,
      facts:[`Joriy operatsiya: ${wo?`${wo.name||wo.id} · ${center||'—'}`:'yo‘q'}`],
      actions:[
        gate('Operatsiyani boshlash (START)',running&&Boolean(wo),!wo?'Ochiq operatsiya qolmagan':`MO holati “${o.status}” — START faqat Tasdiqlangan, Jarayonda yoki Pauzada buyurtmada`,()=>actionCheck(ctx,'startWorkOrder',[o.id,wo!.id])),
        act('Buyurtmani tahrirlash va rejalash',actionCheck(ctx,'updateProductionOrder',[o.id])),
      ],
      next:o.status==='Qoralama'?'Keyingi qadam: rejalashtiruvchi buyurtmani tasdiqlaydi.'
        :o.status==='Material kutilmoqda'?'Material yetishmaydi: MRP va xarid holatini tekshiring.'
        :o.status==='Sifat nazoratida'?'Final tekshiruv Sifat → Tekshiruvlar bo‘limida hal qilinadi.'
        :running?'Operator joriy operatsiyani boshlaydi, natija va scrapni qayd etadi, so‘ng “YAKUNLASH”.':'Buyurtma yopilgan.',
      links:o.status==='Sifat nazoratida'&&ctx.can('quality')?[{label:'Sifat → Tekshiruvlar',to:'/quality?view=checks'}]:[]}
  }
  return undefined
}

/** The page's module for context notes: the topic's module, or the route's first segment. */
export const moduleOfPath=(pathname:string)=>HELP_TOPICS.find(t=>t.path.split('?')[0]===pathname)?.module||pathname.split('/')[1]||'dashboard'
