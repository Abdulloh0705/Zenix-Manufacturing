import {useMemo,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,PageHeader,ResourceTable,SectionTitle,Segmented,Select,StatusBadge,Textarea,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Tone} from '../../../shared/ui'
import type {LotRecord,StockBalance,StockCount,StockMovement,StockTransfer,Warehouse as WarehouseType} from '../../../types'
import {findTraceOrder,inventoryValuation,itemName,orderReservations,serialInRange,stockOf,stockValuation} from '../../../domain/manufacturingEngine'
import {countDelta,lotTracked,transferOpen} from '../../../domain/actions'
import {SERIAL_STATUS_LABEL,isLegacyRange,serialIssues,serialRegister} from '../../../domain/serials'
import type {SerialStatus} from '../../../domain/serials'
import {binQty,inventoryIssues,keyOf,locationRows,lotsAt,unassignedQty,untrackedAt} from '../../../domain/inventory'
import type {IntegrityIssue} from '../../../domain/inventory'
import {convertQty,unitOptions} from '../../../domain/uom'
import {addDays,todayISO} from '../../../utils/dates'
import {compactMoney,money,num,qty} from '../../../utils/format'
import {employeeName,equipmentName,itemSku,itemUnitOf,warehouseName} from '../../common/lookups'
import {SparePartsPanel} from '../../equipment/components/SpareParts'
import {MAINTENANCE_PART_RULES,commandBlocker,stockScope} from '../../../domain/access'
import {ActivityPanel} from '../../common/RecordPanels'
import {LabelModal} from '../../common/Barcode'
import type {LabelData} from '../../common/Barcode'

export default function Warehouse(){
  const [sp]=useSearchParams(),view=sp.get('view')||'stock'
  if(view==='movements')return <Movements/>
  if(view==='transfers')return <Transfers/>
  if(view==='inventory')return <Inventory/>
  if(view==='warehouses')return <Warehouses/>
  if(view==='locations')return <Locations/>
  if(view==='serials')return <Serials/>
  if(view==='lots')return <Lots kind="lot"/>
  if(view==='barcode')return <Barcode/>
  if(view==='maintenance')return <MaintenanceIssues/>
  return <Stock/>
}

/** A signed amount (+ above standard, − below). */
const signedMoney=(n:number)=>`${n>0?'+':n<0?'−':''}${money(Math.abs(n))}`
type StockRow=StockBalance&{name:string;sku:string;available:number;value:number;lotValue:number;variance:number}
function useStockRows(){
  const s=useApp().state
  // P4-I-01 (decision STANDARD): `value` is the book value at standard cost; the lot (actual) value and the difference sit beside it.
  return useMemo<StockRow[]>(()=>s.stockBalances.map(b=>{const v=stockValuation(s,b);return {...b,name:itemName(s,keyOf(b)),sku:itemSku(s,keyOf(b)),available:Math.max(0,b.onHand-b.reserved-(b.quarantine||0)),value:v.standard,lotValue:v.actual,variance:v.variance}}),[s])
}
/** Where a balance sits: its locations and the unassigned rest (audit #17); one line, no wrapping chips in a table. */
function LocationCell({b}:{b:StockBalance}){
  const rows=locationRows(b).filter(r=>r.qty>1e-9)
  if(!rows.length)return <span className="soft-meta">—</span>
  return <span className="truncate" title={rows.map(r=>`${r.location||'Joysiz'}: ${num(r.qty,1)}`).join(' · ')}>{rows.map(r=>`${r.location||'Joysiz'} ${num(r.qty,1)}`).join(' · ')}</span>
}
/** Unit selector for a quantity field: the item's stock unit, same-dimension units and its own pack units (audit #24). */
function UnitSelect({itemId,value,onChange}:{itemId:string;value:string;onChange:(v:string)=>void}){
  const s=useApp().state
  const id=itemId.split('~')[0]
  const item=s.rawMaterials.find(m=>m.id===id)||s.products.find(p=>p.id===id)
  const options=item?unitOptions(item):[]
  return <Select value={value||item?.unit||''} onChange={onChange} ariaLabel="Birlik" disabled={options.length<2}>{options.map(u=><option key={u} value={u}>{u}</option>)}</Select>
}
/** A typed quantity in stock units, or why it cannot be converted (shown as the field's error). */
function stockQtyOf(s:ReturnType<typeof useApp>['state'],itemId:string|undefined,value:string,unit:string):{value:number;error?:string;converted?:string}{
  const id=(itemId||'').split('~')[0]
  const item=s.rawMaterials.find(m=>m.id===id)||s.products.find(p=>p.id===id)
  if(!item||value===''||!Number.isFinite(Number(value)))return {value:Number.NaN}
  const c=convertQty(item,Number(value),unit||item.unit,undefined,'half-up')
  return 'error' in c?{value:Number.NaN,error:c.error}:{value:c.value,converted:(unit&&unit!==item.unit)?`= ${num(c.value,3)} ${item.unit}`:undefined}
}
const openItem=(navigate:ReturnType<typeof useNavigate>,r:{itemType:string;itemId:string})=>navigate(r.itemType==='raw'?`/materials?view=all&id=${r.itemId}`:`/products?view=all&id=${r.itemId}`)

function Stock(){
  const app=useApp(),s=app.state,navigate=useNavigate(),rows=useStockRows()
  const [q,setQ]=useSearchParamState('q'),[wh,setWh]=useSearchParamState('wh'),[type,setType]=useSearchParamState('type'),[state,setState]=useSearchParamState('state')
  const typeKey=type==='finished'?'finished':type==='raw'?'raw':''
  const low=(r:StockRow)=>{const m=s.rawMaterials.find(x=>x.id===r.itemId);return Boolean(m)&&stockOf(s,r.itemId).available<m!.reorderPoint}
  const scoped=rows.filter(r=>(!wh||r.warehouseId===wh)&&(!typeKey||r.itemType===typeKey))
  const filtered=scoped.filter(r=>!state||(state==='low'?low(r):state==='reserved'?r.reserved>0:state==='incoming'?r.incoming>0:state==='quarantine'?(r.quarantine||0)>0:true))
  return <div className="page-stack">
    <PageHeader title="Ombor qoldiqlari" subtitle="On hand, rezerv, available va qiymat"/>
    <div className="kpi-grid">
      <KPI label="Zaxira qiymati · standart" value={compactMoney(scoped.reduce((a,r)=>a+r.value,0))} sub={`${scoped.length} qator · asosiy baholash`} tone="purple" icon={<Icon name="wallet"/>} onClick={()=>setState('')}/>
      <KPI label="LOT tannarxida" value={compactMoney(scoped.reduce((a,r)=>a+r.lotValue,0))} sub={`farq ${signedMoney(scoped.reduce((a,r)=>a+r.variance,0))}`} tone="mint" icon={<Icon name="chart"/>}/>
      <KPI label="Past qoldiq" value={scoped.filter(low).length} sub="Reorder’dan past" tone="pink" icon={<Icon name="warning"/>} onClick={()=>setState('low')}/>
      <KPI label="Rezervda" value={scoped.filter(r=>r.reserved>0).length} tone="orange" icon={<Icon name="lock"/>} onClick={()=>setState('reserved')}/>
      <KPI label="QC hold" value={scoped.filter(r=>(r.quarantine||0)>0).length} sub="Available emas" tone="orange" icon={<Icon name="shield"/>} onClick={()=>setState('quarantine')}/>
      <KPI label="Yo‘lda" value={scoped.filter(r=>r.incoming>0).length} tone="mint" icon={<Icon name="truck"/>} onClick={()=>setState('incoming')}/>
    </div>
    <ResourceTable rows={filtered} query={q} onQuery={setQ} placeholder="Item, SKU, lot..." onRow={r=>openItem(navigate,r)} exportName="stock" resetKey={`${wh}|${type}|${state}`}
      filtersActive={Boolean(wh||type||state)} onResetFilters={()=>{setWh('');setType('');setState('')}}
      rowClassName={r=>low(r)?'row-warning':undefined}
      filters={<><FilterSelect label="Ombor" value={wh} onChange={setWh} options={s.warehouses.map(w=>({value:w.id,label:w.name}))}/><FilterSelect label="Tur" value={type} onChange={setType} options={[{value:'raw',label:'Xomashyo'},{value:'finished',label:'Mahsulot'}]}/><FilterSelect label="Holat" value={state} onChange={setState} options={[{value:'low',label:'Past qoldiq'},{value:'reserved',label:'Rezervda'},{value:'quarantine',label:'QC hold'},{value:'incoming',label:'Yo‘lda'}]}/></>}
      columns={[
        {key:'name',label:'Item',value:r=>r.name,render:r=><div className="cell-main"><b>{r.name}</b><small>{r.sku}{r.lot?` · ${r.lot}`:''}</small></div>},
        {key:'warehouse',label:'Ombor',value:r=>warehouseName(s,r.warehouseId)},
        {key:'locations',label:'Joylar',value:r=>locationRows(r).filter(x=>x.qty>0).map(x=>x.location||'Joysiz').join(' '),render:r=><LocationCell b={r}/>,priority:'low'},
        {key:'type',label:'Tur',value:r=>r.itemType==='raw'?'Xomashyo':'Mahsulot',priority:'low'},
        {key:'onHand',label:'On hand',align:'right',value:r=>r.onHand,render:r=>num(r.onHand,1)},
        {key:'reserved',label:'Rezerv',align:'right',value:r=>r.reserved,render:r=>num(r.reserved,1)},
        {key:'quarantine',label:'QC hold',align:'right',value:r=>r.quarantine||0,render:r=>(r.quarantine||0)>0?<StatusBadge tone="warning">{num(r.quarantine||0,1)}</StatusBadge>:'—'},
        {key:'available',label:'Available',align:'right',value:r=>r.available,render:r=><b>{qty(r.available,r.unit,1)}</b>},
        {key:'incoming',label:'Yo‘lda',align:'right',value:r=>r.incoming,render:r=>num(r.incoming),priority:'low'},
        {key:'value',label:'Qiymat (standart)',align:'right',value:r=>r.value,render:r=>money(r.value),priority:'low'},
        {key:'lotValue',label:'Qiymat (LOT)',align:'right',value:r=>r.lotValue,render:r=><div className="cell-main"><b>{money(r.lotValue)}</b>{Math.abs(r.variance)>0.005&&<small className={r.variance>0?'negative':'positive'}>farq {signedMoney(r.variance)}</small>}</div>,priority:'low'},
      ]}/>
  </div>
}

