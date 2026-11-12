import {useEffect,useState} from 'react'
import type {ReactNode} from 'react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,FilterSelect,Icon,InfoGrid,KPI,PageHeader,StatusBadge,useSearchParamState} from '../../../shared/ui'
import type {ManufacturingState} from '../../../types'
import {buildTraceability,calculateCapacityLoads,downtimeByReason,findTraceOrder,orderCosting,productionOee,stockOf,workCenterOee} from '../../../domain/manufacturingEngine'
import {profitabilityByProduct} from '../../../domain/profitability'
import {addDays,daysBetween,displayStamp,shortDate,todayISO} from '../../../utils/dates'
import {compactMoney,money,num} from '../../../utils/format'
import {exportRows} from '../../../utils/exportData'
import type {ExportFormat,FlatRow} from '../../../utils/exportData'
import {customerName,materialName,productName,supplierName,warehouseName} from '../../common/lookups'
import {SERIAL_STATUS_LABEL,isSerialUnit,serialStatus} from '../../../domain/serials'
import {BarList,ColumnChart,Gauge,StackedBar} from '../../common/charts'

type S=ManufacturingState
export default function Reports(){
  const [sp]=useSearchParams(),view=sp.get('view')||'overview'
  if(view==='traceability')return <Traceability/>
  if(view==='overview')return <Catalog/>
  return <PeriodReport view={view}/>
}

const CATALOG:Array<[string,string,string,string]>=[
  ['production','factory','Ishlab chiqarish','Kunlik output, reja bajarilishi, o‘z vaqtida yakunlash'],
  ['costs','wallet','Tannarx va variance','Material, mehnat, uskuna, overhead; reja vs amalda'],
  ['quality','shield','Sifat','Pass rate, first pass yield, nuqson sabablari'],
  ['inventory','warehouse','Ombor','Zaxira qiymati, ombor bo‘yicha, lot yoshi'],
  ['efficiency','chart','Samaradorlik','Work center yuklamasi va samaradorligi'],
  ['oee','gauge','OEE','Availability × Performance × Quality, yo‘qotishlar'],
  ['profitability','tag','Profitability','Mahsulot bo‘yicha tushum, tannarx, marja'],
  ['traceability','barcode','Traceability','Lot/serial → MO → xarid → mijoz zanjiri'],
]

function Catalog(){
  const navigate=useNavigate()
  return <div className="page-stack">
    <PageHeader title="Hisobotlar" subtitle="Davr filtri · Excel, CSV, PDF eksport"/>
    <div className="card flush"><div className="report-list">{CATALOG.map(([key,icon,title,desc])=><button type="button" key={key} className="report-row" onClick={()=>navigate(`/reports?view=${key}`)}>
      <span className="report-icon"><Icon name={icon} size={16}/></span><span><b>{title}</b><small>{desc}</small></span><Icon name="chevron" size={14}/>
    </button>)}</div></div>
  </div>
}

type Report={title:string;subtitle:string;rows:FlatRow[];body:ReactNode}

function ExportButtons({name,rows}:{name:string;rows:FlatRow[]}){
  const app=useApp()
  const allowed=app.can('reports','export')
  const reason=!allowed?'Eksport uchun reports.export ruxsati kerak':!rows.length?'Eksport uchun ma’lumot yo‘q':undefined
  // The file holds exactly the rows of the report for the chosen period; nothing is saved for an empty result.
  const run=(format:ExportFormat)=>{const r=exportRows(format,name,rows);app.toast(r.message,r.ok?'success':'warning')}
  return <div className="export-actions no-print" role="group" aria-label="Eksport">
    <button type="button" className="secondary-glass-btn compact" disabled={Boolean(reason)} title={reason||`${rows.length} qator · .xlsx`} onClick={()=>run('xlsx')}><Icon name="download" size={15}/>Excel (.xlsx)</button>
    <button type="button" className="secondary-glass-btn compact" disabled={Boolean(reason)} title={reason||`${rows.length} qator · UTF-8`} onClick={()=>run('csv')}><Icon name="download" size={15}/>CSV</button>
    <button type="button" className="secondary-glass-btn compact" disabled={!allowed} title={!allowed?reason:'Brauzerning chop etish oynasi ochiladi — PDF uchun “PDF sifatida saqlash”ni tanlang'} onClick={()=>window.print()}><Icon name="printer" size={15}/>Print / PDF saqlash</button>
  </div>
}

