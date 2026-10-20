import {useMemo,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,PageHeader,ResourceTable,SectionTitle,Select,StatusBadge,Textarea,Toggle,positive,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {QualityAlert,QualityCheck,QualityControlPoint} from '../../../types'
import {sourceLabel} from '../../../domain/actions'
import {awaitsRework,isDefect,outputByDay,reworkOrders,scrapEvents} from '../../../domain/manufacturingEngine'
import {addDays,periodStart,todayISO} from '../../../utils/dates'
import {compactMoney,num} from '../../../utils/format'
import {employeeName,materialName,productName} from '../../common/lookups'
import {ActivityPanel} from '../../common/RecordPanels'
import {BarList} from '../../common/charts'
import {QualityResolveModal} from '../../common/QualityResolveModal'

export default function Quality(){
  const [sp]=useSearchParams(),view=sp.get('view')||'overview'
  if(view==='checks')return <Checks/>
  if(view==='alerts')return <Alerts/>
  if(view==='control-points')return <ControlPoints/>
  if(view==='capa')return <CapaBoard/>
  if(view==='defects')return <Defects/>
  if(view==='rework')return <Rework/>
  if(view==='scrap')return <Scrap/>
  return <Overview/>
}

const TYPES:QualityCheck['type'][]=['Kirish','Jarayon','Final']
const RANGE_OPTIONS=[{value:'1',label:'Bugun'},{value:'7',label:'7 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'}]

function Overview(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [check,setCheck]=useState<string|null>(null)
  const since=addDays(todayISO(),-30)
  const recent=s.qualityChecks.filter(q=>q.status!=='Pending'&&q.date.slice(0,10)>=since)
  const rate=(st:QualityCheck['status'])=>recent.length?Math.round(recent.filter(q=>q.status===st).length/recent.length*100):0
  const pending=s.qualityChecks.filter(q=>q.status==='Pending')
  const openAlerts=s.qualityAlerts.filter(a=>a.status!=='Yopilgan')
  return <div className="page-stack">
    <PageHeader title="Sifat nazorati" subtitle="Incoming → in-process → final · Failed NCR ochadi"/>
    <div className="kpi-grid">
      <KPI label="Pass rate (30 kun)" value={`${rate('Passed')}%`} sub={`${recent.length} tekshiruv`} tone="mint" icon={<Icon name="check"/>} onClick={()=>navigate('/quality?view=checks&status=Passed')}/>
      <KPI label="Kutilayotgan" value={pending.length} sub="Inspector navbati" tone="orange" icon={<Icon name="clock"/>} onClick={()=>navigate('/quality?view=checks&status=Pending')}/>
      <KPI label="Defect rate" value={`${rate('Failed')+rate('Scrap')}%`} sub="Failed + Scrap" tone="pink" icon={<Icon name="warning"/>} onClick={()=>navigate('/quality?view=checks&status=Failed')}/>
      <KPI label="Ochiq NCR" value={openAlerts.length} sub="CAPA kerak" tone="purple" icon={<Icon name="shield"/>} onClick={()=>navigate('/quality?view=alerts&status=Ochiq')}/>
    </div>
    <div className="two-col">
      <Card title="Inspector navbati" subtitle="bosing — natija" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/quality?view=checks&status=Pending')}>Barchasi <Icon name="chevron" size={13}/></button>}>
        {pending.length?<div className="stack-list">{pending.map(q=><button type="button" className="list-row is-clickable" key={q.id} onClick={()=>setCheck(q.id)}><span className="list-row-copy"><b>{q.type} · {sourceLabel(s,q.sourceId)}</b><small>{materialName(s,q.itemId)}{q.lot?` · ${q.lot}`:''} · {q.date}</small></span><StatusBadge>{q.status}</StatusBadge></button>)}</div>:<Empty compact icon="check" title="Kutilayotgan tekshiruv yo‘q"/>}
      </Card>
      <Card title="Ochiq NCR" subtitle="severity bo‘yicha" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/quality?view=capa')}>CAPA <Icon name="chevron" size={13}/></button>}>
        {openAlerts.length?<div className="stack-list">{[...openAlerts].sort((a,b)=>(b.severity==='Yuqori'?2:b.severity==='O‘rta'?1:0)-(a.severity==='Yuqori'?2:a.severity==='O‘rta'?1:0)).map(a=><button type="button" className="list-row is-clickable" key={a.id} onClick={()=>navigate(`/quality?view=alerts&id=${a.id}`)}><span className="list-row-copy"><b>{a.title}</b><small>{a.reason}</small></span><span className="list-row-meta"><StatusBadge>{a.severity}</StatusBadge><StatusBadge>{a.status}</StatusBadge></span></button>)}</div>:<Empty compact icon="check" title="Ochiq NCR yo‘q"/>}
      </Card>
    </div>
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
  </div>
}

function Checks(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[type,setType]=useSearchParamState('type'),[range,setRange]=useSearchParamState('range')
  const [check,setCheck]=useState<string|null>(null),[create,setCreate]=useState(false)
  const since=range?periodStart(Number(range)):''
  const rows=s.qualityChecks.filter(c=>(!status||c.status===status)&&(!type||c.type===type)&&c.date.slice(0,10)>=since)
  return <div className="page-stack">
    <PageHeader title="Tekshiruvlar" subtitle="Incoming, in-process, final" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('quality','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Tekshiruv yaratish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Manba, item, lot, inspector..." onRow={c=>setCheck(c.id)} exportName="quality-checks" resetKey={`${status}|${type}|${range}`}
      filtersActive={Boolean(status||type||range)} onResetFilters={()=>{setStatus('');setType('');setRange('')}}
      filters={<><FilterSelect label="Status" value={status} onChange={setStatus} options={['Pending','Passed','Hold','Failed','Rework','Scrap']}/><FilterSelect label="Tur" value={type} onChange={setType} options={TYPES}/><FilterSelect label="Davr" value={range} onChange={setRange} allLabel="Butun davr" options={RANGE_OPTIONS}/></>}
      rowClassName={c=>c.status==='Failed'||c.status==='Scrap'?'row-danger':c.status==='Pending'?'row-warning':undefined}
      columns={[
        {key:'type',label:'Tur',value:c=>c.type,render:c=><div className="cell-main"><b>{c.type}</b><small>{c.controlPointId?s.qualityControlPoints.find(x=>x.id===c.controlPointId)?.title:'Manual'}</small></div>},
        {key:'source',label:'Manba',value:c=>sourceLabel(s,c.sourceId)},
        {key:'item',label:'Item',value:c=>materialName(s,c.itemId),render:c=><span>{materialName(s,c.itemId)}<small className="cell-sub">{c.lot||''}</small></span>},
        {key:'status',label:'Natija',value:c=>c.status,render:c=><StatusBadge>{c.status}</StatusBadge>},
        {key:'measured',label:'O‘lchov',value:c=>c.measured||'',priority:'low'},
        {key:'inspector',label:'Inspector',value:c=>employeeName(s,c.inspectorId),priority:'low'},
        {key:'date',label:'Sana',value:c=>c.date},
      ]}/>
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
    {create&&<CreateCheckModal onClose={()=>setCreate(false)}/>}
  </div>
}

function CreateCheckModal({onClose}:{onClose:()=>void}){
  const app=useApp(),s=app.state
  // Only open orders can still be inspected; an incoming check belongs to one receipt that has none yet (B3-03).
  const productionSources=s.productionOrders.filter(o=>!['Bekor qilingan','Yakunlangan'].includes(o.status))
  const freeReceipts=(p:typeof s.purchaseOrders[number])=>p.receipts.filter(r=>!s.qualityChecks.some(q=>q.sourceType==='purchase'&&q.receiptId===r.id))
  const purchaseSources=s.purchaseOrders.filter(p=>freeReceipts(p).length>0)
  const form=useForm({type:'Jarayon' as QualityCheck['type'],sourceType:'production' as 'production'|'purchase',sourceId:productionSources[0]?.id||'',receiptId:'',controlPointId:''},v=>({sourceId:v.sourceId?undefined:'Manba tanlang'}))
  const po=s.purchaseOrders.find(p=>p.id===form.values.sourceId)
  const mo=s.productionOrders.find(o=>o.id===form.values.sourceId)
  const receipts=po?freeReceipts(po):[]
  const receipt=receipts.find(r=>r.id===form.values.receiptId)||receipts[0]
  const itemId=form.values.sourceType==='production'?mo?.productId||'':receipt?.materialId||''
  const qcps=s.qualityControlPoints.filter(c=>c.active&&(!c.productId||c.productId===itemId))
  return <Modal open onClose={onClose} title="Tekshiruv yaratish" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createQualityCheck({type:v.type,sourceType:v.sourceType,sourceId:v.sourceId,itemId,controlPointId:v.controlPointId||undefined,lot:v.sourceType==='production'?mo?.lot:receipt?.lot||undefined,receiptId:v.sourceType==='purchase'?receipt?.id:undefined});if(r.ok)onClose();return r.ok})}>Yaratish</button></>}>
    <div className="form-grid">
      <Field label="Manba turi"><Select value={form.values.sourceType} onChange={v=>{form.set('sourceType',v as 'production'|'purchase');form.set('sourceId',v==='production'?productionSources[0]?.id||'':purchaseSources[0]?.id||'');form.set('type',v==='purchase'?'Kirish':'Jarayon')}}><option value="production">Ishlab chiqarish (MO)</option><option value="purchase">Xarid qabuli (PO)</option></Select></Field>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v as QualityCheck['type'])}>{TYPES.map(t=><option key={t} value={t}>{t}</option>)}</Select></Field>
      <Field label="Manba" required error={form.error('sourceId')}><Select value={form.values.sourceId} onChange={v=>form.set('sourceId',v)}>{(form.values.sourceType==='production'?productionSources:purchaseSources).map(x=><option key={x.id} value={x.id}>{x.code}</option>)}</Select></Field>
      {form.values.sourceType==='purchase'?<Field label="Qabul (receipt)"><Select value={receipt?.id||''} onChange={v=>form.set('receiptId',v)}>{receipts.map(r=><option key={r.id} value={r.id}>{materialName(s,r.materialId)} · {r.qty} · {r.date.slice(0,10)}{r.lot?` · ${r.lot}`:''}</option>)}</Select></Field>:<Field label="Mahsulot"><Input readOnly value={productName(s,itemId)}/></Field>}
      <Field className="span-2" label="Control point"><Select value={form.values.controlPointId} onChange={v=>form.set('controlPointId',v)}><option value="">Yo‘q (manual)</option>{qcps.map(c=><option key={c.id} value={c.id}>{c.title} · {c.scope}</option>)}</Select></Field>
    </div>
  </Modal>
}