function Movements(){
  const s=useApp().state
  const [q,setQ]=useSearchParamState('q'),[type,setType]=useSearchParamState('type'),[wh,setWh]=useSearchParamState('wh'),[range,setRange]=useSearchParamState('range','30')
  const since=addDays(todayISO(),-Number(range||30))
  const types=[...new Set(s.stockMovements.map(m=>m.type))].sort()
  const rows=s.stockMovements.filter(m=>(!type||m.type===type)&&(!wh||m.warehouseId===wh)&&(range==='all'||m.date.slice(0,10)>=since))
  return <div className="page-stack">
    <PageHeader title="Stock harakatlari" subtitle="Barcha kirim / chiqimlar, lot bilan"/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Item, manba, lot, foydalanuvchi..." exportName="stock-movements" resetKey={`${type}|${wh}|${range}`} pageSize={25}
      filtersActive={Boolean(type||wh||range!=='30')} onResetFilters={()=>{setType('');setWh('');setRange('30')}}
      filters={<><FilterSelect label="Davr" value={range} onChange={setRange} defaultValue="30" options={[{value:'7',label:'7 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'},{value:'all',label:'Butun davr'}]}/><FilterSelect label="Harakat" value={type} onChange={setType} options={types}/><FilterSelect label="Ombor" value={wh} onChange={setWh} options={s.warehouses.map(w=>({value:w.id,label:w.name}))}/></>}
      columns={[
        {key:'date',label:'Sana',value:m=>m.date},
        {key:'type',label:'Harakat',value:m=>m.type,render:m=><StatusBadge tone={m.qty>=0?'success':'warning'}>{m.type}</StatusBadge>},
        {key:'item',label:'Item',value:m=>itemName(s,keyOf(m)),render:m=><div className="cell-main"><b>{itemName(s,keyOf(m))}</b><small>{[m.lot||m.note,m.location].filter(Boolean).join(' · ')}</small></div>},
        {key:'warehouse',label:'Ombor',value:m=>warehouseName(s,m.warehouseId),priority:'low'},
        {key:'qty',label:'Miqdor',align:'right',value:m=>m.qty,render:m=><b className={m.qty>=0?'positive':'negative'}>{m.qty>0?'+':''}{num(m.qty,1)} {itemUnitOf(s,m.itemId)}</b>},
        {key:'source',label:'Manba',value:m=>m.source},
        {key:'user',label:'Foydalanuvchi',value:m=>m.user,priority:'low'},
      ]}/>
  </div>
}

function TransferModal({onClose}:{onClose:()=>void}){
  const app=useApp(),s=app.state
  // Only stores the role may move stock into are offered; the engine checks the same scope again.
  const scope=stockScope(s,app.currentEmployee)
  const lines=s.stockBalances.filter(b=>(!scope||scope.has(b.warehouseId))&&b.onHand-b.reserved-(b.quarantine||0)>0)
  const [unit,setUnit]=useState(''),[mode,setMode]=useState<'two-step'|'now'>('two-step'),[key]=useState(()=>`tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`)
  const form=useForm({line:lines[0]?.id||'',to:'',qty:'',fromLocation:'*',toLocation:'',note:''},v=>{const b=s.stockBalances.find(x=>x.id===v.line);const amount=stockQtyOf(s,b?keyOf(b):undefined,v.qty,unit);const avail=b?b.onHand-b.reserved-(b.quarantine||0):0;const here=b&&v.fromLocation!=='*'?binQty(b,v.fromLocation):avail;return {line:b?undefined:'Stock qatorini tanlang',to:!v.to?'Qabul qiluvchi omborni tanlang':v.to===b?.warehouseId?'Bir xil ombor':undefined,qty:amount.error||(!(amount.value>0)?'Miqdor kiriting':amount.value>Math.min(avail,here)+1e-9?`Mavjud ${num(Math.min(avail,here),1)}`:undefined),note:v.note.trim().length<5?'Transfer sababini yozing (kamida 5 belgi)':undefined}})
  const b=s.stockBalances.find(x=>x.id===form.values.line)
  const amount=stockQtyOf(s,b?keyOf(b):undefined,form.values.qty,unit)
  const target=s.warehouses.find(w=>w.id===form.values.to)
  const source=s.warehouses.find(w=>w.id===b?.warehouseId)
  const branch=(id?:string)=>s.branches.find(x=>x.id===id)?.name||'—'
  const submit=()=>form.submit(v=>{
    const fromLocation=v.fromLocation==='*'?undefined:v.fromLocation,toLocation=v.toLocation||undefined
    const r=mode==='two-step'?app.dispatchTransfer({itemId:keyOf(b!),from:b!.warehouseId,to:v.to,qty:Number(v.qty),fromLocation,toLocation,unit:unit||undefined,reason:v.note.trim(),key})
      :app.transferStock(keyOf(b!),b!.warehouseId,v.to,Number(v.qty),undefined,{fromLocation,toLocation,unit:unit||undefined,reason:v.note.trim(),key})
    if(r.ok)onClose();return r.ok
  })
  return <Modal open onClose={onClose} title="Omborlararo transfer" subtitle="Faqat available qoldiq ko‘chiriladi · LOT o‘z joyidan, manbasi bilan" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name={mode==='two-step'?'truck':'arrow-right'} size={16}/>{mode==='two-step'?'Yo‘lga chiqarish':'Transfer qilish'}</button></>}>
    <div className="form-grid">
      <div className="field span-2"><label>Usul</label><Segmented ariaLabel="Transfer usuli" value={mode} onChange={v=>setMode(v as 'two-step'|'now')} items={[{value:'two-step',label:'Jo‘natish → qabul'},{value:'now',label:'Darhol (bir vaqtda)'}]}/>
        <small className="field-hint">{mode==='two-step'?'Mahsulot manbadan chiqadi va qabul qilinmaguncha hech bir omborda available bo‘lmaydi; qabul qisman bo‘lishi mumkin.':'Bir joydagi omborlar uchun: chiqim va kirim bir vaqtda yoziladi.'}</small></div>
      <Field className="span-2" label="Item va manba ombor" required error={form.error('line')}><Select value={form.values.line} onChange={v=>{form.set('line',v);form.set('to','');form.set('fromLocation','*');setUnit('')}}>{lines.map(x=><option key={x.id} value={x.id}>{itemName(s,keyOf(x))} · {warehouseName(s,x.warehouseId)} · {num(x.onHand-x.reserved-(x.quarantine||0),1)} {x.unit}</option>)}</Select></Field>
      <Field label="Manba joyi" hint="Ixtiyoriy: LOT’lar turgan joyidan olinadi"><Select value={form.values.fromLocation} onChange={v=>form.set('fromLocation',v)}><option value="*">Istalgan joy</option>{b&&locationRows(b).filter(r=>r.qty>0).map(r=><option key={r.location||'none'} value={r.location}>{r.location||'Joysiz qoldiq'} · {num(r.qty,1)}</option>)}</Select></Field>
      <Field label="Qabul qiluvchi ombor" required error={form.error('to')}><Select value={form.values.to} onChange={v=>{form.set('to',v);form.set('toLocation','')}} placeholder="Tanlang">{s.warehouses.filter(w=>w.id!==b?.warehouseId&&w.status==='Faol'&&(!scope||scope.has(w.id))).map(w=>(<option key={w.id} value={w.id}>{w.name}</option>))}</Select></Field>
      <Field label="Qabul joyi" hint={target&&!target.locations.length?'Bu omborda joy yo‘q':undefined}><Select value={form.values.toLocation} onChange={v=>form.set('toLocation',v)} disabled={!target?.locations.length}><option value="">Joysiz (keyin joylashtiriladi)</option>{target?.locations.map(l=><option key={l} value={l}>{l}</option>)}</Select></Field>
      <Field label="Miqdor" required error={form.error('qty')} hint={amount.converted||(b?`Available: ${num(b.onHand-b.reserved-(b.quarantine||0),1)} ${b.unit}`:undefined)}><div className="inline-row"><Input type="number" min="0" step="any" aria-label="Miqdor" {...form.input('qty')}/>{b&&<UnitSelect itemId={keyOf(b)} value={unit} onChange={setUnit}/>}</div></Field>
      <Field className="span-2" label="Transfer sababi" required error={form.error('note')} hint="Kamida 5 belgi · transfer tarixida saqlanadi"><Input {...form.input('note')} placeholder="Masalan: ishlab chiqarish uchun zaxirani ko‘chirish"/></Field>
      <div className="inline-note span-2"><Icon name="info"/>Boshlovchi: {app.currentEmployee?.name||'—'} · {branch(source?.branchId)} / {source?.name||'—'} → {branch(target?.branchId)} / {target?.name||'—'}</div>
    </div>
  </Modal>
}

