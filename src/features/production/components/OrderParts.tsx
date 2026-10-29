import {useState} from 'react'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Checkbox,Confirm,Drawer,RecordUnavailable,Empty,Field,Icon,InfoGrid,Input,Modal,Progress,SectionTitle,Select,StatusBadge,Tabs,Textarea,positive,useForm} from '../../../shared/ui'
import type {ProductionOrder,ProductionStatus,WorkOrder} from '../../../types'
import {activeBomFor,buildTraceability,deliveryRisk,finalWorkOrder,jobCard,materialReadiness,operationInput,orderCosting,orderMaterialPlan,perUnit,remainingQty,stockOf,workOrderRemainingMinutes} from '../../../domain/manufacturingEngine'
import {operatorScopeBlocker} from '../../../domain/access'
import {brokenReservations,finishedWarehouseFor,outputWarehouseProblem,productionLineProblem} from '../../../domain/actions'
import {compactMoney,money,num,qty} from '../../../utils/format'
import {formatMinutes,minutesBetween,stamp,todayISO} from '../../../utils/dates'
import {employeeName,itemUnitOf,lineName,materialName,productName,useNow,warehouseName,workCenterName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {QualityResolveModal} from '../../common/QualityResolveModal'
import {LabelModal} from '../../common/Barcode'
import {OrderMaterialNote,OrderMaterialsPanel} from '../../purchases/components/Sourcing'
import type {LabelData} from '../../common/Barcode'

export const OPEN_STATUSES:ProductionStatus[]=['Qoralama','Material kutilmoqda','Tasdiqlangan','Jarayonda','Pauzada','Sifat nazoratida']
export const PRIORITIES:ProductionOrder['priority'][]=['Past','Normal','Yuqori','Kritik']
/** Why an open order cannot move on (engine `orderBlocker`). */
export const BLOCKER_LABEL={quality:'QC to‘sig‘i',machine:'Uskuna to‘xtagan'} as const

export function liveMinutes(wo:WorkOrder,now:Date){
  return wo.actualMin+(wo.status==='Jarayonda'&&wo.lastStartAt?minutesBetween(wo.lastStartAt,stamp(now)):0)
}

/* ------------------------------------------------------------ create/edit -- */

export function OrderFormModal({order,onClose,defaults}:{order?:ProductionOrder;onClose:()=>void;defaults?:{productId?:string;quantity?:number;due?:string;priority?:ProductionOrder['priority']}}){
  const app=useApp(),s=app.state
  const products=s.products.filter(p=>p.status!=='Arxiv'&&p.procurement!=='buy')
  const editing=Boolean(order)
  const qtyLocked=editing&&order!.status!=='Qoralama'
  const form=useForm(()=>({productId:order?.productId||defaults?.productId||products[0]?.id||'',quantity:String(order?.quantity??defaults?.quantity??100),lineId:order?.lineId||s.settings.defaultLineId,start:order?.start||todayISO(),due:order?.due||defaults?.due||'',priority:order?.priority||defaults?.priority||'Normal',responsibleId:order?.responsibleId||app.currentEmployee.id}),v=>{
    const bom=activeBomFor(s,v.productId)
    return {productId:!v.productId?'Mahsulot tanlang':!editing&&!bom?'Bu mahsulotda faol BOM yo‘q':undefined,quantity:positive(v.quantity,'Miqdor')||(Number(v.quantity)%1?'Butun son kiriting':undefined),due:v.due&&v.due<v.start?'Due sana boshlanishdan oldin bo‘lmasin':undefined}
  })
  const product=s.products.find(p=>p.id===form.values.productId)
  const [variantId,setVariantId]=useState(order?.variantId||'')
  const variants=(product?.variants||[]).filter(v=>v.status==='Faol'||v.id===variantId)
  const bom=editing?order!.bomSnapshot:activeBomFor(s,form.values.productId,variantId||undefined)
  const qtyNum=Number(form.values.quantity)||0
  // Requirements in the component's stock unit (BOM line UoM factor applied, audit #24).
  const requirements=bom?bom.components.map(c=>({c,need:perUnit(c)*qtyNum,available:stockOf(s,c.materialId).available})):[]
  const [outputLocation,setOutputLocation]=useState(order?.outputLocation||'')
  const variantRequired=Boolean(product?.variantStock)&&!editing
  // Same rules the engine applies (audit #4 / #12): an active line of the routing's branch and an output store of that branch.
  const lineLocked=editing&&(order!.materialReserved||!['Qoralama','Material kutilmoqda'].includes(order!.status))
  const lines=s.productionLines.filter(l=>l.status!=='Arxiv'||l.id===order?.lineId)
  const lineChanged=!editing||form.values.lineId!==order!.lineId
  const lineProblem=lineChanged&&bom?productionLineProblem(s,form.values.lineId,bom.operations):null
  const outputId=editing&&!lineChanged?order!.warehouseId:finishedWarehouseFor(s,form.values.lineId)
  const outputProblem=lineProblem||(lineChanged?outputWarehouseProblem(s,form.values.lineId,outputId):null)
  const submit=()=>form.submit(v=>{
    if(outputProblem||(variantRequired&&!variantId))return false
    const r=editing
      ?app.updateProductionOrder(order!.id,{quantity:qtyLocked?undefined:Number(v.quantity),start:v.start,due:v.due||undefined,priority:v.priority as ProductionOrder['priority'],lineId:v.lineId,responsibleId:v.responsibleId})
      :app.createProductionOrder({productId:v.productId,variantId:variantId||undefined,quantity:Number(v.quantity),lineId:v.lineId,start:v.start,due:v.due||undefined,priority:v.priority as ProductionOrder['priority'],responsibleId:v.responsibleId,outputLocation:outputLocation||undefined})
    if(r.ok)onClose()
    return r.ok
  })
  return <Modal open onClose={onClose} title={editing?`${order!.code} — tahrirlash`:'Yangi ishlab chiqarish buyurtmasi'} subtitle={editing?'Rezervdan keyin miqdor va liniya bloklanadi':'Qoralama · tasdiqlashda material rezerv qilinadi'} size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>{editing?'Saqlash':'Yaratish'}</button></>}>
    <div className="form-grid">
      <div className="form-group-title">Asosiy</div>
      {variants.length>0&&<Field label="Variant" required={variantRequired} error={variantRequired&&!variantId?'Variant bo‘yicha qoldiq yuritiladi — variantni tanlang':undefined} hint={variantId&&bom?.variantId===variantId?'Variantning o‘z BOM’i':variantRequired?'Tayyor mahsulot shu variant qoldig‘iga kiradi':'Variantda o‘z BOM bo‘lmasa umumiy BOM ishlatiladi'}><Select value={variantId} disabled={editing} onChange={setVariantId}>{!variantRequired&&<option value="">Umumiy (variantsiz)</option>}{variantRequired&&!variantId&&<option value="">Tanlang</option>}{variants.map(v=><option key={v.id} value={v.id}>{v.code} · {v.attributes}</option>)}</Select></Field>}
      <Field label="Mahsulot" required error={form.error('productId')}><Select value={form.values.productId} disabled={editing} onChange={v=>{form.set('productId',v);setVariantId('')}}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</Select></Field>
      <Field label="Miqdor" required error={form.error('quantity')} hint={qtyLocked?'Rezervdan keyin miqdor o‘zgarmaydi':product?.unit}><Input type="number" inputMode="numeric" min="1" step="1" disabled={qtyLocked} {...form.input('quantity')}/></Field>
      <Field label="Due" error={form.error('due')} hint={!form.values.due?`Bo‘sh: +${product?.leadTime??1} kun`:undefined}><Input type="date" {...form.input('due')}/></Field>
      <Field label="Priority"><Select value={form.values.priority} onChange={v=>form.set('priority',v as ProductionOrder['priority'])}>{PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}</Select></Field>
      <div className="form-group-title">Rejalashtirish</div>
      <Field label="BOM"><Input readOnly value={bom?`${bom.code} · ${bom.version}`:'Faol BOM topilmadi'}/></Field>
      <Field label="Routing"><Input readOnly value={bom?`${bom.operations.length} operatsiya · ${bom.operations.map(o=>s.workCenters.find(w=>w.id===o.workCenterId)?.code||'—').join(' → ')}`:'—'}/></Field>
      <Field label="Liniya" error={outputProblem||undefined} hint={outputProblem?undefined:lineLocked?'Rezerv yoki boshlangan ishdan keyin liniya o‘zgarmaydi':`Tayyor mahsulot → ${warehouseName(s,outputId)}`}><Select value={form.values.lineId} disabled={lineLocked} onChange={v=>form.set('lineId',v)}>{lines.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <Field label="Boshlanish"><Input type="date" {...form.input('start')}/></Field>
      {!editing&&(s.warehouses.find(w=>w.id===outputId)?.locations.length||0)>0&&<Field label="Tayyor mahsulot joyi" hint="Ixtiyoriy: bo‘sh bo‘lsa joysiz qabul qilinadi"><Select value={outputLocation} onChange={setOutputLocation}><option value="">Joysiz</option>{s.warehouses.find(w=>w.id===outputId)!.locations.map(l=><option key={l} value={l}>{l}</option>)}</Select></Field>}
      <Field className="span-2" label="Mas’ul"><Select value={form.values.responsibleId} onChange={v=>form.set('responsibleId',v)}>{s.employees.filter(e=>e.status!=='Arxiv').map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
    </div>
    {bom&&qtyNum>0&&<div className="form-section"><h4>Materiallar</h4>
      <div className="table-scroll"><table className="fit"><thead><tr><th>Komponent</th><th className="align-right">Talab</th><th className="align-right">Available</th><th>Holat</th></tr></thead><tbody>{requirements.map(({c,need,available})=><tr key={c.id}><td><div className="cell-main"><b>{materialName(s,c.materialId)}</b><small>{c.qty} {c.unit}/dona{c.factor!==undefined?` (= ${num(perUnit({...c,waste:0}),3)} ${itemUnitOf(s,c.materialId)})`:''} · scrap {c.waste}%</small></div></td><td className="align-right"><b>{qty(need,c.unit)}</b></td><td className="align-right">{num(available)}</td><td><StatusBadge tone={available>=need?'success':'danger'}>{available>=need?'Yetarli':`Kam: ${num(need-available)}`}</StatusBadge></td></tr>)}</tbody></table></div>
      {requirements.some(r=>r.available<r.need)&&<div className="inline-note warning"><Icon name="warning"/>Yetishmaydi — tasdiqlanganda “Material kutilmoqda” bo‘ladi, MRP xarid tavsiya qiladi.</div>}
    </div>}
  </Modal>
}

/* ----------------------------------------------------------- output/scrap -- */

export function OutputModal({order,onClose}:{order:ProductionOrder;onClose:()=>void}){
  const app=useApp()
  const rest=remainingQty(order),unit=itemUnitOf(app.state,order.productId)
  // One key per opened form: a double submit or a resend from another tab is posted once (BUG-13).
  const [key]=useState(()=>`out-${order.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`)
  // Empty by default: pressing Enter must not book the whole remaining quantity by accident (N-17).
  const form=useForm({good:'',scrap:'0',reason:'Operator xatosi'},v=>{
    const g=Number(v.good)||0,sc=Number(v.scrap)||0
    return {good:g<0||sc<0?'Manfiy bo‘lmasin':g+sc<=0?'Tayyor yoki scrap miqdorini kiriting':g+sc>rest?`Qolgan miqdor ${rest} dan oshmasin`:(g%1||sc%1)?'Butun son kiriting':undefined,reason:sc>0&&!v.reason.trim()?'Scrap sababi majburiy':undefined}
  })
  const submit=()=>form.submit(v=>{const r=app.reportOutput(order.id,Number(v.good)||0,Number(v.scrap)||0,v.reason,key);if(r.ok)onClose();return r.ok})
  return <Modal open onClose={onClose} title="Natija kiritish" eyebrow={order.code} subtitle={`${productName(app.state,order.productId)} · qolgan ${rest} ${unit} · backflush`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Qayd etish</button></>}>
    <div className="form-grid">
      <Field label="Tayyor (yaroqli)" required error={form.error('good')} hint={`Qolgan: ${rest} ${unit}`}><Input type="number" inputMode="numeric" min="0" step="1" placeholder={String(rest)} {...form.input('good')} autoFocus/></Field>
      <Field label="Scrap"><Input type="number" inputMode="numeric" min="0" step="1" {...form.input('scrap')}/></Field>
      {Number(form.values.scrap)>0&&<Field className="span-2" label="Scrap sababi" required error={form.error('reason')}><Select value={form.values.reason} onChange={v=>form.set('reason',v)}>{['Material nuqsoni','Operator xatosi','Uskuna xatosi','O‘lcham mos emas','Qoplama nuqsoni','Boshqa'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>}
    </div>
  </Modal>
}

export function ScrapModal({order,onClose}:{order:ProductionOrder;onClose:()=>void}){
  const app=useApp(),rest=remainingQty(order)
  const form=useForm({qty:'1',reason:'Material nuqsoni',note:''},v=>({qty:positive(v.qty,'Miqdor')||(Number(v.qty)>rest?`Maksimum ${rest}`:undefined)}))
  const submit=()=>form.submit(v=>{const r=app.recordScrap(order.id,Number(v.qty),v.note.trim()?`${v.reason}: ${v.note.trim()}`:v.reason);if(r.ok)onClose();return r.ok})
  return <Modal open onClose={onClose} title="Scrap qayd etish" eyebrow={order.code} subtitle="Material sarflanadi, NCR ochiladi" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={submit}><Icon name="trash" size={16}/>Scrap saqlash</button></>}>
    <div className="form-grid">
      <Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="1" max={rest} {...form.input('qty')}/></Field>
      <Field label="Sabab"><Select value={form.values.reason} onChange={v=>form.set('reason',v)}>{['Material nuqsoni','Operator xatosi','Uskuna xatosi','O‘lcham mos emas','Qoplama nuqsoni','Boshqa'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field className="span-2" label="Izoh"><Textarea {...form.input('note')} placeholder="Nuqson tavsifi (ixtiyoriy)"/></Field>
    </div>
  </Modal>
}

/** Material on top of the BOM plan, with a reason (N-20); planners only, from free stock. */
export function ExtraIssueModal({order,onClose}:{order:ProductionOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const components=order.bomSnapshot.components
  const form=useForm({materialId:components[0]?.materialId||'',qty:'',reason:''},v=>({materialId:v.materialId?undefined:'Material tanlang',qty:positive(v.qty,'Miqdor'),reason:v.reason.trim().length>=3?undefined:'Sababni yozing'}))
  const submit=()=>form.submit(v=>{const r=app.issueExtraMaterial(order.id,v.materialId,Number(v.qty),v.reason);if(r.ok)onClose();return r.ok})
  const given=(order.extraIssues||[]).filter(x=>x.materialId===form.values.materialId).reduce((a,x)=>a+x.qty,0)
  return <Modal open onClose={onClose} title="Qo‘shimcha material" eyebrow={order.code} subtitle="BOM rejasidan tashqari chiqim — bo‘sh qoldiqdan" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="warning-glass-btn" onClick={submit}><Icon name="plus" size={16}/>Chiqim qilish</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Material" required error={form.error('materialId')}><Select value={form.values.materialId} onChange={v=>form.set('materialId',v)}>{components.map(c=><option key={c.materialId} value={c.materialId}>{materialName(s,c.materialId)} · bo‘sh {num(stockOf(s,c.materialId).available,2)} {itemUnitOf(s,c.materialId)}</option>)}</Select></Field>
      <Field label="Miqdor" required error={form.error('qty')} hint={given?`Avval qo‘shimcha: ${num(given,2)}`:undefined}><Input type="number" min="0" step="any" {...form.input('qty')}/></Field>
      <Field className="span-2" label="Sabab" required error={form.error('reason')}><Textarea {...form.input('reason')} placeholder="Masalan: 3 dona scrap o‘rniga"/></Field>
    </div>
  </Modal>
}

/* ------------------------------------------------------------ work orders -- */

/**
 * Job-card report of one operation: good and scrap up to what reached it. More needs a written reason; the final
 * operation's report is the order's output (finished stock), an earlier operation's scrap is booked on the order.
 */
export function OperationOutputModal({order,workOrder,onClose}:{order:ProductionOrder;workOrder:WorkOrder;onClose:()=>void}){
  const app=useApp(),unit=itemUnitOf(app.state,order.productId)
  const input=operationInput(order,workOrder),done=(workOrder.goodQty||0)+(workOrder.scrapQty||0),allowed=Math.max(0,input-done)
  const final=finalWorkOrder(order)?.id===workOrder.id
  // One key per opened form: a double submit is posted once.
  const [key]=useState(()=>`op-${workOrder.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`)
  const form=useForm({good:'',scrap:'0',reason:'Operator xatosi',override:''},v=>{
    const g=Number(v.good)||0,sc=Number(v.scrap)||0
    return {good:g<0||sc<0?'Manfiy bo‘lmasin':g+sc<=0?'Tayyor yoki scrap miqdorini kiriting':(g%1||sc%1)?'Butun son kiriting':done+g+sc>order.quantity?`Buyurtma miqdori ${order.quantity} dan oshmasin`:undefined,
      override:g+sc>allowed&&v.override.trim().length<3?`Ruxsat ${allowed} ${unit} — ortig‘i uchun sabab yozing`:undefined}
  })
  const over=(Number(form.values.good)||0)+(Number(form.values.scrap)||0)>allowed
  const submit=()=>form.submit(v=>{const r=app.reportOperationOutput(order.id,workOrder.id,Number(v.good)||0,Number(v.scrap)||0,{reason:v.reason,override:v.override,key});if(r.ok)onClose();return r.ok})
  return <Modal open onClose={onClose} title="Operatsiya natijasi" eyebrow={`${order.code} · ${workOrder.sequence}. ${workOrder.name}`} subtitle={`Kirdi ${input} · qayd etilgan ${done} · ruxsat ${allowed} ${unit}${final?' · oxirgi operatsiya: tayyor mahsulot omborga (backflush)':''}`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Qayd etish</button></>}>
    <div className="form-grid">
      <Field label="Tayyor (yaroqli)" required error={form.error('good')} hint={`Ruxsat: ${allowed} ${unit}`}><Input type="number" inputMode="numeric" min="0" step="1" placeholder={String(allowed)} {...form.input('good')} autoFocus/></Field>
      <Field label="Scrap"><Input type="number" inputMode="numeric" min="0" step="1" {...form.input('scrap')}/></Field>
      {Number(form.values.scrap)>0&&<Field className="span-2" label="Scrap sababi"><Select value={form.values.reason} onChange={v=>form.set('reason',v)}>{['Material nuqsoni','Operator xatosi','Uskuna xatosi','O‘lcham mos emas','Qoplama nuqsoni','Boshqa'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>}
      {over&&<Field className="span-2" label="Ortiqcha miqdor sababi" required error={form.error('override')} hint="Audit jurnaliga yoziladi"><Textarea {...form.input('override')} placeholder="Masalan: oldingi operatsiya natijasi kam yozilgan"/></Field>}
    </div>
    {!final&&Number(form.values.scrap)>0&&<div className="inline-note warning"><Icon name="info"/>Scrap darhol MO’ga yoziladi: material sarflanadi, NCR ochiladi.</div>}
  </Modal>
}

/** People who may run this operation (active, production right, inside their scope) — the engine re-checks on save. */
export function AssignOperatorsModal({order,workOrder,onClose}:{order:ProductionOrder;workOrder:WorkOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [picked,setPicked]=useState<string[]>(workOrder.operatorIds||[])
  const people=s.employees.filter(e=>e.status!=='Arxiv').map(e=>({e,blocked:operatorScopeBlocker(s,e,workOrder.workCenterId)}))
  const eligible=people.filter(p=>!p.blocked)
  const save=()=>{const r=app.assignWorkOrder(order.id,workOrder.id,picked);if(r.ok)onClose()}
  return <Modal open onClose={onClose} title="Operator biriktirish" eyebrow={`${order.code} · ${workOrder.name}`} subtitle={`${workCenterName(s,workOrder.workCenterId)} · faqat shu ish markazida ishlay oladigan xodimlar`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={save}><Icon name="check" size={16}/>Saqlash</button></>}>
    {eligible.length?<div className="stack-list">{eligible.map(({e})=><div className="list-row" key={e.id}><Checkbox checked={picked.includes(e.id)} onChange={v=>setPicked(x=>v?[...x,e.id]:x.filter(i=>i!==e.id))} label={e.name} description={`${e.department} · ${workCenterName(s,e.workCenterId)} · ${e.shift}`}/></div>)}</div>:<Empty compact icon="users" title="Mos operator yo‘q" text="Rol ruxsati yoki ish markazi doirasi mos kelmaydi"/>}
    {people.length>eligible.length&&<p className="soft-meta">{people.length-eligible.length} ta xodim doirasi yoki roli sabab ko‘rsatilmadi</p>}
  </Modal>
}

const EVENT_LABEL:Record<string,string>={start:'Boshlandi',resume:'Davom ettirildi',pause:'Pauza',setup:'Setup tugadi',complete:'Yakunlandi',output:'Natija',assign:'Operator',cancel:'Bekor',split:'Split'}

function CompleteOrderModal({order,onClose,onOutput}:{order:ProductionOrder;onClose:()=>void;onOutput:()=>void}){
  const app=useApp(),rest=remainingQty(order),unit=itemUnitOf(app.state,order.productId)
  return <Modal open onClose={onClose} title="Buyurtmani yakunlash" eyebrow={order.code} subtitle={`Qolgan ${num(rest)} ${unit} avtomatik ishlab chiqarilmaydi`} size="md">
    <div className="stack-list">
      <button type="button" className="list-row is-clickable" onClick={()=>{if(order.status==='Sifat nazoratida'){const r=app.transitionProduction(order.id,'Jarayonda');if(!r.ok)return}onOutput()}}><span className="list-row-copy"><b>Qolganini ishlab chiqarish</b><small>Natija kiritish oynasiga o‘ting va faqat real tayyor/scrap miqdorni kiriting.</small></span><Icon name="chevron" size={14}/></button>
      <button type="button" className="list-row is-clickable" onClick={()=>{const r=app.shortCloseProduction(order.id,'Operator short close');if(r.ok)onClose()}}><span className="list-row-copy"><b>Short close</b><small>Qolgan miqdor yopiladi, tegishli material rezervi qaytariladi.</small></span><Icon name="chevron" size={14}/></button>
      <button type="button" className="list-row is-clickable" onClick={()=>{const r=app.createBackorder(order.id);if(r.ok)onClose()}}><span className="list-row-copy"><b>Backorder</b><small>Qolgan miqdor uchun yangi qoralama MO yaratiladi.</small></span><Icon name="chevron" size={14}/></button>
    </div>
    <div className="inline-note warning"><Icon name="info"/>MO faqat qolgan miqdor 0 va barcha operatsiyalar yakunlanganda yopiladi.</div>
  </Modal>
}

export function WorkOrderList({order,compact}:{order:ProductionOrder;compact?:boolean}){
  const app=useApp(),s=app.state,now=useNow(15000)
  const [modal,setModal]=useState<{kind:'output'|'assign';wo:WorkOrder}|null>(null)
  const canRun=['Tasdiqlangan','Jarayonda','Pauzada'].includes(order.status)&&app.can('production','edit')
  const canPlan=app.can('production','edit')&&!['Yakunlangan','Bekor qilingan'].includes(order.status)
  if(!order.workOrders.length)return <Empty compact icon="clock" title="Routing yo‘q"/>
  return <><ol className={`work-orders ${compact?'compact':''}`}>{order.workOrders.map(w=>{
    const card=jobCard(s,order,w,now)
    const blocked=w.status==='Kutilmoqda'&&w.dependsOn.length>0
    const open=w.status!=='Yakunlangan'&&w.status!=='Bekor qilingan'
    const started=w.status==='Jarayonda'||w.status==='Pauzada'
    return <li key={w.id} className={`wo wo-${w.status==='Jarayonda'?'running':w.status==='Yakunlangan'?'done':w.status==='Pauzada'?'paused':'idle'}`}>
      <span className="wo-seq">{w.status==='Yakunlangan'?<Icon name="check" size={14}/>:w.sequence}</span>
      <div className="wo-body">
        <div className="wo-title"><b>{w.name}</b><StatusBadge>{w.status}</StatusBadge></div>
        <small>{workCenterName(s,w.workCenterId)} · reja {formatMinutes(w.plannedMin)} · amalda <span className="num">{formatMinutes(card.actualMin)}</span>{card.setupMin?` (setup ${formatMinutes(card.setupMin)})`:''}{card.pausedMin?` · pauza ${formatMinutes(card.pausedMin)}`:''}{open&&` · qolgan ~${formatMinutes(workOrderRemainingMinutes(order,w))}`}</small>
        {(card.tracksQty||started)&&<small>Kirdi {num(card.plannedQty)} · tayyor <b>{num(card.goodQty)}</b>{card.scrapQty?<> · <span className="negative">scrap {num(card.scrapQty)}</span></>:null} · ochiq {num(card.openQty)}</small>}
        {card.operators.length>0&&<small>Operator: {card.operators.map(id=>employeeName(s,id)).join(', ')}</small>}
        {!compact&&card.instructions&&<p>{card.instructions}{card.worksheet&&<em> · {card.worksheet}</em>}</p>}
        {blocked&&<small className="wo-blocked"><Icon name="lock" size={12}/>Kutmoqda: {order.workOrders.filter(x=>w.dependsOn.includes(x.operationId)).map(x=>x.name).join(', ')}</small>}
        {!compact&&card.history.length>0&&<details className="wo-history"><summary>Tarix · {card.history.length}</summary><ul>{card.history.slice(-8).reverse().map((e,i)=><li key={i}><small>{e.at} · {EVENT_LABEL[e.action]||e.action}{e.minutes?` · ${formatMinutes(e.minutes)}`:''}{e.good!==undefined?` · ${e.good} tayyor`:''}{e.scrap?` · ${e.scrap} scrap`:''}{e.note?` · ${e.note}`:''} · {employeeName(s,e.by)}</small></li>)}</ul></details>}
      </div>
      {(canRun&&open||canPlan&&open&&!compact)&&<div className="wo-actions">
        {canRun&&open&&(w.status==='Jarayonda'
          ?<><button type="button" className="secondary-glass-btn compact" onClick={()=>app.pauseWorkOrder(order.id,w.id)}><Icon name="pause" size={14}/>Pauza</button><button type="button" className="primary-glass-btn compact" onClick={()=>app.finishWorkOrder(order.id,w.id)}><Icon name="check" size={14}/>Tugatish</button></>
          :<button type="button" className="primary-glass-btn compact" disabled={blocked} title={blocked?'Oldingi operatsiya tugamagan':undefined} onClick={()=>app.startWorkOrder(order.id,w.id)}><Icon name="play" size={14}/>{w.status==='Pauzada'?'Davom ettirish':'Boshlash'}</button>)}
        {canRun&&started&&!compact&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setModal({kind:'output',wo:w})}><Icon name="plus" size={14}/>Natija</button>}
        {canPlan&&!compact&&<button type="button" className="ghost-btn compact" onClick={()=>setModal({kind:'assign',wo:w})}><Icon name="users" size={14}/>Operator</button>}
      </div>}
    </li>})}</ol>
    {modal?.kind==='output'&&<OperationOutputModal order={order} workOrder={modal.wo} onClose={()=>setModal(null)}/>}
    {modal?.kind==='assign'&&<AssignOperatorsModal order={order} workOrder={modal.wo} onClose={()=>setModal(null)}/>}
  </>
}

/* ---------------------------------------------------------------- drawer -- */

type Primary={label:string;icon:string;run:()=>void;tone?:'primary'|'secondary'|'danger';disabled?:string}

export function OrderDrawer({orderId,onClose}:{orderId:string|null;onClose:()=>void}){
  const app=useApp()
  const order=app.state.productionOrders.find(o=>o.id===orderId)
  if(!order)return orderId?<RecordUnavailable label="Ishlab chiqarish buyurtmasi" onClose={onClose}/>:null
  return <OrderDrawerBody key={order.id} order={order} onClose={onClose}/>
}

function OrderDrawerBody({order,onClose}:{order:ProductionOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [tab,setTab]=useState('overview')
  const [modal,setModal]=useState<'edit'|'output'|'scrap'|'extra'|'complete'|'cancel'|null>(null)
  const [check,setCheck]=useState<string|null>(null)
  const [label,setLabel]=useState<LabelData|null>(null)
  const product=s.products.find(p=>p.id===order.productId)
  const unit=product?.unit||'dona'
  const ready=materialReadiness(s,order)
  const risk=deliveryRisk(s,order)
  const costing=orderCosting(s,order)
  const checks=s.qualityChecks.filter(q=>q.sourceType==='production'&&q.sourceId===order.id)
  const pendingFinal=checks.find(q=>q.type==='Final'&&q.status==='Pending')
  const closed=['Yakunlangan','Bekor qilingan'].includes(order.status)
  const canEdit=app.can('production','edit')
  const t=(status:ProductionStatus)=>app.transitionProduction(order.id,status)
  const completeBlock=order.qualityStatus==='Passed'?undefined:['Failed','Rework','Scrap','Hold'].includes(order.qualityStatus)?`Final QC: ${order.qualityStatus}. Qayta tekshiruv yoki rework kerak.`:'Final quality check hali Passed emas'
  const primary:Primary[]=({
    'Qoralama':[{label:'Tasdiqlash va rezerv',icon:'check',run:()=>t('Tasdiqlangan')}],
    'Material kutilmoqda':[{label:'Materialni qayta tekshirish',icon:'refresh',run:()=>app.checkAvailability(order.id)}],
    'Tasdiqlangan':[{label:'Ishni boshlash',icon:'play',run:()=>t('Jarayonda')}],
    'Jarayonda':[{label:'Natija kiritish',icon:'plus',run:()=>setModal('output')},{label:'Pauza',icon:'pause',run:()=>t('Pauzada'),tone:'secondary'},{label:'Sifat nazoratiga',icon:'shield',run:()=>t('Sifat nazoratida'),tone:'secondary'}],
    'Pauzada':[{label:'Davom ettirish',icon:'play',run:()=>t('Jarayonda')},{label:'Natija kiritish',icon:'plus',run:()=>setModal('output'),tone:'secondary'},{label:'Sifat nazoratiga',icon:'shield',run:()=>t('Sifat nazoratida'),tone:'secondary'}],
    'Sifat nazoratida':[{label:remainingQty(order)>0?'Yakunlash variantlari':'Yakunlash',icon:'check',run:()=>remainingQty(order)>0?setModal('complete'):t('Yakunlangan'),disabled:s.settings.policies.requireFinalQc?completeBlock:['Failed','Rework','Scrap','Hold'].includes(order.qualityStatus)?completeBlock:undefined}],
  } as Record<string,Primary[]>)[order.status]||[]
  const tabs=[{value:'overview',label:'Umumiy'},{value:'operations',label:'Operatsiyalar',count:order.workOrders.length},{value:'materials',label:'Materiallar',count:closed||order.materialReserved?undefined:orderMaterialPlan(s,order).filter(l=>l.toBuy>0).length||undefined},{value:'quality',label:'Sifat',count:checks.length},...(app.can('costs')?[{value:'costs',label:'Tannarx'}]:[]),{value:'trace',label:'Traceability'},{value:'documents',label:'Hujjatlar',count:s.attachments.filter(a=>a.entityType==='production'&&a.entityId===order.id).length},{value:'history',label:'Tarix'}]
  const trace=buildTraceability(s,order.id)
  // A reserved lot that expired or went on hold since confirmation blocks issue until it is re-reserved (audit #10).
  const brokenLots=!closed&&order.materialReserved?[...new Set(brokenReservations(s,order,todayISO()).flatMap(r=>r.lots))]:[]
  return <Drawer open onClose={onClose} title={order.code} eyebrow="Ishlab chiqarish buyurtmasi" icon="factory" size="xl"
    subtitle={<>{product?.name} · {num(order.quantity)} {unit}{order.source?` · ${order.source}`:''}</>}
    headerExtra={<><StatusBadge>{order.status}</StatusBadge><StatusBadge>{order.priority}</StatusBadge>{risk&&<StatusBadge tone="danger">Muddat riski</StatusBadge>}{order.salesOrderId&&<span className="chip"><Icon name="truck" size={12}/>{s.salesOrders.find(x=>x.id===order.salesOrderId)?.code}</span>}{order.reworkOf&&<span className="chip">Rework</span>}</>}
    actions={<>
      {!closed&&canEdit&&<button type="button" className="ghost-btn" onClick={()=>setModal('cancel')}><Icon name="x" size={15}/>Bekor qilish</button>}
      {!closed&&canEdit&&<button type="button" className="secondary-glass-btn" onClick={()=>setModal('edit')}><Icon name="edit" size={15}/>Tahrirlash</button>}
      {(order.lot||order.serialRange)&&<button type="button" className="secondary-glass-btn" onClick={()=>setLabel({title:product?.name||order.code,code:order.lot||order.serialRange!.split('…')[0],lines:[['SKU',product?.sku||''],['MO',order.code],[order.lot?'Lot':'Serial',order.lot||order.serialRange||''],['Miqdor',`${num(order.completed)} ${unit}`]]})}><Icon name="printer" size={15}/>Label</button>}
      {['Jarayonda','Pauzada'].includes(order.status)&&canEdit&&<button type="button" className="warning-glass-btn" onClick={()=>setModal('scrap')}><Icon name="trash" size={15}/>Scrap</button>}
      {['Jarayonda','Pauzada'].includes(order.status)&&canEdit&&<button type="button" className="ghost-btn" onClick={()=>setModal('extra')}><Icon name="plus" size={15}/>Qo‘shimcha material</button>}
      <span className="spacer"/>
      {canEdit&&primary.map(a=><button type="button" key={a.label} className={a.tone==='secondary'?'secondary-glass-btn':'primary-glass-btn'} disabled={Boolean(a.disabled)} title={a.disabled} onClick={a.run}><Icon name={a.icon} size={16}/>{a.label}</button>)}
      {!canEdit&&!closed&&<span className="soft-meta">Faqat ko‘rish ruxsati</span>}
    </>}>
    <Tabs items={tabs} active={tab} onChange={setTab} ariaLabel="Buyurtma bo‘limlari"/>
    {tab==='overview'&&<>
      <div className="mo-summary">
        <div className="mo-progress card"><div className="mo-progress-head"><span>Bajarilishi</span><b>{order.progress}%</b></div><Progress value={order.progress} label="Bajarilishi"/><div className="mo-counts"><span><b>{num(order.completed)}</b> tayyor</span><span><b>{num(order.scrap)}</b> scrap</span><span><b>{num(remainingQty(order))}</b> qolgan</span></div></div>
        <InfoGrid columns={3} items={[{label:'Material',value:order.materialReserved?'Rezerv qilingan':`${ready}% tayyor`,tone:order.materialReserved||ready>=100?'success':'warning'},{label:'Final QC',value:order.qualityStatus,tone:order.qualityStatus==='Passed'?'success':['Failed','Scrap'].includes(order.qualityStatus)?'danger':undefined},{label:'Due',value:order.due,tone:risk?'danger':undefined}]}/>
      </div>
      {order.status==='Sifat nazoratida'&&completeBlock&&<div className="inline-note warning"><Icon name="shield"/><span>{completeBlock}{pendingFinal&&app.can('quality','edit')&&<> — <button type="button" className="link-btn" onClick={()=>setCheck(pendingFinal.id)}>natijani hozir kiritish</button></>}</span></div>}
      {brokenLots.length>0&&<div className="inline-note warning" role="alert"><Icon name="warning"/><span>Rezerv qilingan LOT endi yaroqsiz (muddati o‘tgan yoki bloklangan): <b>{brokenLots.join(', ')}</b> — natija va material chiqimi bloklanadi.{canEdit&&<> <button type="button" className="link-btn" onClick={()=>app.refreshMaterialReservation(order.id)}>Rezervni yangilash</button></>}</span></div>}
      <OrderMaterialNote order={order} onOpenMaterials={()=>setTab('materials')}/>
      <InfoGrid items={[{label:'Mahsulot',value:product?.name},{label:'BOM snapshot',value:`${order.bomSnapshot.code} · ${order.bomVersion}`},{label:'Liniya',value:lineName(s,order.lineId)},{label:'Ombor',value:warehouseName(s,order.warehouseId)},{label:'Mas’ul',value:employeeName(s,order.responsibleId)},{label:'Boshlanish',value:order.start},{label:order.lot?'Lot':'Serial',value:order.lot||order.serialRange},{label:'Yaratilgan',value:order.createdAt}]}/>
    </>}
    {tab==='operations'&&<WorkOrderList order={order}/>}
    {tab==='materials'&&<OrderMaterialsPanel order={order}/>}
    {tab==='quality'&&<div className="stack-list">
      {checks.length?checks.map(q=><button type="button" className="list-row is-clickable" key={q.id} onClick={()=>setCheck(q.id)}><span className="list-row-copy"><b>{q.type} inspection</b><small>{q.date}{q.reason?` · ${q.reason}`:''}{q.measured?` · ${q.measured}`:''}</small></span><span className="list-row-meta"><StatusBadge>{q.status}</StatusBadge></span><Icon name="chevron" size={13} className="list-row-chevron"/></button>):<Empty compact icon="shield" title="Tekshiruv yo‘q" text="Final tekshiruv sifatga yuborilganda yaratiladi"/>}
      {!closed&&<div className="row-actions"><button type="button" className="secondary-glass-btn compact" disabled={!app.can('quality','create')&&!canEdit} onClick={()=>app.createQualityCheck({sourceType:'production',sourceId:order.id,itemId:order.productId,type:'Jarayon',lot:order.lot})}><Icon name="plus" size={14}/>In-process tekshiruv</button></div>}
    </div>}
    {tab==='costs'&&app.can('costs')&&<div className="cost-grid">
      <table className="fit cost-table"><thead><tr><th>Element</th><th className="align-right">Standart (to‘liq)</th><th className="align-right">Amalda</th></tr></thead><tbody>
        {(['material','labor','machine','energy','overhead'] as const).map(k=><tr key={k}><td>{{material:'Material',labor:'Mehnat (labor)',machine:'Uskuna vaqti',energy:'Energiya',overhead:'Overhead'}[k]}</td><td className="align-right">{money(costing.planned[k])}</td><td className="align-right">{money(costing.actual[k])}</td></tr>)}
        <tr><td>Waste (scrap) <span className="soft-meta">· jami ichida</span></td><td className="align-right muted">—</td><td className="align-right">{costing.waste?money(costing.waste):'—'}</td></tr>
        <tr className="total"><td>Jami</td><td className="align-right">{money(costing.planned.total)}</td><td className="align-right">{money(costing.actual.total)}</td></tr>
      </tbody></table>
      <InfoGrid columns={2} items={[{label:'Earned (bajarilgan)',value:money(costing.earned)},{label:'Variance',value:`${costing.variance>0?'+':''}${compactMoney(costing.variance)} (${costing.variancePct>0?'+':''}${costing.variancePct}%)`,tone:costing.variancePct>5?'danger':costing.variancePct<-2?'success':undefined},{label:'Birlik tannarxi',value:money(costing.unitCost)},{label:'Standart tannarx',value:money(product?.standardCost||0)},
        {label:'WIP (tugallanmagan ish)',value:money(costing.wip)},{label:'Tayyor mahsulotga o‘tgan',value:money(costing.relieved)},
        costing.rework>0&&{label:'Rework (alohida MO’larda)',value:money(costing.rework)},costing.rework>0&&{label:'Birlik tannarxi + rework',value:money(costing.fullUnitCost)}]}/>
      <p className="soft-meta">Material (chiqim paytidagi narx) + mehnat (vaqt × stavka) + uskuna va energiya (ishlash soati × stavka) + {s.settings.policies.overheadRate}% overhead · scrap ulushi jami ichida</p>
      {costing.incomplete.length>0&&<div className="inline-note warning"><Icon name="warning"/><span>Qisman taxminiy: {costing.incomplete.join(' · ')}</span></div>}
    </div>}
    {tab==='trace'&&<div className="two-col">
      <div><SectionTitle title="Upstream (sarflangan lotlar)"/>{trace.upstreamLots.length?<div className="stack-list">{trace.upstreamLots.map(l=><div className="list-row" key={l.id}><span className="list-row-copy"><b>{l.code}</b><small>{materialName(s,l.itemId)} · {l.sourceCode}</small></span><StatusBadge tone="info">{l.sourceType==='purchase'?'Xarid':l.sourceType==='production'?'Ishlab chiqarish':'Boshlang‘ich'}</StatusBadge></div>)}</div>:<Empty compact title="Hali material sarflanmagan"/>}</div>
      <div><SectionTitle title="Downstream"/>{trace.outputLots.length?<div className="stack-list">{trace.outputLots.map(l=><div className="list-row" key={l.id}><span className="list-row-copy"><b>{l.code}</b><small>Qoldiq {num(l.qty)} · {l.consumedBy.length?`→ ${l.consumedBy.join(', ')}`:'hali sotilmagan'}</small></span></div>)}{trace.downstreamSales.map(o=><div className="list-row" key={o.id}><span className="list-row-copy"><b>{o.code}</b><small>{s.customers.find(c=>c.id===o.customerId)?.name}</small></span><StatusBadge>{o.status}</StatusBadge></div>)}</div>:<Empty compact title="Tayyor lot hali yo‘q"/>}</div>
    </div>}
    {tab==='documents'&&<AttachmentsPanel entityType="production" entityId={order.id} canEdit={canEdit}/>}
    {tab==='history'&&<ActivityPanel sources={[order.code,order.id]}/>}
    {modal==='edit'&&<OrderFormModal order={order} onClose={()=>setModal(null)}/>}
    {modal==='output'&&<OutputModal order={order} onClose={()=>setModal(null)}/>}
    {modal==='scrap'&&<ScrapModal order={order} onClose={()=>setModal(null)}/>}
    {modal==='extra'&&<ExtraIssueModal order={order} onClose={()=>setModal(null)}/>}
    {modal==='complete'&&<CompleteOrderModal order={order} onClose={()=>setModal(null)} onOutput={()=>setModal('output')}/>}
    <Confirm open={modal==='cancel'} onClose={()=>setModal(null)} onConfirm={()=>t('Bekor qilingan')} danger title={`${order.code} bekor qilinsinmi?`} text={`Qolgan miqdor uchun material rezervi qaytariladi.${order.completed?` Allaqachon qabul qilingan ${order.completed} ${unit} omborda qoladi.`:''}`} confirmText="Buyurtmani bekor qilish"/>
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
    <LabelModal label={label} onClose={()=>setLabel(null)}/>
  </Drawer>
}