function Defects(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [check,setCheck]=useState<string|null>(null),[rework,setRework]=useState<QualityCheck|null>(null),[ncr,setNcr]=useState<QualityCheck|null>(null)
  const [range,setRange]=useSearchParamState('range')
  const since=range?periodStart(Number(range)):''
  const rows=s.qualityChecks.filter(q=>isDefect(q)&&q.date.slice(0,10)>=since)
  const byItem=useMemo(()=>{const m=new Map<string,number>();for(const q of rows)m.set(q.itemId,(m.get(q.itemId)||0)+1);return [...m.entries()].sort((a,b)=>b[1]-a[1])},[rows])
  return <div className="page-stack">
    <PageHeader title="Brak / Defects" subtitle={`Failed va Scrap · rework MO yoki NCR · ${rows.length} ta`}/>
    <div className="filter-strip"><FilterSelect label="Davr" value={range} onChange={setRange} allLabel="Butun davr" options={RANGE_OPTIONS}/></div>
    <div className="split-main">
      <Card title="Nuqsonli tekshiruvlar">
        {rows.length?<div className="stack-list">{rows.map(q=>{const alert=s.qualityAlerts.find(a=>a.sourceId===q.sourceId&&a.status!=='Yopilgan');return <div className="list-row" key={q.id}>
          <span className="list-row-copy"><b>{sourceLabel(s,q.sourceId)} · {materialName(s,q.itemId)}</b><small>{q.type} · {q.date} · {q.reason||'Sabab kiritilmagan'}</small></span>
          <span className="list-row-meta"><StatusBadge>{q.status}</StatusBadge>
            <button type="button" className="ghost-btn" onClick={()=>setCheck(q.id)}>Ko‘rish</button>
            {q.sourceType==='production'&&app.can('quality','edit')&&<button type="button" className="soft-glass-btn compact" onClick={()=>setRework(q)}>Rework MO</button>}
            {alert?<button type="button" className="ghost-btn" onClick={()=>navigate(`/quality?view=alerts&id=${alert.id}`)}>NCR</button>:app.can('quality','create')&&<button type="button" className="ghost-btn" onClick={()=>setNcr(q)}>NCR ochish</button>}
          </span></div>})}</div>:<Empty icon="check" title="Nuqson qayd etilmagan"/>}
      </Card>
      <Card title="Itemlar bo‘yicha" subtitle="Pareto">{byItem.length?<BarList rows={byItem.map(([id,n])=>({label:materialName(s,id),value:n,tone:'danger'}))} unit="ta"/>:<Empty compact title="—"/>}</Card>
    </div>
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
    {rework&&<ReworkModal check={rework} onClose={()=>setRework(null)}/>}
    {ncr&&<NcrModal sourceId={ncr.sourceId} defaultTitle={`${sourceLabel(s,ncr.sourceId)} — ${ncr.status==='Scrap'?'scrap':'nuqson'}`} defaultReason={ncr.reason||''} onClose={()=>setNcr(null)}/>}
  </div>
}