type TransferRow={id:string;ref:string;date:string;itemId:string;from:string;to:string;qty:number;received:number;status:StockTransfer['status']|'Darhol';transfer?:StockTransfer}
const TRANSFER_TONE:Record<TransferRow['status'],Tone>={'Yo‘lda':'warning','Qisman qabul qilindi':'info','Qabul qilindi':'success','Yopildi':'neutral','Darhol':'neutral'}
const r3=(n:number)=>Math.round(n*1000)/1000
const unitCost=(s:ReturnType<typeof useApp>['state'],key:string)=>{const id=key.split('~')[0];return s.rawMaterials.find(m=>m.id===id)?.standardCost??s.products.find(p=>p.id===id)?.standardCost??0}
function Transfers(){
  const app=useApp(),s=app.state
  const [open,setOpen]=useState(false),[q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useRecordParam()
  const rows=useMemo<TransferRow[]>(()=>{
    const twoStep=(s.stockTransfers||[]).map(t=>({id:t.id,ref:t.ref,date:t.createdAt,itemId:t.itemId,from:t.from,to:t.to,qty:t.qty,received:r3(t.lines.reduce((a,l)=>a+l.received,0)),status:t.mode==='immediate'?'Darhol' as const:t.status,transfer:t}))
    const known=new Set(twoStep.map(r=>r.ref))
    // Immediate transfers live in the ledger only: every "Transfer −" row of the reference is summed (multi-lot).
    const outs=new Map<string,StockMovement[]>()
    for(const m of s.stockMovements)if(m.type==='Transfer -'&&!known.has(m.source))outs.set(m.source,[...(outs.get(m.source)||[]),m])
    const immediate=[...outs].map(([ref,ms])=>{const inn=s.stockMovements.find(m=>m.source===ref&&m.type==='Transfer +');const total=r3(-ms.reduce((a,m)=>a+m.qty,0));return {id:ref,ref,date:ms[ms.length-1].date,itemId:ms[0].itemId,from:ms[0].warehouseId,to:inn?.warehouseId||'',qty:total,received:total,status:'Darhol' as const}})
    return [...twoStep,...immediate].sort((a,b)=>b.date.localeCompare(a.date))
  },[s.stockTransfers,s.stockMovements])
  const inTransit=rows.filter(r=>r.transfer&&(r.status==='Yo‘lda'||r.status==='Qisman qabul qilindi'))
  const transitValue=inTransit.reduce((a,r)=>a+transferOpen(r.transfer!)*unitCost(s,r.itemId),0)
  const shown=rows.filter(r=>!status||r.status===status)
  const selected=rows.find(r=>r.id===id)
  return <div className="page-stack">
    <PageHeader title="Transferlar" subtitle="Jo‘natish → yo‘lda → qabul (qisman yoki to‘liq)"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('warehouse','edit')} onClick={()=>setOpen(true)}><Icon name="plus"/>Yangi transfer</button>}/>
    <div className="kpi-grid cols-3">
      <KPI label="Yo‘lda" value={inTransit.length} sub="qabul kutilmoqda" tone="orange" icon={<Icon name="truck"/>} onClick={()=>setStatus('Yo‘lda')}/>
      <KPI label="Qisman qabul qilingan" value={rows.filter(r=>r.status==='Qisman qabul qilindi').length} tone="mint" icon={<Icon name="clock"/>} onClick={()=>setStatus('Qisman qabul qilindi')}/>
      <KPI label="Yo‘ldagi qiymat" value={compactMoney(transitValue)} sub="standart tannarx bo‘yicha" tone="purple" icon={<Icon name="wallet"/>}/>
    </div>
    <ResourceTable rows={shown} query={q} onQuery={setQ} placeholder="Transfer, item..." exportName="transfers" onRow={r=>setId(r.id)} resetKey={status}
      emptyText="Transfer hali qilinmagan" emptyAction={app.can('warehouse','edit')?<button type="button" className="primary-glass-btn compact" onClick={()=>setOpen(true)}>Birinchi transfer</button>:undefined}
      filters={<FilterSelect label="Holat" value={status} onChange={setStatus} options={['Yo‘lda','Qisman qabul qilindi','Qabul qilindi','Yopildi','Darhol']}/>} filtersActive={Boolean(status)} onResetFilters={()=>setStatus('')}
      columns={[{key:'ref',label:'Transfer',value:r=>r.ref,render:r=><div className="cell-main"><b>{r.ref}</b><small>{r.date.slice(0,16)}</small></div>},{key:'item',label:'Item',value:r=>itemName(s,r.itemId)},{key:'route',label:'Yo‘nalish',value:r=>`${warehouseName(s,r.from)} → ${warehouseName(s,r.to)}`},{key:'qty',label:'Jo‘natilgan',align:'right',value:r=>r.qty,render:r=>qty(r.qty,itemUnitOf(s,r.itemId),1)},{key:'received',label:'Qabul qilingan',align:'right',value:r=>r.received,render:r=>num(r.received,1),priority:'low'},{key:'status',label:'Holat',value:r=>r.status,render:r=><StatusBadge tone={TRANSFER_TONE[r.status]}>{r.status}</StatusBadge>}]}/>
    {open&&<TransferModal onClose={()=>setOpen(false)}/>}
    {selected&&<TransferDrawer row={selected} onClose={()=>setId(null)}/>}
  </div>
}

function TransferDrawer({row,onClose}:{row:TransferRow;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [receive,setReceive]=useState(false),[back,setBack]=useState(false)
  const t=row.transfer,unit=itemUnitOf(s,row.itemId),open=t?transferOpen(t):0
  const moves=s.stockMovements.filter(m=>m.source===row.ref).slice().reverse()
  const canReceive=Boolean(t)&&open>1e-9&&!commandBlocker(s,app.currentEmployee,'receiveTransfer',[t?.id,{qty:open}])
  const canReturn=Boolean(t)&&open>1e-9&&!commandBlocker(s,app.currentEmployee,'returnTransfer',[t?.id,'reason'])
  const who=(id:string)=>s.employees.find(e=>e.id===id)?.name||id||'—'
  const branch=(id?:string)=>s.branches.find(x=>x.id===id)?.name||'—'
  return <Drawer open onClose={onClose} title={row.ref} eyebrow="Transfer" icon="truck" size="md" subtitle={`${itemName(s,row.itemId)} · ${warehouseName(s,row.from)} → ${warehouseName(s,row.to)}`} headerExtra={<StatusBadge tone={TRANSFER_TONE[row.status]}>{row.status}</StatusBadge>}
    actions={canReceive||canReturn?<>{canReturn&&<button type="button" className="ghost-btn" onClick={()=>setBack(true)}><Icon name="undo" size={15}/>Manbaga qaytarish</button>}<span className="spacer"/>{canReceive&&<button type="button" className="primary-glass-btn" onClick={()=>setReceive(true)}><Icon name="check" size={16}/>Qabul qilish</button>}</>:undefined}>
    <InfoGrid columns={3} items={[{label:'Jo‘natilgan',value:qty(row.qty,unit,1)},{label:'Qabul qilingan',value:qty(row.received,unit,1)},{label:'Yo‘lda',value:qty(open,unit,1),tone:open>0?'warning':undefined}]}/>
    {t&&<InfoGrid columns={3} items={[{label:'Boshlovchi',value:who(t.createdBy)},{label:'Manba',value:`${branch(t.fromBranchId||s.warehouses.find(w=>w.id===t.from)?.branchId)} / ${warehouseName(s,t.from)}`},{label:'Qabul',value:`${branch(t.toBranchId||s.warehouses.find(w=>w.id===t.to)?.branchId)} / ${warehouseName(s,t.to)}`},{label:'Sana / vaqt',value:t.createdAt},{label:'Yakunlandi',value:t.closedAt||'—'},{label:'Sabab',value:t.reason||t.note||'Eski transferda qayd etilmagan'}]}/>}
    {!t&&<div className="inline-note"><Icon name="info"/>Eski darhol transfer: chiqim va kirim yozilgan, ammo alohida transfer auditi saqlanmagan.</div>}
    {t&&<SectionTitle title="LOT / serial bo‘yicha"/>}
    {t&&<div className="table-scroll"><table className="fit"><thead><tr><th>LOT / serial</th><th className="align-right">Jo‘natilgan</th><th className="align-right">Qabul</th><th className="align-right">Qaytgan</th><th className="align-right">Yo‘lda</th></tr></thead><tbody>{t.lines.map(l=><tr key={l.lot||'none'}><td>{l.lot||<span className="soft-meta">LOT’siz</span>}{l.record?.expiry?<small className="cell-sub">muddati {l.record.expiry}</small>:null}</td><td className="align-right">{num(l.qty,1)}</td><td className="align-right">{num(l.received,1)}</td><td className="align-right">{num(l.returned,1)}</td><td className="align-right"><b>{num(r3(l.qty-l.received-l.returned),1)}</b></td></tr>)}</tbody></table></div>}
    <SectionTitle title="Tarix"/>
    <div className="stack-list">{t&&<div className="list-row"><span className="list-row-copy"><b>{t.mode==='immediate'?'Darhol ko‘chirildi':'Jo‘natildi'} · {qty(t.qty,unit,1)}</b><small>{t.createdAt} · {who(t.createdBy)} · {warehouseName(s,t.from)} → {warehouseName(s,t.to)} · {t.reason||t.note||'Eski transferda sabab yo‘q'}</small></span><StatusBadge tone={t.mode==='immediate'?'success':'warning'}>{t.mode==='immediate'?'Darhol':'Yo‘lga'}</StatusBadge></div>}
      {t?.receipts.map(r=><div className="list-row" key={r.id}><span className="list-row-copy"><b>{r.kind==='receipt'?'Qabul qilindi':'Manbaga qaytarildi'} · {qty(r.qty,unit,1)}</b><small>{r.at} · {who(r.by)}{r.lots.some(x=>x.lot)?` · ${r.lots.map(x=>`${x.lot||'LOT’siz'} ${num(x.qty,1)}`).join(', ')}`:''}{r.note?` · ${r.note}`:''}</small></span><StatusBadge tone={r.kind==='receipt'?'success':'neutral'}>{r.kind==='receipt'?'Qabul':'Qaytish'}</StatusBadge></div>)}
      {!t&&moves.map(m=><div className="list-row" key={m.id}><span className="list-row-copy"><b>{m.type} · {num(Math.abs(m.qty),1)} {unit}</b><small>{m.date} · {warehouseName(s,m.warehouseId)}{m.lot?` · ${m.lot}`:''}</small></span></div>)}
    </div>
    {receive&&t&&<ReceiveTransferModal t={t} onClose={()=>setReceive(false)}/>}
    {back&&t&&<ReturnTransferModal t={t} onClose={()=>setBack(false)}/>}
  </Drawer>
}

function ReceiveTransferModal({t,onClose}:{t:StockTransfer;onClose:()=>void}){
  const app=useApp(),s=app.state,unit=itemUnitOf(s,t.itemId),open=transferOpen(t)
  const target=s.warehouses.find(w=>w.id===t.to)
  const [key]=useState(()=>`trr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`)
  const lines=t.lines.filter(l=>l.qty-l.received-l.returned>1e-9)
  const tracked=lines.some(l=>l.lot)
  const [parts,setParts]=useState<Record<string,string>>(()=>Object.fromEntries(lines.map(l=>[l.lot||'',String(r3(l.qty-l.received-l.returned))])))
  const [location,setLocation]=useState(t.toLocation||'')
  const errors=lines.map(l=>{const v=Number(parts[l.lot||'']||0),max=r3(l.qty-l.received-l.returned);return !(v>=0)||v>max+1e-9?`${l.lot||'LOT’siz'}: 0–${num(max,3)} ${unit}`:null}).filter(Boolean)
  const total=r3(lines.reduce((a,l)=>a+(Number(parts[l.lot||''])||0),0))
  const save=()=>{if(errors.length||total<=0)return;const r=app.receiveTransfer(t.id,{qty:total,lots:tracked?lines.map(l=>({lot:l.lot,qty:Number(parts[l.lot||''])||0})).filter(x=>x.qty>0):undefined,toLocation:location||undefined,key});if(r.ok)onClose()}
  return <Modal open onClose={onClose} title="Transferni qabul qilish" eyebrow={t.ref} subtitle={`Yo‘lda ${num(open,3)} ${unit} · qisman qabul mumkin`} size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><span className="soft-meta">Jami: <b>{num(total,3)} {unit}</b></span><button type="button" className="primary-glass-btn" disabled={Boolean(errors.length)||total<=0} onClick={save}><Icon name="check" size={16}/>Qabulni tasdiqlash</button></>}>
    <div className="stack-list">{lines.map(l=>{const max=r3(l.qty-l.received-l.returned);return <div className="list-row" key={l.lot||'none'}><span className="list-row-copy"><b>{l.lot||'LOT’siz qism'}</b><small>yo‘lda {num(max,3)} {unit}</small></span><div className="delivery-qty"><Input type="number" min="0" max={max} step="any" aria-label={`${l.lot||'LOT’siz'} qabul miqdori`} value={parts[l.lot||'']??''} onChange={e=>setParts(x=>({...x,[l.lot||'']:e.target.value}))}/></div></div>})}</div>
    {Boolean(target?.locations.length)&&<Field label="Qabul joyi"><Select value={location} onChange={setLocation}><option value="">Joysiz (keyin joylashtiriladi)</option>{target!.locations.map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>}
    {errors.length>0&&<div className="inline-note warning" role="alert"><Icon name="warning"/>{errors[0]}</div>}
    {!errors.length&&total>0&&total<open-1e-9&&<div className="inline-note"><Icon name="info"/>Qisman qabul: {num(r3(open-total),3)} {unit} yo‘lda qoladi.</div>}
  </Modal>
}

function ReturnTransferModal({t,onClose}:{t:StockTransfer;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [reason,setReason]=useState('')
  const valid=reason.trim().length>=5
  return <Modal open onClose={onClose} title="Manbaga qaytarish" eyebrow={t.ref} subtitle={`Yo‘ldagi ${num(transferOpen(t),3)} ${itemUnitOf(s,t.itemId)} ${warehouseName(s,t.from)} omboriga qaytadi; transfer yopiladi`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" disabled={!valid} onClick={()=>{if(app.returnTransfer(t.id,reason).ok)onClose()}}>Qaytarish</button></>}>
    <Field label="Sabab" required hint="Kamida 5 belgi · tarixga yoziladi" error={reason&&!valid?'Sababni to‘liqroq yozing':undefined}><Textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field>
  </Modal>
}

function CountModal({line,onClose}:{line:StockBalance;onClose:()=>void}){
  const app=useApp(),s=app.state
  const w=s.warehouses.find(x=>x.id===line.warehouseId)
  // '*' = the whole warehouse line; '' = unassigned stock; otherwise one location (audit #17).
  const [where,setWhere]=useState('*')
  const system=where==='*'?line.onHand:binQty(line,where)
  const [key]=useState(()=>`count-${line.id}-${Date.now()}`)
  const form=useForm({counted:String(line.onHand),note:'Cycle count'},v=>({counted:v.counted===''||Number(v.counted)<0?'Sanalgan miqdorni kiriting':where==='*'&&Number(v.counted)<line.reserved?`Rezervdan (${num(line.reserved,1)}) kam bo‘lmasin`:undefined,note:required(v.note,'Sabab')}))
  const delta=(Number(form.values.counted)||0)-system
  const tracked=lotTracked(s,keyOf(line))
  return <Modal open onClose={onClose} title="Inventarizatsiya sanog‘i" eyebrow={warehouseName(s,line.warehouseId)} subtitle={`${itemName(s,keyOf(line))} · tizimda ${num(system,1)} ${line.unit}`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.countStock(line.id,Number(v.counted),v.note.trim(),{location:where==='*'?undefined:where,key});if(r.ok)onClose();return r.ok})}>Sanoqni tasdiqlash</button></>}>
    <div className="form-stack">
      {Boolean(w?.locations.length||line.bins)&&<Field label="Sanoq joyi"><Select value={where} onChange={v=>{setWhere(v);form.set('counted',String(v==='*'?line.onHand:binQty(line,v)))}}><option value="*">Butun ombor qatori</option><option value="">Joysiz qoldiq · {num(unassignedQty(line),1)}</option>{w?.locations.map(l=><option key={l} value={l}>{l} · {num(binQty(line,l),1)}</option>)}</Select></Field>}
      {tracked&&delta<0&&<div className="inline-note warning"><Icon name="info"/>LOT bilan kuzatiladi: kamayish faqat {where==='*'?'':'shu joydagi '}LOT yozuvlaridan (FEFO, rezervdagilar tegilmaydi) hisobdan chiqariladi — LOT’siz qoldiq rad etiladi</div>}
      <Field label="Fizik sanalgan miqdor" required error={form.error('counted')}><Input type="number" min="0" step="any" {...form.input('counted')} autoFocus/></Field>
      <div className={`inline-note ${delta<0?'danger':delta>0?'warning':'success'}`}><Icon name={delta?'warning':'check'}/>Farq: <b>{delta>0?'+':''}{num(delta,2)} {line.unit}</b>{delta?' — Adjustment harakati yoziladi':' — tizim bilan mos'}</div>
      <Field label="Sabab / izoh" required error={form.error('note')}><Input {...form.input('note')}/></Field>
    </div>
  </Modal>
}