function PeriodReport({view}:{view:string}){
  const app=useApp(),s=app.state
  const [days,setDays]=useSearchParamState('days','30')
  const period=Number(days)||30
  const since=addDays(todayISO(),-period+1)
  const report=buildReport(view,s,since,period)
  return <div className="page-stack print-area">
    <PageHeader title={report.title} subtitle={report.subtitle} actions={<ExportButtons name={`zenix-${view}-${todayISO()}`} rows={report.rows}/>}/>
    <div className="filter-strip no-print"><FilterSelect label="Davr" value={days} onChange={setDays} defaultValue="30" options={[{value:'1',label:'Bugun'},{value:'7',label:'7 kun'},{value:'14',label:'14 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'}]}/><span className="soft-meta">{since===todayISO()?since:`${since} — ${todayISO()}`}</span></div>
    {report.body}
  </div>
}

function buildReport(view:string,s:S,since:string,period:number):Report{
  const inPeriod=(d?:string)=>Boolean(d)&&d!.slice(0,10)>=since
  if(view==='production'){
    const daysList=Array.from({length:Math.min(period,31)},(_,i)=>addDays(todayISO(),-Math.min(period,31)+1+i))
    const output=daysList.map(d=>({label:shortDate(d),value:s.stockMovements.filter(m=>m.type==='Production +'&&m.date.startsWith(d)&&!m.note.includes('By-product')).reduce((a,m)=>a+m.qty,0),detail:d}))
    const completed=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&inPeriod(o.completedAt))
    const onTime=completed.filter(o=>(o.completedAt||'').slice(0,10)<=o.due).length
    const byProduct=s.products.map(p=>({p,qty:output.length?s.stockMovements.filter(m=>m.type==='Production +'&&m.itemId===p.id&&inPeriod(m.date)).reduce((a,m)=>a+m.qty,0):0})).filter(x=>x.qty>0)
    return {title:'Ishlab chiqarish hisoboti',subtitle:'Tayyor kirim va yakunlangan MOlar',
      rows:completed.map(o=>({MO:o.code,Mahsulot:productName(s,o.productId),Reja:o.quantity,Tayyor:o.completed,Scrap:o.scrap,Due:o.due,Yakunlangan:o.completedAt||'',Vaqtida:(o.completedAt||'').slice(0,10)<=o.due?'Ha':'Yo‘q',Lot:o.lot||o.serialRange||''})),
      body:<>
        <div className="kpi-grid"><KPI label="Ishlab chiqarildi" value={num(output.reduce((a,d)=>a+d.value,0))} sub="dona" icon={<Icon name="factory"/>}/><KPI label="Yakunlangan MO" value={completed.length} tone="mint" icon={<Icon name="check"/>}/><KPI label="Vaqtida yakunlash" value={completed.length?`${Math.round(onTime/completed.length*100)}%`:'—'} sub={`${onTime}/${completed.length}`} tone="purple" icon={<Icon name="clock"/>}/><KPI label="Yield" value={completed.length?`${(completed.reduce((a,o)=>a+o.completed,0)/Math.max(1,completed.reduce((a,o)=>a+o.completed+o.scrap,0))*100).toFixed(1)}%`:'—'} sub="Yaroqli / jami" tone="orange" icon={<Icon name="target"/>}/></div>
        <div className="split-main"><Card title="Kunlik output"><ColumnChart title="Kunlik output" data={output} valueLabel="Ishlab chiqarildi" unit="dona"/></Card><Card title="Mahsulot bo‘yicha">{byProduct.length?<BarList rows={byProduct.map(x=>({label:x.p.name,value:x.qty}))} unit="dona"/>:<Empty compact title="Output yo‘q"/>}</Card></div>
      </>}
  }
  if(view==='costs'){
    const done=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&inPeriod(o.completedAt)).map(o=>({o,c:orderCosting(s,o)}))
    const sum=(k:'material'|'labor'|'machine'|'overhead')=>done.reduce((a,x)=>a+x.c.actual[k],0)
    const total=done.reduce((a,x)=>a+x.c.actual.total,0),planned=done.reduce((a,x)=>a+x.c.planned.total,0)
    return {title:'Tannarx va variance',subtitle:'Yakunlangan MO: amalda vs reja',
      rows:done.map(({o,c})=>({MO:o.code,Mahsulot:productName(s,o.productId),Tayyor:o.completed,Material:Math.round(c.actual.material),Mehnat:Math.round(c.actual.labor),Uskuna:Math.round(c.actual.machine),Overhead:Math.round(c.actual.overhead),Jami:Math.round(c.actual.total),Reja:Math.round(c.planned.total),'Variance %':c.variancePct,'Birlik tannarx':Math.round(c.unitCost)})),
      body:<>
        <div className="kpi-grid"><KPI label="Amaldagi tannarx" value={compactMoney(total)} icon={<Icon name="wallet"/>}/><KPI label="Reja" value={compactMoney(planned)} tone="purple" icon={<Icon name="chart"/>}/><KPI label="Variance" value={`${total-planned>0?'+':''}${compactMoney(total-planned)}`} sub={planned?`${((total-planned)/planned*100).toFixed(1)}%`:'—'} tone={total>planned?'pink':'mint'} icon={<Icon name="activity"/>}/><KPI label="MOlar" value={done.length} tone="orange" icon={<Icon name="factory"/>}/></div>
        <div className="two-col"><Card title="Tannarx tarkibi"><StackedBar title="Tannarx tarkibi" segments={[{label:'Material',value:Math.round(sum('material')),slot:1},{label:'Mehnat',value:Math.round(sum('labor')),slot:2},{label:'Uskuna',value:Math.round(sum('machine')),slot:3},{label:'Overhead',value:Math.round(sum('overhead')),slot:4}]} format={compactMoney}/></Card>
          <Card title="Variance bo‘yicha">{done.length?<div className="stack-list">{done.sort((a,b)=>b.c.variancePct-a.c.variancePct).map(({o,c})=><div className="list-row" key={o.id}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{money(c.actual.total)} · birlik {money(c.unitCost)}</small></span><b className={c.variancePct>0?'negative':'positive'}>{c.variancePct>0?'+':''}{c.variancePct}%</b></div>)}</div>:<Empty compact title="Ma’lumot yo‘q"/>}</Card></div>
      </>}
  }
  if(view==='quality'){
    const checks=s.qualityChecks.filter(q=>q.status!=='Pending'&&inPeriod(q.date))
    const count=(st:string)=>checks.filter(q=>q.status===st).length
    const finals=checks.filter(q=>q.type==='Final')
    const orders=new Set(finals.map(q=>q.sourceId))
    const fpy=orders.size?[...orders].filter(id=>!s.qualityChecks.some(q=>q.sourceId===id&&['Failed','Rework','Scrap'].includes(q.status))).length/orders.size*100:0
    const reasons=new Map<string,number>()
    for(const q of checks.filter(q=>q.status!=='Passed'))reasons.set(q.reason||'Sabab yo‘q',(reasons.get(q.reason||'Sabab yo‘q')||0)+1)
    return {title:'Sifat hisoboti',subtitle:'Natijalar, FPY va nuqson sabablari',
      rows:checks.map(q=>({Sana:q.date,Tur:q.type,Manba:q.sourceType,Item:materialName(s,q.itemId),Lot:q.lot||'',Natija:q.status,Sabab:q.reason||'','O‘lchov':q.measured||''})),
      body:<>
        <div className="kpi-grid"><KPI label="Tekshiruvlar" value={checks.length} icon={<Icon name="shield"/>}/><KPI label="Pass rate" value={checks.length?`${Math.round(count('Passed')/checks.length*100)}%`:'—'} tone="mint" icon={<Icon name="check"/>}/><KPI label="First pass yield" value={orders.size?`${Math.round(fpy)}%`:'—'} sub="Nuqsonsiz MO" tone="purple" icon={<Icon name="target"/>}/><KPI label="Ochiq NCR" value={s.qualityAlerts.filter(a=>a.status!=='Yopilgan').length} tone="pink" icon={<Icon name="warning"/>}/></div>
        <div className="two-col"><Card title="Natijalar taqsimoti"><StackedBar title="Natijalar" segments={[{label:'Passed',value:count('Passed'),slot:3},{label:'Failed',value:count('Failed'),slot:2},{label:'Rework',value:count('Rework'),slot:4},{label:'Scrap',value:count('Scrap'),slot:5}]}/></Card>
          <Card title="Nuqson sabablari">{reasons.size?<BarList rows={[...reasons.entries()].sort((a,b)=>b[1]-a[1]).map(([r,n])=>({label:r,value:n,tone:'danger'}))} unit="ta"/>:<Empty compact icon="check" title="Nuqson yo‘q"/>}</Card></div>
      </>}
  }
  if(view==='inventory'){
    const cost=(id:string)=>s.rawMaterials.find(m=>m.id===id)?.standardCost??s.products.find(p=>p.id===id)?.standardCost??0
    const byWh=s.warehouses.map(w=>({w,value:s.stockBalances.filter(b=>b.warehouseId===w.id).reduce((a,b)=>a+b.onHand*cost(b.itemId),0)}))
    const lots=s.lots.filter(l=>l.qty>0)
    const aging=[['0–7 kun',0,7],['8–30 kun',8,30],['31–90 kun',31,90],['90+ kun',91,9999]].map(([label,a,b])=>({label:String(label),value:lots.filter(l=>{const d=daysBetween(l.createdAt,todayISO());return d>=Number(a)&&d<=Number(b)}).reduce((x,l)=>x+l.qty*cost(l.itemId),0)}))
    const moves=s.stockMovements.filter(m=>inPeriod(m.date))
    return {title:'Ombor hisoboti',subtitle:'Qiymat, ombor bo‘yicha, lot yoshi',
      rows:s.stockBalances.map(b=>({Ombor:warehouseName(s,b.warehouseId),Item:materialName(s,b.itemId),'On hand':Math.round(b.onHand*100)/100,Rezerv:Math.round(b.reserved*100)/100,Available:Math.round((b.onHand-b.reserved)*100)/100,"Yo‘lda":b.incoming,Qiymat:Math.round(b.onHand*cost(b.itemId))})),
      body:<>
        <div className="kpi-grid"><KPI label="Zaxira qiymati" value={compactMoney(byWh.reduce((a,x)=>a+x.value,0))} icon={<Icon name="wallet"/>}/><KPI label="Faol lotlar" value={lots.length} tone="purple" icon={<Icon name="barcode"/>}/><KPI label="Kirim harakatlari" value={moves.filter(m=>m.qty>0).length} tone="mint" icon={<Icon name="download"/>}/><KPI label="Chiqim harakatlari" value={moves.filter(m=>m.qty<0).length} tone="orange" icon={<Icon name="upload"/>}/></div>
        <div className="two-col"><Card title="Ombor bo‘yicha qiymat"><BarList rows={byWh.map(x=>({label:x.w.name,sub:x.w.type,value:x.value}))} valueFormat={v=>compactMoney(v)}/></Card><Card title="Lot yoshi (qiymat)"><BarList rows={aging} valueFormat={v=>compactMoney(v)}/></Card></div>
      </>}
  }
  if(view==='efficiency'){
    const loads=calculateCapacityLoads(s,7)
    return {title:'Samaradorlik hisoboti',subtitle:'Work center yuklamasi va OEE',
      rows:loads.map(l=>{const o=workCenterOee(s,l.workCenter.id,period);return {'Work center':l.workCenter.name,'Yuklama %':l.utilization,'Ochiq ish (min)':l.loadMinutes,'OEE %':o.oee,'Availability %':o.availability,'Performance %':o.performance,'Quality %':o.quality,'Samaradorlik %':l.workCenter.efficiency}}),
      body:<div className="split-main"><Card className="flush" title="Work center bo‘yicha"><div className="table-scroll"><table><thead><tr><th>Work center</th><th className="align-right">7 kun yuklama</th><th className="align-right">OEE</th><th className="align-right">Samaradorlik</th><th className="align-right">Downtime</th></tr></thead><tbody>{loads.map(l=>{const o=workCenterOee(s,l.workCenter.id,period);return <tr key={l.workCenter.id} className={l.utilization>100?'row-danger':undefined}><td><div className="cell-main"><b>{l.workCenter.name}</b><small>{l.workCenter.code}</small></div></td><td className="align-right"><b className={l.utilization>100?'negative':undefined}>{l.utilization}%</b></td><td className="align-right">{o.plannedMinutes?`${o.oee}%`:'—'}</td><td className="align-right">{l.workCenter.efficiency}%</td><td className="align-right">{o.downtimeMinutes} min</td></tr>})}</tbody></table></div></Card>
        <Card title="Yuklama" subtitle="7 kun · chiziq = 100%"><BarList rows={loads.map(l=>({label:l.workCenter.name,value:Math.min(150,l.utilization),tone:l.utilization>100?'danger':l.utilization>85?'warning':'success'}))} unit="%" max={150} threshold={100}/></Card></div>}
  }
  if(view==='oee'){
    const overall=productionOee(s,period)
    const rows=s.workCenters.map(w=>({w,o:workCenterOee(s,w.id,period)}))
    const reasons=downtimeByReason(s,period)
    return {title:'OEE dashboard',subtitle:'Availability × Performance × Quality',
      rows:rows.map(({w,o})=>({'Work center':w.name,'OEE %':o.oee,'Availability %':o.availability,'Performance %':o.performance,'Quality %':o.quality,'Run min':o.runMinutes,'Downtime min':o.downtimeMinutes,Jami:o.totalCount,Yaroqli:o.goodCount})),
      body:<>
        <div className="oee-hero"><Card className="oee-main"><Gauge value={overall.oee} label="Umumiy OEE" sub={`${period} kun`}/></Card><KPI label="Availability" value={`${overall.availability}%`} icon={<Icon name="clock"/>}/><KPI label="Performance" value={`${overall.performance}%`} tone="purple" icon={<Icon name="activity"/>}/><KPI label="Quality" value={`${overall.quality}%`} tone="mint" icon={<Icon name="shield"/>}/></div>
        <div className="split-main"><Card title="Work center bo‘yicha" className="flush"><div className="table-scroll"><table><thead><tr><th>Work center</th><th className="align-right">OEE</th><th className="align-right">A</th><th className="align-right">P</th><th className="align-right">Q</th><th className="align-right">Downtime</th></tr></thead><tbody>{rows.map(({w,o})=><tr key={w.id}><td><b>{w.name}</b></td><td className="align-right"><b>{o.plannedMinutes?`${o.oee}%`:'—'}</b></td><td className="align-right">{o.plannedMinutes?`${o.availability}%`:'—'}</td><td className="align-right">{o.plannedMinutes?`${o.performance}%`:'—'}</td><td className="align-right">{o.plannedMinutes?`${o.quality}%`:'—'}</td><td className="align-right">{o.downtimeMinutes} min</td></tr>)}</tbody></table></div></Card>
          <Card title="Yo‘qotishlar"><BarList rows={[{label:'Availability yo‘qotishi',value:100-overall.availability,tone:'warning'},{label:'Tezlik yo‘qotishi',value:100-overall.performance,tone:'warning'},{label:'Sifat yo‘qotishi',value:100-overall.quality,tone:'danger'}]} unit="%" max={100}/>{reasons.length>0&&<><p className="soft-meta">Downtime sabablari</p><BarList rows={reasons.map(r=>({label:r.reason,value:r.minutes}))} unit="min"/></>}</Card></div>
      </>}
  }
  if(view==='profitability'){
    const rows=profitabilityByProduct(s,since).map(({product,...row})=>({p:product,...row}))
    const totalRevenue=rows.reduce((a,r)=>a+r.revenue,0),allKnown=rows.every(r=>r.margin!==null),totalMargin=rows.reduce((a,r)=>a+(r.margin||0),0)
    return {title:'Profitability',subtitle:'Jo‘natilgan LOT tannarxi · kelib chiqishi yetishmasa COGS ko‘rsatilmaydi',
      rows:rows.map(r=>({Mahsulot:r.p.name,SKU:r.p.sku,Sotildi:r.qty,Tushum:Math.round(r.revenue),COGS:r.cogs===null?'Mavjud emas':Math.round(r.cogs),Tannarx:r.costBasis,Marja:r.margin===null?'Mavjud emas':Math.round(r.margin),'Marja %':r.revenue&&r.margin!==null?Math.round(r.margin/r.revenue*100):'—'})),
      body:<>
        <div className="kpi-grid cols-3"><KPI label="Tushum" value={compactMoney(totalRevenue)} icon={<Icon name="wallet"/>}/><KPI label="Yalpi marja" value={allKnown?compactMoney(totalMargin):'Mavjud emas'} tone="mint" icon={<Icon name="chart"/>}/><KPI label="Marja %" value={allKnown&&totalRevenue?`${Math.round(totalMargin/totalRevenue*100)}%`:'—'} tone="purple" icon={<Icon name="target"/>}/></div>
        {rows.length?<div className="card flush"><div className="table-scroll"><table className="fit"><thead><tr><th>Mahsulot</th><th className="align-right">Sotildi</th><th className="align-right">Tushum</th><th className="align-right">COGS</th><th className="align-right">Marja</th><th className="align-right">Marja %</th></tr></thead><tbody>{rows.map(r=>{const pct=r.revenue&&r.margin!==null?Math.round(r.margin/r.revenue*100):null;return <tr key={r.p.id}><td><div className="cell-main"><b>{r.p.name}</b><small>{r.p.sku} · {r.costBasis==='actual'?'LOT tannarxi':r.costBasis==='estimated'?'Taxminiy tannarx':r.costBasis==='provisional'?'QC paytidagi dastlabki tannarx':'Tannarx ma’lum emas'}</small></div></td><td className="align-right">{num(r.qty)} {r.p.unit}</td><td className="align-right">{compactMoney(r.revenue)}</td><td className="align-right">{r.cogs===null?'—':compactMoney(r.cogs)}</td><td className={`align-right ${r.margin!==null&&r.margin<0?'negative':''}`}><b>{r.margin===null?'—':compactMoney(r.margin)}</b></td><td className="align-right"><b className={pct===null?undefined:pct<0?'negative':pct>=20?'positive':undefined}>{pct===null?'—':`${pct}%`}</b></td></tr>})}</tbody></table></div></div>:<Card><Empty title="Davrda yetkazilgan sotuv yo‘q" text="Davrni kengaytiring"/></Card>}
      </>}
  }
  return {title:'Hisobot topilmadi',subtitle:'Tanlangan ko‘rinish mavjud emas.',rows:[],body:<Card><Empty title="Hisobot topilmadi" action={<Link className="primary-glass-btn" to="/reports">Katalogga qaytish</Link>}/></Card>}
}