function ReworkModal({check,onClose}:{check:QualityCheck;onClose:()=>void}){
  const app=useApp(),s=app.state
  const mo=s.productionOrders.find(o=>o.id===check.sourceId)
  const form=useForm({qty:String(Math.max(1,Math.min(mo?.completed||1,50))),reason:check.reason||''},v=>({qty:positive(v.qty,'Miqdor'),reason:required(v.reason,'Sabab')}))
  return <Modal open onClose={onClose} title="Rework buyurtmasi" eyebrow={mo?.code} subtitle="Faqat operatsiyalar · keyin qayta tekshiruv" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createReworkOrder(check.sourceId,Number(v.qty),v.reason);if(r.ok)onClose();return r.ok})}>Rework MO yaratish</button></>}>
    <div className="form-stack"><Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="1" {...form.input('qty')}/></Field><Field label="Sabab" required error={form.error('reason')}><Textarea {...form.input('reason')}/></Field></div>
  </Modal>
}

function Rework(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [rework,setRework]=useState<QualityCheck|null>(null)
  const [range,setRange]=useSearchParamState('range')
  const pending=s.qualityChecks.filter(awaitsRework)
  const orders=reworkOrders(s,Number(range)||0)
  return <div className="page-stack">
    <PageHeader title="Rework" subtitle="Rework MO → qayta tekshiruv"/>
    <div className="filter-strip"><FilterSelect label="Davr" value={range} onChange={setRange} allLabel="Butun davr" options={RANGE_OPTIONS}/></div>
    <div className="two-col">
      <Card title="Rework talab qiladi">{pending.length?<div className="stack-list">{pending.map(q=><div className="list-row" key={q.id}><span className="list-row-copy"><b>{sourceLabel(s,q.sourceId)} · {materialName(s,q.itemId)}</b><small>{q.reason||'—'}</small></span><span className="list-row-meta"><StatusBadge>{q.status}</StatusBadge>{app.can('quality','edit')&&<button type="button" className="soft-glass-btn compact" onClick={()=>setRework(q)}>Rework MO</button>}</span></div>)}</div>:<Empty compact icon="check" title="Rework navbati bo‘sh"/>}</Card>
      <Card title="Rework buyurtmalari" subtitle={`${orders.length} MO · ${num(orders.reduce((a,o)=>a+o.quantity,0))} birlik${range?' · yaratilgan sana bo‘yicha':''}`}>{orders.length?<div className="stack-list">{orders.map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{o.source} · {num(o.completed)}/{num(o.quantity)} · {o.createdAt.slice(0,10)}</small></span><StatusBadge>{o.status}</StatusBadge></button>)}</div>:<Empty compact title={range?'Bu davrda rework MO yaratilmagan':'Rework MO yo‘q'}/>}</Card>
    </div>
    {rework&&<ReworkModal check={rework} onClose={()=>setRework(null)}/>}
  </div>
}