function Inventory(){
  const app=useApp(),s=app.state,rows=useStockRows(),navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[wh,setWh]=useSearchParamState('wh')
  const [line,setLine]=useState<StockBalance|null>(null)
  const counts=s.stockMovements.filter(m=>m.type.startsWith('Adjustment')&&m.source.startsWith('ADJ-'))
  return <div className="page-stack">
    <PageHeader title="Inventarizatsiya" subtitle="Sessiya bo‘yicha sanoq yoki tezkor cycle count · farq tasdiqlangach adjustment bo‘ladi"/>
    <div className="kpi-grid cols-3">
      <KPI label="Sanaladigan qatorlar" value={rows.filter(r=>!wh||r.warehouseId===wh).length} icon={<Icon name="warehouse"/>}/>
      <KPI label="Adjustment (30 kun)" value={counts.filter(m=>m.date.slice(0,10)>=addDays(todayISO(),-30)).length} tone="orange" icon={<Icon name="edit"/>} onClick={()=>navigate('/warehouse?view=movements&q=ADJ-')}/>
      <KPI label="Adjustment qiymati" value={money(counts.reduce((a,m)=>a+m.qty*(s.rawMaterials.find(x=>x.id===m.itemId)?.standardCost??s.products.find(x=>x.id===m.itemId)?.standardCost??0),0))} tone="purple" icon={<Icon name="wallet"/>}/>
    </div>
    <ResourceTable rows={rows.filter(r=>!wh||r.warehouseId===wh)} query={q} onQuery={setQ} placeholder="Item, SKU..." exportName="cycle-count" resetKey={wh}
      filters={<FilterSelect label="Ombor" value={wh} onChange={setWh} options={s.warehouses.map(w=>({value:w.id,label:w.name}))}/>} filtersActive={Boolean(wh)} onResetFilters={()=>setWh('')}
      columns={[
        {key:'name',label:'Item',value:r=>r.name,render:r=><div className="cell-main"><b>{r.name}</b><small>{r.sku}</small></div>},
        {key:'warehouse',label:'Ombor',value:r=>warehouseName(s,r.warehouseId)},
        {key:'locations',label:'Joylar',value:r=>locationRows(r).filter(x=>x.qty>0).map(x=>x.location||'Joysiz').join(' '),render:r=><LocationCell b={r}/>,priority:'low'},
        {key:'onHand',label:'Tizimda',align:'right',value:r=>r.onHand,render:r=>qty(r.onHand,r.unit,1)},
        {key:'reserved',label:'Rezerv',align:'right',value:r=>r.reserved,render:r=>num(r.reserved,1)},
        {key:'last',label:'Oxirgi sanoq',value:r=>counts.find(m=>keyOf(m)===keyOf(r)&&m.warehouseId===r.warehouseId)?.date||'—',priority:'low'},
        {key:'action',label:'',sortable:false,searchable:false,render:r=><button type="button" className="soft-glass-btn compact" disabled={!app.can('warehouse','edit')} onClick={()=>setLine(r)}><Icon name="edit" size={14}/>Sanash</button>},
      ]}/>
    <StockCounts/>
    <Reconciliation/>
    {line&&<CountModal line={line} onClose={()=>setLine(null)}/>}
  </div>
}

const COUNT_TONE:Record<StockCount['status'],Tone>={'Ochiq':'warning','Tasdiqlangan':'success','Bekor qilingan':'neutral'}
/** Stocktaking sessions: open one per store, count lines, compare with the system, approve as adjustments. */
function StockCounts(){
  const app=useApp(),s=app.state
  const [create,setCreate]=useState(false)
  const [id,setId]=useRecordParam('count')
  const counts=s.stockCounts||[]
  const selected=counts.find(c=>c.id===id)
  const canEdit=app.can('warehouse','edit')
  return <Card title="Inventarizatsiya sessiyalari" subtitle="Sanash → farqni ko‘rish → tasdiqlash (adjustment yoziladi)" actions={<button type="button" className="primary-glass-btn compact" disabled={!canEdit} onClick={()=>setCreate(true)}><Icon name="plus" size={15}/>Yangi inventarizatsiya</button>}>
    {counts.length?<div className="stack-list">{counts.map(c=>{const counted=c.lines.filter(l=>l.counted!==undefined),diff=counted.filter(l=>Math.abs(countDelta(l)||0)>1e-9)
      return <button type="button" key={c.id} className="list-row is-clickable" onClick={()=>setId(c.id)}><span className="list-row-copy"><b>{c.ref} · {warehouseName(s,c.warehouseId)}</b><small>{c.createdAt.slice(0,16)} · sanalgan {counted.length}/{c.lines.length} · farqli {diff.length}{c.note?` · ${c.note}`:''}</small></span><StatusBadge tone={COUNT_TONE[c.status]}>{c.status}</StatusBadge></button>})}</div>
      :<Empty compact icon="edit" title="Inventarizatsiya hali o‘tkazilmagan" text="Ombor bo‘yicha sessiya oching: tizim qoldig‘i qayd etiladi, sanalgan miqdor bilan solishtiriladi."/>}
    {create&&<CreateCountModal onClose={()=>setCreate(false)} onCreated={setId}/>}
    {selected&&<CountDrawer key={selected.id} count={selected} onClose={()=>setId(null)}/>}
  </Card>
}