function Traceability(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const fallback=s.productionOrders.find(o=>o.status==='Yakunlangan'&&o.lot)?.lot||''
  const [q,setQ]=useSearchParamState('q',fallback)
  const [draft,setDraft]=useState(q)
  useEffect(()=>setDraft(q),[q])
  const order=findTraceOrder(s,q)
  const trace=order?buildTraceability(s,order.id):null
  const unit=q?serialStatus(s,q.trim()):undefined
  const rows:FlatRow[]=trace?[...trace.upstreamLots.map(l=>({'Yo‘nalish':'Upstream',Kod:l.code,Item:materialName(s,l.itemId),Manba:l.sourceCode,Sana:l.createdAt})),{'Yo‘nalish':'MO',Kod:order!.code,Item:productName(s,order!.productId),Manba:order!.bomVersion,Sana:order!.completedAt||order!.createdAt},...trace.outputLots.map(l=>({'Yo‘nalish':'Output',Kod:l.code,Item:productName(s,l.itemId),Manba:l.sourceCode,Sana:l.createdAt})),...trace.downstreamSales.map(o=>({'Yo‘nalish':'Downstream',Kod:o.code,Item:customerName(s,o.customerId),Manba:o.status,Sana:o.deliveredAt||o.createdAt}))]:[]
  return <div className="page-stack print-area">
    <PageHeader title="Traceability" subtitle="Lot, serial, MO yoki SKU → to‘liq zanjir" actions={<ExportButtons name={`trace-${q||'empty'}`} rows={rows}/>}/>
    <Card><form className="trace-search" onSubmit={e=>{e.preventDefault();setQ(draft.trim())}}><Icon name="search"/><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="LOT-..., SN-..., MO-..., FG-..." aria-label="Traceability qidiruvi"/><button className="primary-glass-btn" type="submit" disabled={!draft.trim()}>Trace</button></form></Card>
    {unit&&<Card title={`Serial ${unit.serial}`} actions={<StatusBadge tone={unit.record?'success':'neutral'}>{SERIAL_STATUS_LABEL[unit.status]}</StatusBadge>}>
      {unit.conflict&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{unit.conflict}</span></div>}
      <InfoGrid items={[{label:'Item',value:unit.origin?.itemType==='raw'?materialName(s,unit.itemId):productName(s,unit.itemId)},{label:'Hozir',value:unit.warehouseId?`${warehouseName(s,unit.warehouseId)}${unit.location?` · ${unit.location}`:''}`:SERIAL_STATUS_LABEL[unit.status]},{label:'Manba',value:unit.origin?`${unit.origin.sourceCode}${unit.origin.batch?` · ${unit.origin.batch}`:''}`:'—'},{label:'Harakatlar',value:unit.history.length}]}/>
      <div className="table-scroll"><table className="fit"><thead><tr><th>Sana</th><th>Harakat</th><th>Hujjat</th><th>Ombor</th><th className="align-right">Miqdor</th></tr></thead>
        <tbody>{unit.history.map(m=><tr key={m.id}><td>{displayStamp(m.date)}</td><td>{m.type}</td><td>{m.source}</td><td>{warehouseName(s,m.warehouseId)}{m.location?` · ${m.location}`:''}</td><td className="align-right">{num(m.qty)}</td></tr>)}</tbody></table></div>
    </Card>}
    {!order||!trace?(unit?null:<Card><Empty icon="search" title={q?`“${q}” bo‘yicha zanjir topilmadi`:'Kod kiriting'} text="MO, lot, serial (SN-…) yoki SKU"/></Card>):<>
      <div className="trace-chain">
        <TraceNode icon="truck" label="Supplier / xarid" title={trace.purchases.map(p=>p.code).join(', ')||'Boshlang‘ich zaxira'} sub={[...new Set(trace.purchases.map(p=>supplierName(s,p.supplierId)))].join(', ')||'—'}/>
        <Icon name="arrow" className="trace-arrow"/>
        <TraceNode icon="layers" label="Xomashyo lotlari" title={`${trace.upstreamLots.length} ta lot`} sub={trace.upstreamLots.slice(0,2).map(l=>l.code).join(', ')||'—'}/>
        <Icon name="arrow" className="trace-arrow"/>
        <TraceNode icon="factory" label="Ishlab chiqarish" title={order.code} sub={`${productName(s,order.productId)} · ${order.bomVersion}`} onClick={()=>navigate(`/production?view=orders&id=${order.id}`)}/>
        <Icon name="arrow" className="trace-arrow"/>
        <TraceNode icon="shield" label="Sifat" title={trace.qualityChecks.find(q=>q.type==='Final')?.status||order.qualityStatus} sub={`${trace.qualityChecks.length} ta tekshiruv`}/>
        <Icon name="arrow" className="trace-arrow"/>
        <TraceNode icon="barcode" label="Tayyor lot / serial" title={order.lot||order.serialRange||'—'} sub={`${num(order.completed)} ${s.products.find(p=>p.id===order.productId)?.unit||''}`}/>
        <Icon name="arrow" className="trace-arrow"/>
        <TraceNode icon="users" label="Mijoz" title={trace.downstreamSales.map(o=>o.code).join(', ')||'Omborda'} sub={[...new Set(trace.downstreamSales.map(o=>customerName(s,o.customerId)))].join(', ')||'Hali sotilmagan'}/>
      </div>
      <div className="two-col">
        <Card title="Upstream: sarflangan lotlar">{trace.upstreamLots.length?<div className="stack-list">{trace.upstreamLots.map(l=><button type="button" key={l.id} className="list-row is-clickable" onClick={()=>setQ(l.code)}><span className="list-row-copy"><b>{l.code}</b><small>{materialName(s,l.itemId)} · {l.sourceCode}{l.sourceType==='purchase'?` · ${supplierName(s,s.purchaseOrders.find(p=>p.id===l.sourceId)?.supplierId)}`:''}</small></span><span className="list-row-meta"><span className="num">{num(order.consumed.filter(c=>c.lot===l.code).reduce((a,c)=>a+c.qty,0),1)}</span></span></button>)}</div>:<Empty compact title="Material hali sarflanmagan"/>}</Card>
        <Card title="Downstream: jo‘natmalar">{trace.movements.filter(m=>m.type==='Production +').length?<div className="stack-list">{shipments(s,trace.outputLots).map(g=><div className="list-row" key={g.key}><span className="list-row-copy"><b>{g.source}</b><small>{g.date} · {num(g.qty)} · {g.lots.slice(0,3).join(', ')}{g.lots.length>3?` +${g.lots.length-3}`:''}</small></span><StatusBadge tone="success">Jo‘natilgan</StatusBadge></div>)}{trace.outputLots.filter(l=>!isSerialUnit(l)).map(l=><div className="list-row" key={l.id}><span className="list-row-copy"><b>{l.code}</b><small>Omborda qoldiq {num(l.qty)} · {warehouseName(s,l.warehouseId)}</small></span></div>)}{unitsInStock(trace.outputLots).map(([wh,codes])=><div className="list-row" key={wh}><span className="list-row-copy"><b>{codes.length} ta serial omborda</b><small>{warehouseName(s,wh)} · {codes.slice(0,3).join(', ')}{codes.length>3?` +${codes.length-3}`:''}</small></span></div>)}</div>:<Empty compact title="Tayyor mahsulot hali qabul qilinmagan"/>}</Card>
      </div>
      <InfoGrid items={[{label:'Mahsulot zaxirasi',value:num(stockOf(s,order.productId).onHand)},{label:'Ishlab chiqarilgan',value:order.completedAt||'jarayonda'},{label:'Harakatlar',value:trace.movements.length},{label:'Qaytarishlar',value:s.returns.filter(r=>r.lot&&trace.outputLots.some(l=>l.code===r.lot)).length}]}/>
    </>}
  </div>
}