function Scrap(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [range,setRange]=useSearchParamState('range')
  // Whole history: the order totals. A period: the dated scrap postings inside it.
  const events=useMemo(()=>scrapEvents(s,Number(range)||0),[s,range])
  const scrapOf=(o:{id:string;scrap:number})=>range?events.filter(e=>e.orderId===o.id).reduce((a,e)=>a+e.qty,0):o.scrap
  const scrapOrders=s.productionOrders.map(o=>({...o,scrap:scrapOf(o)})).filter(o=>o.scrap>0)
  const total=scrapOrders.reduce((a,o)=>a+o.scrap,0)
  // Output the scrap is measured against: all reported units, or the period's finished receipts + its scrap.
  const produced=range?outputByDay(s,Number(range)).reduce((a,d)=>a+d.produced,0)+total:s.productionOrders.reduce((a,o)=>a+o.completed+o.scrap,0)
  const reasons=useMemo(()=>{const m=new Map<string,number>();for(const e of events)m.set(e.reason,(m.get(e.reason)||0)+e.qty);return [...m.entries()].sort((a,b)=>b[1]-a[1])},[events])
  const cost=scrapOrders.reduce((a,o)=>a+o.scrap*(s.products.find(p=>p.id===o.productId)?.standardCost||0),0)
  return <div className="page-stack">
    <PageHeader title="Scrap" subtitle="Sabablar, buyurtmalar va yo‘qotish"/>
    <div className="filter-strip"><FilterSelect label="Davr" value={range} onChange={setRange} allLabel="Butun davr" options={RANGE_OPTIONS}/></div>
    <div className="kpi-grid cols-3">
      <KPI label="Scrap birliklar" value={num(total)} sub={`${produced?(total/produced*100).toFixed(2):0}% outputdan${range?` · ${RANGE_OPTIONS.find(r=>r.value===range)?.label||`${range} kun`}`:''}`} tone="pink" icon={<Icon name="trash"/>}/>
      {app.can('costs')&&<KPI label="Yo‘qotish" value={compactMoney(cost)} sub="standart tannarx" tone="orange" icon={<Icon name="wallet"/>}/>}
      <KPI label="Scrapli MOlar" value={scrapOrders.length} icon={<Icon name="factory"/>}/>
    </div>
    <div className="two-col">
      <Card title="Sabablar (Pareto)">{reasons.length?<BarList rows={reasons.map(([r,n])=>({label:r,value:n,tone:'danger'}))} unit="dona"/>:<Empty compact title="Sabab qayd etilmagan"/>}</Card>
      <Card title="Buyurtmalar bo‘yicha">{scrapOrders.length?<div className="stack-list">{scrapOrders.map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{range?`${num(o.scrap)} scrap`:`${num(o.scrap)} / ${num(o.completed+o.scrap)} (${((o.scrap/Math.max(1,o.completed+o.scrap))*100).toFixed(1)}%)`}</small></span><StatusBadge>{o.status}</StatusBadge></button>)}</div>:<Empty compact icon="check" title={range?'Bu davrda scrap yo‘q':'Scrap yo‘q'}/>}</Card>
    </div>
  </div>
}