function CreateCountModal({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
  const app=useApp(),s=app.state
  const scope=stockScope(s,app.currentEmployee)
  const stores=s.warehouses.filter(w=>w.status==='Faol'&&(!scope||scope.has(w.id)))
  const [wh,setWh]=useState(stores[0]?.id||''),[note,setNote]=useState('')
  const lines=s.stockBalances.filter(b=>b.warehouseId===wh).length
  const busy=(s.stockCounts||[]).find(c=>c.warehouseId===wh&&c.status==='Ochiq')
  const save=()=>{const r=app.createStockCount({warehouseId:wh,note});if(r.ok&&r.id){onCreated(r.id);onClose()}}
  return <Modal open onClose={onClose} title="Yangi inventarizatsiya" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!wh||!lines||Boolean(busy)} onClick={save}><Icon name="check" size={16}/>Ochish</button></>}>
    <div className="form-stack">
      <Field label="Ombor" required><Select value={wh} onChange={setWh}>{stores.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      <Field label="Izoh"><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Masalan: oylik to‘liq sanoq"/></Field>
      {busy?<div className="inline-note warning" role="alert"><Icon name="warning"/>{busy.ref} shu ombor uchun ochiq — avval uni yakunlang.</div>
        :<div className="inline-note"><Icon name="info"/>{lines?`${lines} ta qoldiq qatori sessiyaga kiritiladi.`:'Bu omborda qoldiq qatori yo‘q.'}</div>}
    </div>
  </Modal>
}

function CountDrawer({count,onClose}:{count:StockCount;onClose:()=>void}){
  const app=useApp(),s=app.state
  const open=count.status==='Ochiq'&&app.can('warehouse','edit')
  const [draft,setDraft]=useState<Record<string,string>>(()=>Object.fromEntries(count.lines.map(l=>[l.balanceId,l.counted===undefined?'':String(l.counted)])))
  const [q,setQ]=useState(''),[decide,setDecide]=useState<'approve'|'cancel'|null>(null),[reason,setReason]=useState('')
  const dirty=count.lines.filter(l=>(draft[l.balanceId]??'')!==(l.counted===undefined?'':String(l.counted)))
  const invalid=dirty.filter(l=>{const v=draft[l.balanceId];return v!==''&&!(Number(v)>=0)})
  const saveCounts=()=>{for(const l of dirty){if(invalid.includes(l))continue;app.recordStockCount(count.id,l.balanceId,draft[l.balanceId]===''?null:Number(draft[l.balanceId]))}}
  const counted=count.lines.filter(l=>l.counted!==undefined)
  const diffs=counted.filter(l=>Math.abs(countDelta(l)||0)>1e-9)
  const value=diffs.reduce((a,l)=>a+(countDelta(l)||0)*unitCost(s,l.itemKey),0)
  const shown=count.lines.filter(l=>!q.trim()||`${itemName(s,l.itemKey)} ${itemSku(s,l.itemKey)}`.toLowerCase().includes(q.trim().toLowerCase()))
  const current=(l:StockCount['lines'][number])=>s.stockBalances.find(b=>b.id===l.balanceId)?.onHand
  return <Drawer open onClose={onClose} title={count.ref} eyebrow="Inventarizatsiya" icon="edit" size="lg" subtitle={`${warehouseName(s,count.warehouseId)} · ${count.createdAt.slice(0,16)}${count.note?` · ${count.note}`:''}`} headerExtra={<StatusBadge tone={COUNT_TONE[count.status]}>{count.status}</StatusBadge>}
    actions={open?<><button type="button" className="ghost-btn" onClick={()=>{setReason('');setDecide('cancel')}}><Icon name="x" size={15}/>Bekor qilish</button><span className="spacer"/><button type="button" className="secondary-glass-btn" disabled={!dirty.length||Boolean(invalid.length)} onClick={saveCounts}><Icon name="check" size={15}/>Sanoqni saqlash{dirty.length?` (${dirty.length})`:''}</button><button type="button" className="primary-glass-btn" disabled={!counted.length||dirty.length>0} title={dirty.length?'Avval sanoqni saqlang':undefined} onClick={()=>{setReason('');setDecide('approve')}}><Icon name="shield" size={15}/>Tasdiqlash</button></>:undefined}>
    <InfoGrid columns={4} items={[{label:'Qatorlar',value:count.lines.length},{label:'Sanalgan',value:counted.length},{label:'Farqli',value:diffs.length,tone:diffs.length?'warning':undefined},{label:'Farq qiymati',value:money(value),tone:value<0?'danger':undefined}]}/>
    {count.status==='Tasdiqlangan'&&<div className="inline-note success"><Icon name="check"/>Tasdiqlangan {count.approvedAt?.slice(0,16)} · {s.employees.find(e=>e.id===count.approvedBy)?.name||count.approvedBy} · {count.reason}{count.adjustments?.length?` · ${count.adjustments.join(', ')}`:' · farq yo‘q'}</div>}
    {count.status==='Bekor qilingan'&&<div className="inline-note"><Icon name="info"/>Bekor qilingan · {count.reason} · qoldiq o‘zgarmadi</div>}
    {count.lines.length>8&&<Input type="search" placeholder="Item yoki SKU" aria-label="Sanoq qatorini qidirish" value={q} onChange={e=>setQ(e.target.value)}/>}
    <div className="table-scroll"><table className="fit count-table"><thead><tr><th>Item</th><th className="align-right">Tizimda</th><th className="align-right">Sanalgan</th><th className="align-right">Farq</th></tr></thead><tbody>{shown.map(l=>{
      const d=countDelta(l),now=current(l),moved=count.status==='Ochiq'&&l.counted!==undefined&&now!==undefined&&Math.abs(now-l.expected)>1e-6,unit=itemUnitOf(s,l.itemKey)
      return <tr key={l.balanceId} className={moved?'row-warning':undefined}><td><div className="cell-main"><b>{itemName(s,l.itemKey)}</b><small>{itemSku(s,l.itemKey)}{moved?` · sanoqdan keyin qoldiq o‘zgardi (${num(now!,3)}) — qayta sanang`:''}</small></div></td>
        <td className="align-right">{num(count.status==='Ochiq'&&l.counted===undefined&&now!==undefined?now:l.expected,3)} {unit}</td>
        <td className="align-right">{open?<input className="ui-input cell-input" type="number" min="0" step="any" aria-label={`${itemName(s,l.itemKey)} sanalgan miqdori`} value={draft[l.balanceId]??''} onChange={e=>setDraft(x=>({...x,[l.balanceId]:e.target.value}))}/>:l.counted===undefined?<span className="soft-meta">—</span>:num(l.counted,3)}</td>
        <td className={`align-right ${d&&d<0?'negative':''}`}>{d===undefined?<span className="soft-meta">sanalmagan</span>:<b>{d>0?'+':''}{num(d,3)}</b>}</td></tr>})}</tbody></table></div>
    {invalid.length>0&&<div className="inline-note warning" role="alert"><Icon name="warning"/>Sanalgan miqdor 0 yoki musbat son bo‘lsin ({invalid.map(l=>itemName(s,l.itemKey)).join(', ')})</div>}
    <ActivityPanel sources={[count.ref,...(count.adjustments||[])]}/>
    {decide&&<Modal open onClose={()=>setDecide(null)} title={decide==='approve'?'Inventarizatsiyani tasdiqlash':'Inventarizatsiyani bekor qilish'} size="sm"
      footer={<><button type="button" className="secondary-glass-btn" onClick={()=>setDecide(null)}>Ortga</button><button type="button" className={decide==='approve'?'primary-glass-btn':'danger-glass-btn'} disabled={reason.trim().length<5} onClick={()=>{const r=decide==='approve'?app.approveStockCount(count.id,reason):app.cancelStockCount(count.id,reason);if(r.ok)setDecide(null)}}>{decide==='approve'?'Tasdiqlash':'Bekor qilish'}</button></>}>
      <div className="form-stack">
        {decide==='approve'?<div className="inline-note warning"><Icon name="warning"/>{diffs.length} ta farqli qator adjustment sifatida yoziladi (jami {money(value)}). Sanalmagan {count.lines.length-counted.length} ta qator o‘zgarmaydi.</div>:<div className="inline-note"><Icon name="info"/>Sanoqlar saqlanadi, qoldiq o‘zgarmaydi.</div>}
        <Field label={decide==='approve'?'Tasdiqlash izohi':'Sabab'} required hint="Kamida 5 belgi · auditga yoziladi"><Textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field>
      </div>
    </Modal>}
  </Drawer>
}

const ISSUE_LABEL:Record<IntegrityIssue['kind'],string>={'legacy-reservation':'LOT’siz eski rezerv','variant-unassigned':'Variant aniqlanmagan','bins-exceed':'Joylar > qoldiq','bin-negative':'Manfiy joy','bin-unknown':'Noma’lum joy','lot-location':'LOT joyi mos emas'}
/**
 * What needs an explicit decision (Phase 3): legacy reservations without lots, product stock no variant owns, and
 * location breakdowns that disagree with their balance. Nothing here is repaired automatically.
 */
function Reconciliation(){
  const app=useApp(),s=app.state
  const issues=useMemo(()=>inventoryIssues(s,k=>lotTracked(s,k),o=>orderReservations(s,o)),[s])
  const [assign,setAssign]=useState<IntegrityIssue|null>(null)
  const canEdit=app.can('warehouse','edit')
  return <Card title="Muvofiqlashtirish" subtitle="Eski ma’lumotdagi noaniqliklar — avtomatik tuzatilmaydi, faqat aniq qaror bilan" className="reconcile-card">
    {!issues.length?<Empty compact icon="check" title="Muvofiqlashtirish kerak emas" text="Rezervlar LOT’ga bog‘langan, variant qoldig‘i aniqlangan, joylar qoldiq bilan mos"/>
      :<div className="table-scroll"><table className="fit"><thead><tr><th>Holat</th><th>Item</th><th>Ombor</th><th className="align-right">Miqdor</th><th>Izoh</th><th/></tr></thead><tbody>
        {issues.map((i,n)=><tr key={`${i.kind}-${i.warehouseId}-${i.itemKey}-${n}`}>
          <td><StatusBadge tone={i.kind==='legacy-reservation'||i.kind==='variant-unassigned'?'warning':'danger'}>{ISSUE_LABEL[i.kind]}</StatusBadge></td>
          <td>{itemName(s,i.itemKey)}</td><td>{warehouseName(s,i.warehouseId)}</td>
          <td className="align-right">{qty(i.qty,itemUnitOf(s,i.itemKey),1)}</td><td className="wrap">{i.text}</td>
          <td className="align-right">{i.kind==='legacy-reservation'&&i.ref?<button type="button" className="soft-glass-btn compact" disabled={!canEdit} title={canEdit?'FEFO bo‘yicha yaroqli LOT’lar bog‘lanadi; yetmasa hech narsa o‘zgarmaydi':'Ruxsat yo‘q'} onClick={()=>app.allocateLegacyLots(i.ref!.kind,i.ref!.id)}>LOT bilan bog‘lash</button>
            :i.kind==='variant-unassigned'?<button type="button" className="soft-glass-btn compact" disabled={!canEdit} onClick={()=>setAssign(i)}>Variantga biriktirish</button>:null}</td>
        </tr>)}
      </tbody></table></div>}
    {assign&&<AssignVariantModal issue={assign} onClose={()=>setAssign(null)}/>}
  </Card>
}