/** Shipments of an order's output, one row per delivery document (serial units are many rows of one shipment). */
function shipments(s:ManufacturingState,lots:ManufacturingState['lots']){
  const codes=new Set(lots.map(l=>l.code)),groups=new Map<string,{key:string;source:string;date:string;qty:number;lots:string[]}>()
  for(const m of s.stockMovements){
    if(m.type!=='Sale -'||!m.lot||!codes.has(m.lot))continue
    const k=`${m.source}|${m.date}`,g=groups.get(k)||{key:k,source:m.source,date:m.date,qty:0,lots:[]}
    g.qty+=-m.qty;if(!g.lots.includes(m.lot))g.lots.push(m.lot);groups.set(k,g)
  }
  return [...groups.values()]
}
/** Serial units of the output still in stock, by warehouse. */
const unitsInStock=(lots:ManufacturingState['lots'])=>{const m=new Map<string,string[]>();for(const l of lots)if(isSerialUnit(l)&&l.qty>0)m.set(l.warehouseId,[...(m.get(l.warehouseId)||[]),l.code]);return [...m]}

function TraceNode({icon,label,title,sub,onClick}:{icon:string;label:string;title:string;sub:string;onClick?:()=>void}){
  const body=<><span className="trace-icon"><Icon name={icon}/></span><em>{label}</em><b>{title}</b><small>{sub}</small></>
  return onClick?<button type="button" className="trace-node is-clickable" onClick={onClick}>{body}</button>:<div className="trace-node">{body}</div>
}