function NcrModal({sourceId,defaultTitle='',defaultReason='',onClose}:{sourceId?:string;defaultTitle?:string;defaultReason?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const sources=[...s.productionOrders.map(o=>({id:o.id,label:`${o.code} · ${productName(s,o.productId)}`})),...s.purchaseOrders.map(p=>({id:p.id,label:`${p.code} · xarid`}))]
  const form=useForm({title:defaultTitle,sourceId:sourceId||sources[0]?.id||'',severity:'O‘rta' as QualityAlert['severity'],reason:defaultReason,ownerId:s.employees.find(e=>e.department==='Quality')?.id||app.currentEmployee.id},v=>({title:required(v.title,'Sarlavha'),reason:required(v.reason,'Tavsif')}))
  return <Modal open onClose={onClose} title="NCR ochish" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createQualityAlert(v);if(r.ok)onClose();return r.ok})}>NCR ochish</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Sarlavha" required error={form.error('title')}><Input {...form.input('title')} autoFocus/></Field>
      <Field label="Manba"><Select value={form.values.sourceId} onChange={v=>form.set('sourceId',v)}>{sources.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
      <Field label="Severity"><Select value={form.values.severity} onChange={v=>form.set('severity',v as QualityAlert['severity'])}>{['Past','O‘rta','Yuqori'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Mas’ul"><Select value={form.values.ownerId} onChange={v=>form.set('ownerId',v)}>{s.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field className="span-2" label="Nomuvofiqlik tavsifi" required error={form.error('reason')}><Textarea {...form.input('reason')}/></Field>
    </div>
  </Modal>
}

function Alerts(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[severity,setSeverity]=useSearchParamState('severity')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false)
  const rows=s.qualityAlerts.filter(a=>(!status||a.status===status)&&(!severity||a.severity===severity))
  const alert=s.qualityAlerts.find(a=>a.id===id)
  return <div className="page-stack">
    <PageHeader title="Quality Alerts / NCR" subtitle="Root cause → corrective → preventive → verification" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('quality','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>NCR ochish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Sarlavha, sabab, manba..." onRow={a=>setId(a.id)} exportName="quality-alerts" resetKey={`${status}|${severity}`}
      filtersActive={Boolean(status||severity)} onResetFilters={()=>{setStatus('');setSeverity('')}}
      filters={<><FilterSelect label="Status" value={status} onChange={setStatus} options={['Ochiq','Jarayonda','Yopilgan']}/><FilterSelect label="Severity" value={severity} onChange={setSeverity} options={['Past','O‘rta','Yuqori']}/></>}
      rowClassName={a=>a.status!=='Yopilgan'&&a.severity==='Yuqori'?'row-danger':undefined}
      columns={[
        {key:'title',label:'NCR',value:a=>a.title,render:a=><div className="cell-main"><b>{a.title}</b><small>{a.reason}</small></div>},
        {key:'severity',label:'Severity',value:a=>a.severity,render:a=><StatusBadge>{a.severity}</StatusBadge>},
        {key:'status',label:'Status',value:a=>a.status,render:a=><StatusBadge>{a.status}</StatusBadge>},
        {key:'root',label:'Root cause',value:a=>a.rootCause||'',render:a=><span className="truncate">{a.rootCause||<span className="muted">Kutilmoqda</span>}</span>,priority:'low'},
        {key:'owner',label:'Mas’ul',value:a=>employeeName(s,a.ownerId)},
        {key:'created',label:'Ochilgan',value:a=>a.createdAt},
      ]}/>
    {create&&<NcrModal onClose={()=>setCreate(false)}/>}
    {alert&&<CapaDrawer key={alert.id} alert={alert} onClose={()=>setId(null)}/>}
  </div>
}

function CapaDrawer({alert,onClose}:{alert:QualityAlert;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [confirmClose,setConfirmClose]=useState(false)
  const canEdit=app.can('quality','edit')
  const form=useForm({rootCause:alert.rootCause||'',correctiveAction:alert.correctiveAction||'',preventiveAction:alert.preventiveAction||'',resolution:alert.resolution||'',ownerId:alert.ownerId,severity:alert.severity},v=>({rootCause:required(v.rootCause,'Root cause'),correctiveAction:required(v.correctiveAction,'Corrective action'),preventiveAction:required(v.preventiveAction,'Preventive action'),resolution:required(v.resolution,'Verification')}))
  const closed=alert.status==='Yopilgan'
  const save=()=>{const v=form.values;const r=app.updateEntity('qualityAlerts',alert.id,{rootCause:v.rootCause,correctiveAction:v.correctiveAction,preventiveAction:v.preventiveAction,resolution:v.resolution,ownerId:v.ownerId,severity:v.severity,status:alert.status==='Ochiq'&&(v.rootCause||v.correctiveAction)?'Jarayonda':alert.status});if(r.ok)form.reset(v);return r.ok}
  return <Drawer open onClose={onClose} title={alert.title} eyebrow="NCR / CAPA" icon="shield" subtitle={`${sourceLabel(s,alert.sourceId)} · ochilgan ${alert.createdAt}`} size="lg" headerExtra={<><StatusBadge>{alert.status}</StatusBadge><StatusBadge>{alert.severity}</StatusBadge></>}
    actions={canEdit?closed?<button type="button" className="secondary-glass-btn" onClick={()=>app.updateEntity('qualityAlerts',alert.id,{status:'Jarayonda'})}><Icon name="undo" size={15}/>Qayta ochish</button>:<><button type="button" className="secondary-glass-btn" disabled={!form.dirty} onClick={save}>Saqlash</button><span className="spacer"/><button type="button" className="primary-glass-btn" onClick={()=>form.submit(()=>{setConfirmClose(true);return true})}><Icon name="check" size={16}/>CAPA’ni yopish</button></>:undefined}>
    <div className="inline-note warning"><Icon name="warning"/>{alert.reason}</div>
    <div className="form-grid">
      <Field label="Mas’ul"><Select value={form.values.ownerId} disabled={!canEdit||closed} onChange={v=>form.set('ownerId',v)}>{s.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Severity"><Select value={form.values.severity} disabled={!canEdit||closed} onChange={v=>form.set('severity',v as QualityAlert['severity'])}>{['Past','O‘rta','Yuqori'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field className="span-2" label="1. Root cause (5 Why)" required error={form.error('rootCause')}><Textarea disabled={!canEdit||closed} {...form.input('rootCause')}/></Field>
      <Field className="span-2" label="2. Corrective action" required error={form.error('correctiveAction')}><Textarea disabled={!canEdit||closed} {...form.input('correctiveAction')}/></Field>
      <Field className="span-2" label="3. Preventive action" required error={form.error('preventiveAction')}><Textarea disabled={!canEdit||closed} {...form.input('preventiveAction')}/></Field>
      <Field className="span-2" label="4. Verification / effectiveness" required error={form.error('resolution')}><Textarea disabled={!canEdit||closed} {...form.input('resolution')}/></Field>
    </div>
    <SectionTitle title="Audit tarixi"/><ActivityPanel sources={[alert.title,sourceLabel(s,alert.sourceId)]}/>
    <Confirm open={confirmClose} onClose={()=>setConfirmClose(false)} onConfirm={()=>{const v=form.values;if(app.updateEntity('qualityAlerts',alert.id,{...v,status:'Yopilgan'}).ok)onClose()}} title="CAPA yopilsinmi?" text="NCR “Yopilgan” holatiga o‘tadi. Kerak bo‘lsa keyin qayta ochish mumkin." confirmText="Yopish"/>
  </Drawer>
}

function CapaBoard(){
  const s=useApp().state,navigate=useNavigate()
  const cols:QualityAlert['status'][]=['Ochiq','Jarayonda','Yopilgan']
  const steps=(a:QualityAlert)=>[a.rootCause,a.correctiveAction,a.preventiveAction,a.resolution].filter(Boolean).length
  return <div className="page-stack">
    <PageHeader title="CAPA" subtitle="NCR’lar bosqich bo‘yicha"/>
    <div className="kanban">{cols.map(c=>{const items=s.qualityAlerts.filter(a=>a.status===c);return <section key={c} className="kanban-col"><header><b>{c}</b><span className="tab-count">{items.length}</span></header>
      {items.length?items.map(a=><button type="button" key={a.id} className="kanban-card" onClick={()=>navigate(`/quality?view=alerts&id=${a.id}`)}><b>{a.title}</b><small>{a.reason}</small><div className="kanban-meta"><StatusBadge>{a.severity}</StatusBadge><span className="soft-meta">CAPA {steps(a)}/4</span></div><div className="capa-steps" aria-label={`CAPA ${steps(a)} / 4`}>{[0,1,2,3].map(i=><i key={i} className={i<steps(a)?'done':''}/>)}</div></button>):<Empty compact title="Bo‘sh"/>}
    </section>})}</div>
  </div>
}

function ControlPoints(){
  const app=useApp(),s=app.state
  const [edit,setEdit]=useState<QualityControlPoint|null|'new'>(null),[remove,setRemove]=useState<QualityControlPoint|null>(null)
  const canEdit=app.can('quality','edit')
  return <div className="page-stack">
    <PageHeader title="Control Points" subtitle="Faol QCP tekshiruvni avtomatik yaratadi" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('quality','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Control point</button>}/>
    <div className="card flush"><div className="table-scroll"><table className="qcp-table"><thead><tr><th>Control point</th><th>Bosqich</th><th>Item</th><th>Tur</th><th>Chastota</th><th className="align-right">Namuna</th><th className="align-right">Tekshiruv</th><th>Faol</th>{canEdit&&<th className="action-col"><span className="sr-only">Amal</span></th>}</tr></thead><tbody>
      {s.qualityControlPoints.map(c=><tr key={c.id} className={c.active?undefined:'row-muted'}>
        <td><div className="cell-main"><b>{c.title}</b><small title={c.instructions}>{c.instructions}</small></div></td>
        <td><StatusBadge tone={c.scope==='Final'?'purple':c.scope==='Incoming'?'info':'mfg'}>{c.scope}</StatusBadge>{c.operationName&&<small className="cell-sub">{c.operationName}</small>}</td>
        <td>{c.productId?materialName(s,c.productId):<span className="muted">Barcha itemlar</span>}</td>
        <td>{c.checkType}</td>
        <td>{c.frequency}</td>
        <td className="align-right">{c.sampleRate}%</td>
        <td className="align-right">{s.qualityChecks.filter(x=>x.controlPointId===c.id).length}</td>
        <td><Toggle checked={c.active} disabled={!canEdit} disabledReason="quality.edit ruxsati kerak" onChange={active=>app.updateEntity('qualityControlPoints',c.id,{active})} label={c.active?'Faol':'O‘chiq'}/></td>
        {canEdit&&<td className="action-col"><div className="cell-actions"><button type="button" className="icon-ghost" aria-label={`${c.title} — tahrirlash`} onClick={()=>setEdit(c)}><Icon name="edit" size={15}/></button><button type="button" className="icon-ghost danger" aria-label={`${c.title} — o‘chirish`} onClick={()=>setRemove(c)}><Icon name="trash" size={15}/></button></div></td>}
      </tr>)}
    </tbody></table></div></div>
    {edit&&<QcpModal qcp={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
    <Confirm open={!!remove} onClose={()=>setRemove(null)} onConfirm={()=>remove&&app.deleteEntity('qualityControlPoints',remove.id)} danger title="Control point o‘chirilsinmi?" text="Mavjud tekshiruvlar saqlanadi, yangilari avtomatik yaratilmaydi." confirmText="O‘chirish"/>
  </div>
}

function QcpModal({qcp,onClose}:{qcp?:QualityControlPoint;onClose:()=>void}){
  const app=useApp(),s=app.state
  const items=[...s.products.map(p=>({id:p.id,label:`${p.name} (mahsulot)`})),...s.rawMaterials.map(m=>({id:m.id,label:`${m.name} (xomashyo)`}))]
  const operations=[...new Set(s.boms.filter(b=>b.status==='Faol').flatMap(b=>b.operations.map(o=>o.name)))]
  const form=useForm({title:qcp?.title||'',scope:qcp?.scope||'Final',productId:qcp?.productId||'',operationName:qcp?.operationName||'',frequency:qcp?.frequency||'Every time',sampleRate:String(qcp?.sampleRate??100),checkType:qcp?.checkType||'Pass-Fail',instructions:qcp?.instructions||'',active:qcp?.active??true},v=>({title:required(v.title,'Nomi'),instructions:required(v.instructions,'Ko‘rsatma'),sampleRate:Number(v.sampleRate)>0&&Number(v.sampleRate)<=100?undefined:'1–100%'}))
  return <Modal open onClose={onClose} title={qcp?'Control point tahrirlash':'Yangi control point'} size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const payload={...v,productId:v.productId||undefined,operationName:v.scope==='In-process'?v.operationName||undefined:undefined,sampleRate:Number(v.sampleRate)};const r=qcp?app.updateEntity('qualityControlPoints',qcp.id,payload):app.createEntity('qualityControlPoints',payload);if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('title')}><Input {...form.input('title')} autoFocus/></Field>
      <Field label="Bosqich"><Select value={form.values.scope} onChange={v=>form.set('scope',v as QualityControlPoint['scope'])}>{[['Incoming','Incoming (qabul)'],['In-process','In-process (operatsiya)'],['Final','Final']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Item"><Select value={form.values.productId} onChange={v=>form.set('productId',v)}><option value="">Barcha itemlar</option>{items.map(i=><option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
      {form.values.scope==='In-process'&&<Field label="Operatsiya"><Select value={form.values.operationName} onChange={v=>form.set('operationName',v)}><option value="">Istalgan QC operatsiya</option>{operations.map(o=><option key={o} value={o}>{o}</option>)}</Select></Field>}
      <Field label="Tekshiruv turi"><Select value={form.values.checkType} onChange={v=>form.set('checkType',v as QualityControlPoint['checkType'])}>{['Instructions','Measure','Pass-Fail','Photo'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Chastota"><Select value={form.values.frequency} onChange={v=>form.set('frequency',v as QualityControlPoint['frequency'])}>{['Every time','Random','Periodic','On demand'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Namuna %" error={form.error('sampleRate')}><Input type="number" min="1" max="100" {...form.input('sampleRate')}/></Field>
      <Field className="span-2" label="Ko‘rsatma" required error={form.error('instructions')}><Textarea {...form.input('instructions')}/></Field>
    </div>
  </Modal>
}