function AssignVariantModal({issue,onClose}:{issue:IntegrityIssue;onClose:()=>void}){
  const app=useApp(),s=app.state
  const product=s.products.find(p=>p.id===issue.itemKey)
  const b=s.stockBalances.find(x=>x.warehouseId===issue.warehouseId&&keyOf(x)===issue.itemKey)
  const free=b?Math.max(0,b.onHand-b.reserved-(b.quarantine||0)):0
  const lots=lotsAt(s,issue.warehouseId,issue.itemKey,'').concat(...(b?Object.keys(b.bins||{}).map(l=>lotsAt(s,issue.warehouseId,issue.itemKey,l)):[]))
  const form=useForm({variantId:product?.variants.find(v=>v.status==='Faol')?.id||'',qty:'',lot:'',note:'Sanoq'},v=>({variantId:v.variantId?undefined:'Variantni tanlang',qty:!(Number(v.qty)>0)?'Miqdor kiriting':Number(v.qty)>free+1e-9?`Bo‘sh ${num(free,1)}`:undefined,note:required(v.note,'Asos')}))
  return <Modal open onClose={onClose} title="Variantga biriktirish" eyebrow={warehouseName(s,issue.warehouseId)} subtitle={`${product?.name||issue.itemKey} · variant aniqlanmagan bo‘sh qoldiq ${num(free,1)} ${product?.unit||''}`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.assignVariantStock({warehouseId:issue.warehouseId,productId:issue.itemKey,variantId:v.variantId,qty:Number(v.qty),lot:v.lot||undefined,note:v.note.trim()});if(r.ok)onClose();return r.ok})}>Biriktirish</button></>}>
    <div className="form-stack">
      <div className="inline-note warning"><Icon name="info"/>Qoldiq avtomatik taqsimlanmaydi: faqat sanab tasdiqlangan miqdorni tanlangan variantga o‘tkazing. Rezerv va karantindagi qism ko‘chmaydi.</div>
      <Field label="Variant" required error={form.error('variantId')}><Select value={form.values.variantId} onChange={v=>form.set('variantId',v)}>{product?.variants.filter(v=>v.status==='Faol').map(v=><option key={v.id} value={v.id}>{v.code} · {v.attributes}</option>)}</Select></Field>
      {lots.length>0&&<Field label="LOT" hint="Ixtiyoriy: bo‘sh qoldirilsa FEFO"><Select value={form.values.lot} onChange={v=>form.set('lot',v)}><option value="">FEFO</option>{[...new Set(lots.map(l=>l.code))].map(c=><option key={c} value={c}>{c}</option>)}</Select></Field>}
      <Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="0" step="any" {...form.input('qty')} autoFocus/></Field>
      <Field label="Asos (sanoq / hujjat)" required error={form.error('note')}><Input {...form.input('note')}/></Field>
    </div>
  </Modal>
}

function WarehouseModal({warehouse,onClose}:{warehouse?:WarehouseType;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({name:warehouse?.name||'',code:warehouse?.code||'WH-',branchId:warehouse?.branchId||s.branches[0]?.id||'',type:warehouse?.type||'Raw',status:warehouse?.status||'Faol'},v=>({name:required(v.name,'Nomi'),code:required(v.code,'Kod')||(s.warehouses.some(w=>w.id!==warehouse?.id&&w.code.toLowerCase()===v.code.trim().toLowerCase())?'Kod band':undefined)}))
  return <Modal open onClose={onClose} title={warehouse?'Omborni tahrirlash':'Yangi ombor'} size="md" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const payload={...v,name:v.name.trim(),code:v.code.trim().toUpperCase()};const r=warehouse?app.updateEntity('warehouses',warehouse.id,payload):app.createEntity('warehouses',{...payload,locations:['RECEIVING','STORAGE-A']});if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-grid">
      <Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Kod" required error={form.error('code')}><Input {...form.input('code')}/></Field>
      <Field label="Filial"><Select value={form.values.branchId} onChange={v=>form.set('branchId',v)}>{s.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v as WarehouseType['type'])}>{[['Raw','Xomashyo'],['WIP','WIP'],['Finished','Tayyor mahsulot'],['Mixed','Aralash']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v as WarehouseType['status'])}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field>
    </div>
  </Modal>
}

function Warehouses(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [edit,setEdit]=useState<WarehouseType|null|'new'>(null)
  return <div className="page-stack">
    <PageHeader title="Omborlar" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('warehouse','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Ombor qo‘shish</button>}/>
    <div className="card-grid">{s.warehouses.map(w=>{const lines=s.stockBalances.filter(b=>b.warehouseId===w.id),value=inventoryValuation(s,lines);return <Card key={w.id} className="entity-card">
      <div className="entity-card-head"><span className="entity-card-media"><Icon name="warehouse"/></span><div className="entity-card-title"><h3>{w.name}</h3><small>{w.code} · {s.branches.find(b=>b.id===w.branchId)?.name}</small></div><StatusBadge>{w.status}</StatusBadge></div>
      <div className="entity-card-body"><InfoGrid columns={2} items={[{label:'Tur',value:w.type},{label:'Stock qatorlari',value:lines.length},{label:'Qiymat (standart)',value:money(value.standard)},{label:'Qiymat (LOT)',value:`${money(value.actual)}${Math.abs(value.variance)>0.005?` · farq ${signedMoney(value.variance)}`:''}`},{label:'Lokatsiyalar',value:w.locations.length}]}/></div>
      <div className="entity-card-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>navigate(`/warehouse?view=stock&wh=${w.id}`)}>Qoldiqlar</button>{app.can('warehouse','edit')&&<button type="button" className="ghost-btn" onClick={()=>setEdit(w)}><Icon name="edit" size={14}/>Tahrirlash</button>}</div>
    </Card>})}</div>
    {edit&&<WarehouseModal warehouse={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
  </div>
}

/** Moves stock between two locations of one warehouse; lots only from where their records are (audit #17). */
function BinMoveModal({warehouseId,onClose}:{warehouseId:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const w=s.warehouses.find(x=>x.id===warehouseId)!
  const lines=s.stockBalances.filter(b=>b.warehouseId===warehouseId&&b.onHand>1e-9)
  const [unit,setUnit]=useState('')
  const form=useForm({line:lines[0]?.id||'',from:'',to:w.locations[0]||'',lot:'',qty:''},v=>{
    const line=lines.find(x=>x.id===v.line),here=line?binQty(line,v.from):0,amount=stockQtyOf(s,line?keyOf(line):undefined,v.qty,unit)
    return {line:line?undefined:'Item tanlang',to:v.to===v.from?'Manba va qabul joyi bir xil':undefined,qty:amount.error||(!(amount.value>0)?'Miqdor kiriting':amount.value>here+1e-9?`${v.from||'Joysiz'}da ${num(here,1)}`:undefined)}})
  const b=lines.find(x=>x.id===form.values.line)
  const amount=stockQtyOf(s,b?keyOf(b):undefined,form.values.qty,unit)
  const lots=b?lotsAt(s,warehouseId,keyOf(b),form.values.from):[]
  const loose=b?untrackedAt(s,b,form.values.from):0
  return <Modal open onClose={onClose} title="Joy almashtirish" eyebrow={w.name} subtitle="Ombor jami o‘zgarmaydi · LOT manbasi saqlanadi" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.moveStockBin({warehouseId,itemId:keyOf(b!),from:v.from,to:v.to,qty:Number(v.qty),lot:v.lot||undefined,unit:unit||undefined});if(r.ok)onClose();return r.ok})}><Icon name="arrow-right" size={16}/>Ko‘chirish</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Item" required error={form.error('line')}><Select value={form.values.line} onChange={v=>{form.set('line',v);form.set('lot','');setUnit('')}}>{lines.map(x=><option key={x.id} value={x.id}>{itemName(s,keyOf(x))} · {num(x.onHand,1)} {x.unit}</option>)}</Select></Field>
      <Field label="Qayerdan" required><Select value={form.values.from} onChange={v=>{form.set('from',v);form.set('lot','')}}><option value="">Joysiz qoldiq · {num(unassignedQty(b),1)}</option>{w.locations.map(l=><option key={l} value={l}>{l} · {num(binQty(b,l),1)}</option>)}</Select></Field>
      <Field label="Qayerga" required error={form.error('to')}><Select value={form.values.to} onChange={v=>form.set('to',v)}><option value="">Joysiz qoldiq</option>{w.locations.map(l=><option key={l} value={l}>{l}</option>)}</Select></Field>
      {lots.length>0&&<Field className="span-2" label="LOT" hint={`Bo‘sh qoldirilsa avval shu joydagi LOT’lar (FEFO), keyin LOT’siz qoldiq (${num(loose,1)})`}><Select value={form.values.lot} onChange={v=>form.set('lot',v)}><option value="">FEFO</option>{lots.map(l=><option key={l.id} value={l.code}>{l.code} · {num(l.qty,1)}{l.status&&l.status!=='available'?` · ${l.status}`:''}</option>)}</Select></Field>}
      <Field className="span-2" label="Miqdor" required error={form.error('qty')} hint={amount.converted}><div className="inline-row"><Input type="number" min="0" step="any" aria-label="Miqdor" {...form.input('qty')}/>{b&&<UnitSelect itemId={keyOf(b)} value={unit} onChange={setUnit}/>}</div></Field>
    </div>
  </Modal>
}

function Locations(){
  const app=useApp(),s=app.state
  const [adding,setAdding]=useState<string|null>(null),[value,setValue]=useState('')
  const [moving,setMoving]=useState<string|null>(null)
  const held=(w:WarehouseType,loc:string)=>s.stockBalances.filter(b=>b.warehouseId===w.id&&binQty(b,loc)>1e-9).length
  const add=(w:WarehouseType)=>{const code=value.trim().toUpperCase();if(!code)return;if(w.locations.includes(code)){app.toast('Bu lokatsiya allaqachon mavjud','warning');return}if(app.updateEntity('warehouses',w.id,{locations:[...w.locations,code]}).ok){setValue('');setAdding(null)}}
  return <div className="page-stack">
    <PageHeader title="Lokatsiyalar" subtitle="Qabul, saqlash, QC hold, jo‘natish zonalari"/>
    <div className="card-grid">{s.warehouses.map(w=><Card key={w.id} title={w.name} subtitle={`${w.code} · ${w.locations.length} lokatsiya`}>
      <div className="location-list">{w.locations.map(l=>{const n=held(w,l);return <span key={l} className="location-chip" title={n?`${n} ta item qoldig‘i`:'Bo‘sh'}><Icon name="tag" size={12}/>{l}{n>0&&<small className="soft-meta">· {n}</small>}{app.can('warehouse','edit')&&<button type="button" aria-label={`${l} — o‘chirish`} disabled={n>0} title={n?'Joyda qoldiq bor — avval ko‘chiring':undefined} onClick={()=>app.updateEntity('warehouses',w.id,{locations:w.locations.filter(x=>x!==l)})}><Icon name="x" size={12}/></button>}</span>})}{!w.locations.length&&<span className="soft-meta">Lokatsiya yo‘q</span>}</div>
      {s.stockBalances.some(b=>b.warehouseId===w.id&&unassignedQty(b)>1e-9)&&<p className="soft-meta">Joysiz qoldiq: {s.stockBalances.filter(b=>b.warehouseId===w.id&&unassignedQty(b)>1e-9).length} ta item — joyga ko‘chirib aniqlashtiring</p>}
      {app.can('warehouse','edit')&&w.status==='Faol'&&s.stockBalances.some(b=>b.warehouseId===w.id&&b.onHand>0)&&<button type="button" className="soft-glass-btn compact" onClick={()=>setMoving(w.id)}><Icon name="arrow-right" size={14}/>Joy almashtirish</button>}
      {app.can('warehouse','edit')&&(adding===w.id?<form className="inline-row" onSubmit={e=>{e.preventDefault();add(w)}}><Input value={value} onChange={e=>setValue(e.target.value)} placeholder="Masalan: RACK-B3" aria-label="Yangi lokatsiya" autoFocus/><button type="submit" className="primary-glass-btn compact" disabled={!value.trim()}>Qo‘shish</button><button type="button" className="ghost-btn" onClick={()=>{setAdding(null);setValue('')}}>Bekor</button></form>:<button type="button" className="ghost-btn" onClick={()=>{setAdding(w.id);setValue('')}}><Icon name="plus" size={14}/>Lokatsiya qo‘shish</button>)}
    </Card>)}</div>
    {moving&&<BinMoveModal warehouseId={moving} onClose={()=>setMoving(null)}/>}
  </div>
}

function lotStatus(l:LotRecord){
  if(l.qty<=0)return 'Sarflangan'
  if(l.status==='quarantine')return 'QC hold'
  if(l.status==='hold')return 'Hold'
  if(l.status==='rework')return 'Rework'
  if(l.expiry&&l.expiry<todayISO())return 'Muddati o‘tgan'
  if(l.expiry&&l.expiry<=addDays(todayISO(),30))return 'Muddati yaqin'
  return 'Faol'
}

function Lots({kind}:{kind:'lot'|'serial'}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[type,setType]=useSearchParamState('type'),[status,setStatus]=useSearchParamState('status')
  const [label,setLabel]=useState<LabelData|null>(null)
  const rows=s.lots.filter(l=>l.kind===kind&&(!type||l.itemType===type)&&(!status||lotStatus(l)===status))
  return <div className="page-stack">
    <PageHeader title={kind==='lot'?'Lot / Partiyalar':'Serial raqamlar'} subtitle={kind==='lot'?'Manba, ombor, QC holati, expiry va sarf (FEFO/FIFO)':'Serial diapazonlari'}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder={kind==='lot'?'Lot, item, manba...':'Serial, mahsulot, MO...'} onRow={app.can('reports')?l=>navigate(`/reports?view=traceability&q=${encodeURIComponent(l.kind==='serial'?l.serialFrom||l.code:l.code)}`):undefined} exportName={kind==='lot'?'lots':'serials'} resetKey={`${type}|${status}`}
      filtersActive={Boolean(type||status)} onResetFilters={()=>{setType('');setStatus('')}}
      filters={<>{kind==='lot'&&<FilterSelect label="Tur" value={type} onChange={setType} options={[{value:'raw',label:'Xomashyo'},{value:'finished',label:'Mahsulot'}]}/>}<FilterSelect label="Holat" value={status} onChange={setStatus} options={['Faol','QC hold','Hold','Rework','Muddati yaqin','Muddati o‘tgan','Sarflangan']}/></>}
      emptyText={kind==='serial'?'Serial mahsulot ishlab chiqarilganda yaratiladi':undefined}
      rowClassName={l=>lotStatus(l)==='Sarflangan'?'row-muted':lotStatus(l).startsWith('Muddati')?'row-warning':undefined}
      columns={[
        {key:'code',label:kind==='lot'?'Lot':'Serial diapazon',value:l=>l.code,render:l=><div className="cell-main"><b>{l.code}</b><small>{itemName(s,keyOf(l))}</small></div>},
        {key:'source',label:'Manba',value:l=>l.sourceCode,render:l=><span>{l.sourceCode}<small className="cell-sub">{l.sourceType==='purchase'?'Xarid':l.sourceType==='production'?'Ishlab chiqarish':l.sourceType==='return'?'Qaytarish':'Boshlang‘ich'}</small></span>},
        {key:'date',label:'Sana',value:l=>l.createdAt.slice(0,10)},
        {key:'warehouse',label:'Ombor',value:l=>`${warehouseName(s,l.warehouseId)}${l.location?` · ${l.location}`:''}`,priority:'low'},
        {key:'qty',label:'Qoldiq',align:'right',value:l=>l.qty,render:l=>qty(l.qty,itemUnitOf(s,l.itemId),1)},
        {key:'expiry',label:'Expiry',value:l=>l.expiry||'—',priority:'low'},
        {key:'status',label:'Holat',value:l=>lotStatus(l),render:l=><StatusBadge tone={lotStatus(l)==='Faol'?'success':lotStatus(l)==='Sarflangan'?'neutral':lotStatus(l)==='Rework'?'info':'warning'}>{lotStatus(l)}</StatusBadge>},
        {key:'used',label:'Sarflangan',value:l=>l.consumedBy.join(', '),render:l=><span className="truncate">{l.consumedBy.slice(0,3).join(', ')||'—'}{l.consumedBy.length>3?` +${l.consumedBy.length-3}`:''}</span>,priority:'low'},
        {key:'label',label:'',sortable:false,searchable:false,render:l=><button type="button" className="icon-ghost" aria-label={`${l.code} — label`} onClick={()=>setLabel({title:itemName(s,l.itemId),code:l.kind==='serial'?l.serialFrom||l.code:l.code,lines:[['SKU',itemSku(s,l.itemId)],['Manba',l.sourceCode],['Miqdor',qty(l.qty,itemUnitOf(s,l.itemId),1)],['Sana',l.createdAt.slice(0,10)]]})}><Icon name="printer" size={15}/></button>},
      ]}/>
    <LabelModal label={label} onClose={()=>setLabel(null)}/>
  </div>
}

/** Serial register (audit #25): one row per unit with where it is or how it left; legacy range records listed apart. */
function Serials(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status')
  const [label,setLabel]=useState<LabelData|null>(null)
  const {lots,stockMovements}=s
  const register=useMemo(()=>serialRegister({lots,stockMovements}),[lots,stockMovements])
  const issues=useMemo(()=>serialIssues({lots}),[lots])
  const legacy=issues.legacyRanges
  const rows=register.filter(r=>!status||SERIAL_STATUS_LABEL[r.status]===status).map(r=>({...r,id:`${r.itemId}|${r.serial}`}))
  const where=(r:SerialStatus)=>r.warehouseId?`${warehouseName(s,r.warehouseId)}${r.location?` · ${r.location}`:''}`:'—'
  const last=(r:SerialStatus)=>r.history.at(-1)
  const tone=(r:SerialStatus)=>r.status==='available'?'success':r.status==='sold'||r.status==='consumed'?'neutral':r.status==='unknown'?'danger':'warning'
  return <div className="page-stack">
    <PageHeader title="Serial raqamlar" subtitle="Har bir birlik: qayerda, qanday holatda, qayerdan kelgan va qayerga ketgan"/>
    {issues.problems.length>0&&<div className="inline-note danger" role="alert"><Icon name="warning" size={15}/>Serial ma’lumotida ziddiyat: {issues.problems.slice(0,3).join('; ')}{issues.problems.length>3?` (+${issues.problems.length-3})`:''}</div>}
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Serial, mahsulot, MO, ombor..." onRow={app.can('reports')?r=>navigate(`/reports?view=traceability&q=${encodeURIComponent(r.serial)}`):undefined} exportName="serials" resetKey={status}
      filtersActive={Boolean(status)} onResetFilters={()=>setStatus('')}
      filters={<FilterSelect label="Holat" value={status} onChange={setStatus} options={Object.values(SERIAL_STATUS_LABEL)}/>}
      emptyText="Serial kuzatiladigan mahsulot ishlab chiqarilganda yoki serial material qabul qilinganda har bir birlik shu yerda paydo bo‘ladi"
      rowClassName={r=>r.record?undefined:'row-muted'}
      columns={[
        {key:'serial',label:'Serial',value:r=>r.serial,render:r=><div className="cell-main"><b>{r.serial}</b><small>{itemName(s,r.record?keyOf(r.record):r.itemId)}</small></div>},
        {key:'status',label:'Holat',value:r=>SERIAL_STATUS_LABEL[r.status],render:r=><StatusBadge tone={tone(r)}>{SERIAL_STATUS_LABEL[r.status]}</StatusBadge>},
        {key:'where',label:'Ombor / joy',value:where},
        {key:'origin',label:'Manba',value:r=>r.origin?.sourceCode||'—',render:r=><span>{r.origin?.sourceCode||'—'}<small className="cell-sub">{r.origin?.batch||''}</small></span>},
        {key:'last',label:'So‘nggi harakat',value:r=>last(r)?.date||'',render:r=>{const m=last(r);return m?<span>{m.type} · {m.source}<small className="cell-sub">{m.date}</small></span>:'—'},priority:'low'},
        {key:'label',label:'',sortable:false,searchable:false,render:r=><button type="button" className="icon-ghost" aria-label={`${r.serial} — label`} onClick={e=>{e.stopPropagation();setLabel({title:itemName(s,r.itemId),code:r.serial,lines:[['SKU',itemSku(s,r.itemId)],['Manba',r.origin?.sourceCode||'—'],['Holat',SERIAL_STATUS_LABEL[r.status]]]})}}><Icon name="printer" size={15}/></button>},
      ]}/>
    {legacy.length>0&&<Card title={`Eski serial diapazonlari (${legacy.length})`}>
      <p className="muted">Bu yozuvlar birlik bo‘yicha kuzatuvdan oldin saqlangan: diapazondan qaysi raqamlar qolgani noma’lum, shuning uchun alohida birliklar o‘ylab topilmaydi. Miqdor bo‘yicha ishlatish davom etadi; bu raqamlar qayta ro‘yxatga olinmaydi.</p>
      <div className="table-scroll"><table className="fit"><thead><tr><th>Diapazon</th><th>Mahsulot</th><th>Manba</th><th>Ombor</th><th className="align-right">Qoldiq</th></tr></thead>
        <tbody>{legacy.filter(isLegacyRange).map(l=><tr key={l.id}><td>{l.code}</td><td>{itemName(s,keyOf(l))}</td><td>{l.sourceCode}</td><td>{warehouseName(s,l.warehouseId)}</td><td className="align-right">{qty(l.qty,itemUnitOf(s,l.itemId),1)}</td></tr>)}</tbody></table></div>
    </Card>}
    <LabelModal label={label} onClose={()=>setLabel(null)}/>
  </div>
}

type ScanHit={type:string;title:string;meta:string;path:string;label?:LabelData}
function resolveScan(s:ReturnType<typeof useApp>['state'],code:string):ScanHit|null{
  const v=code.trim().toLowerCase()
  if(!v)return null
  const product=s.products.find(p=>p.sku.toLowerCase()===v)
  if(product){const st=stockOf(s,product.id);return {type:'Mahsulot',title:product.name,meta:`${product.sku} · available ${num(st.available)} ${product.unit}`,path:`/products?view=all&id=${product.id}`,label:{title:product.name,code:product.sku,lines:[['SKU',product.sku],['Kategoriya',product.category],['Narx',money(product.salePrice)],['Available',num(st.available)]]}}}
  const material=s.rawMaterials.find(m=>m.sku.toLowerCase()===v)
  if(material){const st=stockOf(s,material.id);return {type:'Xomashyo',title:material.name,meta:`${material.sku} · available ${num(st.available)} ${material.unit}`,path:`/materials?view=all&id=${material.id}`,label:{title:material.name,code:material.sku,lines:[['SKU',material.sku],['Kategoriya',material.category],['Supplier',s.suppliers.find(x=>x.id===material.supplierId)?.name||'—'],['Available',num(st.available)]]}}}
  const lot=s.lots.find(l=>l.code.toLowerCase()===v)||s.lots.find(l=>serialInRange(l,v))
  if(lot){return {type:lot.kind==='serial'?'Serial':'Lot',title:lot.kind==='serial'?code.toUpperCase():lot.code,meta:`${itemName(s,lot.itemId)} · ${lot.sourceCode} · qoldiq ${num(lot.qty)}`,path:`/reports?view=traceability&q=${encodeURIComponent(code)}`,label:{title:itemName(s,lot.itemId),code:lot.kind==='serial'?code.toUpperCase():lot.code,lines:[['SKU',itemSku(s,lot.itemId)],['Manba',lot.sourceCode],['Qoldiq',num(lot.qty)],['Sana',lot.createdAt.slice(0,10)]]}}}
  const mo=s.productionOrders.find(o=>o.code.toLowerCase()===v)
  if(mo)return {type:'Production Order',title:mo.code,meta:`${itemName(s,mo.productId)} · ${mo.status} · ${num(mo.completed)}/${num(mo.quantity)}`,path:`/production?view=orders&id=${mo.id}`}
  const po=s.purchaseOrders.find(p=>p.code.toLowerCase()===v)
  if(po)return {type:'Purchase Order',title:po.code,meta:`${s.suppliers.find(x=>x.id===po.supplierId)?.name} · ${po.status}`,path:`/purchases?view=receiving&po=${po.id}`}
  const traced=findTraceOrder(s,v)
  if(traced)return {type:'Traceability',title:traced.code,meta:itemName(s,traced.productId),path:`/reports?view=traceability&q=${encodeURIComponent(code)}`}
  return null
}

function Barcode(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [scan,setScan]=useState(''),[hit,setHit]=useState<ScanHit|null|undefined>(undefined),[label,setLabel]=useState<LabelData|null>(null)
  const [history,setHistory]=useState<Array<{code:string;ok:boolean}>>([])
  const run=(code=scan)=>{const r=resolveScan(s,code);setHit(r);setHistory(h=>[{code,ok:Boolean(r)},...h].slice(0,8));setScan('')}
  const samples=[s.products[0]?.sku,s.rawMaterials[0]?.sku,s.lots.find(l=>l.kind==='lot'&&l.itemType==='raw'&&l.qty>0)?.code,s.lots.find(l=>l.kind==='lot'&&l.itemType==='finished')?.code,s.lots.find(l=>l.kind==='serial')?.serialFrom,s.productionOrders.find(o=>o.status==='Jarayonda')?.code,s.purchaseOrders.find(p=>p.status==='Yo‘lda')?.code].filter(Boolean) as string[]
  return <div className="page-stack">
    <PageHeader title="Barcode / QR" subtitle="SKU, lot, serial, MO yoki PO — scan qiling, yozuv ochiladi"/>
    <div className="split-main">
      <Card title="Scanner">
        <form className="scanner-line" onSubmit={e=>{e.preventDefault();run()}}><Input autoFocus value={scan} onChange={e=>setScan(e.target.value)} placeholder="Kod: SKU / LOT / SN / MO / PO" aria-label="Scan kodi"/><button type="submit" className="primary-glass-btn" disabled={!scan.trim()}><Icon name="scan"/>Aniqlash</button></form>
        {hit===undefined?<p className="soft-meta">Scan qiling yoki yozib Enter bosing</p>:hit?<div className="scan-result">
          <span className="entity-card-media"><Icon name={hit.type==='Mahsulot'?'box':hit.type.includes('Order')?'factory':'barcode'}/></span>
          <div><span className="eyebrow">{hit.type}</span><h3>{hit.title}</h3><p>{hit.meta}</p></div>
          <div className="row-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>navigate(hit.path)}>Ochish</button>{hit.label&&<button type="button" className="primary-glass-btn compact" onClick={()=>setLabel(hit.label!)}><Icon name="printer" size={14}/>Label</button>}</div>
        </div>:<div className="inline-note danger"><Icon name="warning"/>Kod topilmadi</div>}
        {history.length>0&&<><SectionTitle title="Oxirgi scanlar"/><div className="badge-row">{history.map((h,i)=><button type="button" key={i} className={`chip ${h.ok?'':'chip-danger'}`} onClick={()=>run(h.code)}>{h.code}</button>)}</div></>}
      </Card>
      <Card title="Namuna kodlar">
        {samples.length?<div className="stack-list">{samples.map(code=><button type="button" className="list-row is-clickable" key={code} onClick={()=>run(code)}><span className="list-row-copy"><b>{code}</b><small>{resolveScan(s,code)?.type}</small></span><Icon name="scan" size={15}/></button>)}</div>:<Empty compact title="Namuna yo‘q"/>}
      </Card>
    </div>
    <LabelModal label={label} onClose={()=>setLabel(null)}/>
  </div>
}

/**
 * Spare parts for maintenance work (P4-M-04, decision BOTH): the store keeper issues and takes back parts of the open
 * maintenance orders of their site here, without the equipment module — the same panel and domain command the
 * engineer uses on the order itself.
 */
function MaintenanceIssues(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[id,setId]=useRecordParam('mo')
  const rows=s.maintenanceOrders.filter(m=>m.status==='Rejada'||m.status==='Jarayonda')
  const selected=rows.find(m=>m.id===id)
  const mayIssue=MAINTENANCE_PART_RULES.some(([module,action])=>app.can(module,action))
  return <div className="page-stack">
    <PageHeader title="Ehtiyot qism chiqimi" subtitle="Rejadagi va jarayondagi maintenance ishlariga ombordan qism berish va qaytarish"/>
    {!mayIssue&&<div className="inline-note"><Icon name="lock"/>Qism berish uchun ombor yoki uskunalar modulida tahrirlash huquqi kerak.</div>}
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Maintenance, uskuna..." exportName="maintenance-parts" onRow={m=>setId(m.id)}
      emptyText="Ochiq maintenance ishi yo‘q"
      columns={[
        {key:'code',label:'Maintenance',value:m=>m.code,render:m=><div className="cell-main"><b>{m.code}</b><small>{m.type} · {m.scheduled}</small></div>},
        {key:'equipment',label:'Uskuna',value:m=>equipmentName(s,m.equipmentId)},
        {key:'technician',label:'Texnik',value:m=>employeeName(s,m.technicianId),priority:'low'},
        {key:'parts',label:'Berilgan qism',align:'right',value:m=>(m.parts||[]).length,render:m=>num((m.parts||[]).length)},
        {key:'status',label:'Holat',value:m=>m.status,render:m=><StatusBadge tone={m.status==='Jarayonda'?'info':'neutral'}>{m.status}</StatusBadge>},
      ]}/>
    {selected&&<Drawer open onClose={()=>setId(null)} title={selected.code} eyebrow="Ehtiyot qism chiqimi" icon="wrench" size="md" subtitle={`${equipmentName(s,selected.equipmentId)} · ${selected.scheduled}`} headerExtra={<StatusBadge>{selected.status}</StatusBadge>}>
      <InfoGrid items={[{label:'Uskuna',value:equipmentName(s,selected.equipmentId)},{label:'Texnik',value:employeeName(s,selected.technicianId)},{label:'Turi',value:selected.type},{label:'Reja',value:selected.scheduled}]}/>
      <SparePartsPanel order={selected}/>
    </Drawer>}
  </div>
}
