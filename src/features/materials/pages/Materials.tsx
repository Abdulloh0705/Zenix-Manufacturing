import {useEffect,useRef,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Checkbox,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,Progress,ResourceTable,Select,StatusBadge,Tabs,nonNegative,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import {siteSafetyStock} from '../../../domain/planning'
import {packsProblem} from '../../../domain/uom'
import type {RawMaterial,SupplierMaterial} from '../../../types'
import {MATERIAL_STOCK_STATES,createMrpPlan,isOpenOrder,materialShortages,materialStockRows,orderMaterialLines,stockOf} from '../../../domain/manufacturingEngine'
import {referenceBlocker} from '../../../domain/actions'
import {findLink,linkBlock,linksOfMaterial,preferredSupplierId} from '../../../domain/supplierMaterials'
import {LinkTermsTable,PurchasePlanModal,SourcingModal,SupplierMaterialModal} from '../../purchases/components/Sourcing'
import type {SourcingNeed} from '../../purchases/components/Sourcing'
import {money,num,qty,relativeTime} from '../../../utils/format'
import {clearHandoff,clearMaterialDraft,formTarget,loadMaterialDraft,readHandoff,saveMaterialDraft,writeHandoff} from '../materialDraft'
import type {MaterialFormValues} from '../materialDraft'
import {materialName,productName,supplierName,warehouseName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'

export default function Materials(){
  const [sp]=useSearchParams(),view=sp.get('view')||'all'
  const [id,setId]=useRecordParam()
  const [form,setForm]=useSearchParamState('form'),[newSupplier,setNewSupplier]=useSearchParamState('supplier')
  const app=useApp()
  const editing=form&&form!=='new'?app.state.rawMaterials.find(m=>m.id===form):undefined
  const body=view==='requirements'?<Requirements/>:view==='stock'?<Stock open={setId}/>:view==='shortages'?<Shortages/>:<All open={setId} onCreate={()=>setForm('new')}/>
  return <>{body}<MaterialDrawer materialId={id} onClose={()=>setId(null)} onEdit={setForm}/>
    {(form==='new'||editing)&&<MaterialFormModal key={form} material={editing} pickSupplier={newSupplier} onPicked={()=>setNewSupplier('')} onClose={()=>setForm('')} onCreated={v=>setId(v)}/>}
  </>
}

const stockState=(m:RawMaterial,available:number)=>available<m.minStock?'Kritik':available<m.reorderPoint?'Reorder':'Normal'

function All({open,onCreate}:{open:(id:string)=>void;onCreate:()=>void}){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[category,setCategory]=useSearchParamState('category'),[supplier,setSupplier]=useSearchParamState('supplier'),[level,setLevel]=useSearchParamState('level')
  const supplierLabel=(m:RawMaterial)=>linksOfMaterial(s,m.id).map(l=>supplierName(s,l.supplierId)).join(', ')
  const rows=s.rawMaterials.filter(m=>{const st=stockOf(s,m.id);return (!category||m.category===category)&&(!supplier||linksOfMaterial(s,m.id).some(l=>l.supplierId===supplier))&&(!level||stockState(m,st.available)===level)})
  return <div className="page-stack">
    <PageHeader title="Xomashyo" subtitle="Min stock, reorder, supplier, lead time"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('materials','create')} onClick={onCreate}><Icon name="plus"/>Xomashyo qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Nomi, SKU, kategoriya..." onRow={m=>open(m.id)} exportName="materials" resetKey={`${category}|${supplier}|${level}`}
      filtersActive={Boolean(category||supplier||level)} onResetFilters={()=>{setCategory('');setSupplier('');setLevel('')}}
      filters={<><FilterSelect label="Kategoriya" value={category} onChange={setCategory} options={[...new Set(s.rawMaterials.map(m=>m.category))]}/><FilterSelect label="Supplier" value={supplier} onChange={setSupplier} options={s.suppliers.map(x=>({value:x.id,label:x.name}))}/><FilterSelect label="Zaxira" value={level} onChange={setLevel} options={['Kritik','Reorder','Normal']}/></>}
      rowClassName={m=>{const st=stockState(m,stockOf(s,m.id).available);return st==='Kritik'?'row-danger':st==='Reorder'?'row-warning':undefined}}
      columns={[
        {key:'name',label:'Material',value:m=>m.name,render:m=><div className="cell-main"><b>{m.name}</b><small>{m.sku} · {m.category}</small></div>},
        {key:'level',label:'Zaxira',value:m=>stockState(m,stockOf(s,m.id).available),render:m=>{const v=stockState(m,stockOf(s,m.id).available);return <StatusBadge tone={v==='Kritik'?'danger':v==='Reorder'?'warning':'success'}>{v}</StatusBadge>}},
        {key:'available',label:'Available',align:'right',value:m=>stockOf(s,m.id).available,render:m=><span className="num">{qty(stockOf(s,m.id).available,m.unit)}</span>},
        {key:'incoming',label:'Yo‘lda',align:'right',value:m=>stockOf(s,m.id).incoming,priority:'low'},
        {key:'reorder',label:'Min / Reorder',align:'right',value:m=>m.reorderPoint,render:m=>`${num(m.minStock)} / ${num(m.reorderPoint)}`,priority:'low'},
        {key:'cost',label:'Narx',align:'right',value:m=>m.standardCost,render:m=>money(m.standardCost)},
        {key:'supplier',label:'Supplier',value:m=>supplierLabel(m),render:m=>{const n=linksOfMaterial(s,m.id).filter(l=>!linkBlock(s,l)).length;const p=preferredSupplierId(s,m.id);return n?<div className="cell-main"><b>{p?supplierName(s,p):`${n} ta supplier`}</b><small>{n} faol{p&&n>1?` · +${n-1}`:''}</small></div>:<span className="negative">Supplier yo‘q</span>}},
        {key:'lead',label:'Lead time',align:'right',value:m=>m.leadTime,render:m=>`${m.leadTime} kun`,priority:'low'},
      ]}/>
  </div>
}

/** The form's pack row as master data: none when no pack unit is typed (audit #24). */
const packsOf=(v:MaterialFormValues)=>(v.packUnit||'').trim()?[{unit:(v.packUnit||'').trim(),factor:Number(v.packFactor)}]:[]
const materialDefaults=(m?:RawMaterial):MaterialFormValues=>({name:m?.name||'',sku:m?.sku||'',category:m?.category||'Metall',unit:m?.unit||'kg',standardCost:String(m?.standardCost??''),minStock:String(m?.minStock??0),reorderPoint:String(m?.reorderPoint??0),leadTime:String(m?.leadTime??3),lotTracking:m?.lotTracking??true,serialTracking:Boolean(m?.serialTracking),expiryTracking:m?.expiryTracking??false,status:m?.status||'Faol',supplierId:m?.supplierId||'',packUnit:m?.packs?.[0]?.unit||'',packFactor:m?.packs?.[0]?String(m.packs[0].factor):''})

/**
 * Create/edit form. "Unsaved" means different from what is persisted (the saved draft, else the record):
 * closing or leaving for supplier creation then asks to save a draft. Values travel to the Suppliers
 * module and back through a one-trip handoff, and a supplier created there arrives as `pickSupplier`.
 */
function MaterialFormModal({material,pickSupplier,onPicked,onClose,onCreated}:{material?:RawMaterial;pickSupplier?:string;onPicked?:()=>void;onClose:()=>void;onCreated?:(id:string)=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const target=formTarget(material?.id)
  const [draft,setDraft]=useState(()=>loadMaterialDraft(target))
  const [baseline,setBaseline]=useState<MaterialFormValues>(()=>draft?{...materialDefaults(material),...draft.values}:materialDefaults(material))
  const [restored]=useState(()=>readHandoff(target))
  const [picked]=useState(()=>pickSupplier&&s.suppliers.some(x=>x.id===pickSupplier)?pickSupplier:'')
  const form=useForm<MaterialFormValues>(()=>({...(restored||baseline),...(picked?{supplierId:picked}:{})}),v=>({
    name:required(v.name,'Nomi'),sku:required(v.sku,'SKU')||(s.rawMaterials.some(m=>m.id!==material?.id&&m.sku.toLowerCase()===v.sku.trim().toLowerCase())?'Bu SKU band':undefined),
    standardCost:nonNegative(v.standardCost,'Narx'),minStock:nonNegative(v.minStock,'Min stock'),reorderPoint:nonNegative(v.reorderPoint,'Reorder point')||(Number(v.reorderPoint)<Number(v.minStock)?'Reorder point min stock’dan kichik bo‘lmasin':undefined),leadTime:nonNegative(v.leadTime,'Lead time'),
    supplierId:v.supplierId&&!s.suppliers.some(x=>x.id===v.supplierId)?'Supplier topilmadi — boshqasini tanlang':undefined,
    packFactor:(v.packUnit||'').trim()?packsProblem({unit:v.unit,packs:packsOf(v)})||undefined:undefined,
  }))
  // The handoff is single-use; the picked supplier is now in the form, so drop it from the URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount: the handoff is consumed exactly once
  useEffect(()=>{clearHandoff();if(pickSupplier)onPicked?.()},[])
  const [ask,setAsk]=useState<{then:()=>boolean|void;forSupplier?:boolean}|null>(null),[draftError,setDraftError]=useState('')
  const leaving=useRef(false)
  const dirty=JSON.stringify(form.values)!==JSON.stringify(baseline)
  const go=(then:()=>boolean|void)=>{if(leaving.current)return;leaving.current=true;setAsk(null);if(then()===false)leaving.current=false}
  /** Every exit (X, Esc, backdrop, Bekor qilish, Supplier qo‘shish) goes through here: at most one prompt. */
  const requestLeave=(then:()=>boolean|void=onClose,forSupplier=false)=>{if(leaving.current||ask)return;if(!dirty){go(then);return}setDraftError('');setAsk({then,forSupplier})}
  const saveDraft=()=>{
    if(!ask)return
    const saved=saveMaterialDraft(target,form.values)
    if(!saved){setDraftError('Qoralama saqlanmadi: brauzer xotirasiga yozib bo‘lmadi. Forma ochiq qoldi — qiymatlar o‘chmadi.');return}
    setDraft(saved);setBaseline(saved.values);app.toast('Qoralama saqlandi','success');go(ask.then)
  }
  const discardDraft=()=>{clearMaterialDraft(target);setDraft(null);const d=materialDefaults(material);setBaseline(d);form.reset(d)}
  const canAddSupplier=app.can('purchases','create')
  const toSupplier=()=>{
    if(!writeHandoff(target,form.values)){app.toast('Forma qiymatlarini vaqtincha saqlab bo‘lmadi — Supplier sahifasiga o‘tilmadi','danger');return false}
    const back=new URLSearchParams(window.location.search);back.set('form',target);back.delete('supplier')
    navigate(`/purchases?view=suppliers&create=1&returnTo=${encodeURIComponent(`${window.location.pathname}?${back}`)}`)
  }
  /** Preferred supplier from the form: link it first if needed (terms default to the standard cost, editable later). */
  const applySupplier=(materialId:string,v:MaterialFormValues)=>{
    if(!v.supplierId){app.setPreferredSupplier(materialId,'');return}
    if(!findLink(s,v.supplierId,materialId)&&!app.linkSupplierMaterial({supplierId:v.supplierId,materialId,supplierSku:'',price:Number(v.standardCost),currency:'UZS',purchaseUnit:v.unit,unitFactor:1,moq:0,leadTime:Number(v.leadTime),active:true}).ok)return
    app.setPreferredSupplier(materialId,v.supplierId)
  }
  const submit=()=>form.submit(v=>{
    const payload={name:v.name.trim(),sku:v.sku.trim().toUpperCase(),category:v.category.trim()||'Material',unit:v.unit,standardCost:Number(v.standardCost),minStock:Number(v.minStock),reorderPoint:Number(v.reorderPoint),leadTime:Number(v.leadTime),lotTracking:v.lotTracking||Boolean(v.serialTracking),serialTracking:Boolean(v.serialTracking),expiryTracking:v.expiryTracking,status:v.status,packs:packsOf(v)}
    const r=material?app.updateEntity('rawMaterials',material.id,payload):app.createEntity('rawMaterials',{...payload,supplierId:''})
    if(!r.ok)return false
    const id=material?.id||r.id!
    clearMaterialDraft(target);leaving.current=true
    if(v.supplierId!==(material?.supplierId||''))applySupplier(id,v)
    onClose();if(!material)onCreated?.(id)
    return true
  })
  const links=material?linksOfMaterial(s,material.id):[]
  const suppliers=s.suppliers.filter(x=>x.status!=='Arxiv'||x.id===form.values.supplierId)
  const chosenLinked=Boolean(form.values.supplierId&&material&&findLink(s,form.values.supplierId,material.id))
  const supplierHint=!form.values.supplierId?(links.length?`${links.length} ta biriktirilgan · asosiy tanlanmagan`:'Ixtiyoriy — MRP shu supplierni taklif qiladi')
    :chosenLinked?'Biriktirilgan — asosiy qilib belgilanadi':'Saqlashda biriktiriladi: narx = standart narx, MOQ 0 (keyin tahrirlanadi)'
  return <Modal open onClose={()=>requestLeave()} title={material?`${material.name} — tahrirlash`:'Yangi xomashyo'} size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={()=>requestLeave()}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Saqlash</button></>}>
    <div className="form-grid">
      {(restored||picked)?<div className="inline-note success span-2"><Icon name="check"/><span>{picked?<>Yangi supplier qo‘shildi va tanlandi: <b>{supplierName(s,picked)}</b>. </>:'Supplier qo‘shilmadi. '}Kiritilgan qiymatlar tiklandi.</span></div>
        :draft&&<div className="inline-note span-2 draft-note"><Icon name="file"/><span>Saqlangan qoralama tiklandi · {relativeTime(draft.savedAt)}</span><button type="button" className="link-btn" onClick={discardDraft}>Qoralamani o‘chirish</button></div>}
      <div className="form-group-title">Asosiy</div>
      <Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="SKU" required error={form.error('sku')}><Input {...form.input('sku')}/></Field>
      <Field label="Kategoriya"><Input list="material-categories" {...form.input('category')}/></Field>
      <Field label="Birlik" hint="Ombor, BOM va MRP shu birlikda hisoblaydi"><Select value={form.values.unit} onChange={v=>form.set('unit',v)}>{['kg','g','t','dona','m','cm','l','ml','m²','list'].map(u=><option key={u} value={u}>{u}</option>)}</Select></Field>
      <Field label="Qadoq birligi" hint="Ixtiyoriy: masalan quti, qop, rulon"><Input {...form.input('packUnit')} placeholder="quti"/></Field>
      <Field label={`1 qadoqda (${form.values.unit})`} error={form.error('packFactor')} hint="Aniq koeffitsiyent — taxmin qilinmaydi"><Input type="number" min="0" step="any" {...form.input('packFactor')} disabled={!(form.values.packUnit||'').trim()}/></Field>
      <div className="form-group-title">Narx va ta’minot</div>
      <Field label="Standart narx" required error={form.error('standardCost')}><MoneyInput min="0" {...form.money('standardCost')}/></Field>
      <div className="field-with-action">
        <Field label="Asosiy supplier" error={form.error('supplierId')} hint={supplierHint}><Select value={form.values.supplierId} onChange={v=>form.set('supplierId',v)} placeholder="Tanlanmagan">
          <option value="">Tanlanmagan</option>
          {suppliers.map(x=><option key={x.id} value={x.id}>{x.name}{material&&findLink(s,x.id,material.id)?' · biriktirilgan':''}</option>)}
        </Select></Field>
        {canAddSupplier&&<button type="button" className="secondary-glass-btn compact field-action" onClick={()=>requestLeave(toSupplier,true)}><Icon name="plus" size={14}/>Supplier qo‘shish</button>}
      </div>
      <div className="form-group-title">Zaxira qoidalari</div>
      <Field label="Min stock (safety)" error={form.error('minStock')}><Input type="number" min="0" {...form.input('minStock')}/></Field>
      <Field label="Reorder point" error={form.error('reorderPoint')}><Input type="number" min="0" {...form.input('reorderPoint')}/></Field>
      <Field label="Lead time (kun)" error={form.error('leadTime')}><Input type="number" min="0" {...form.input('leadTime')}/></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v)}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field>
      <div className="span-2 check-row"><Checkbox checked={form.values.lotTracking} onChange={v=>form.set('lotTracking',v)} label="Lot kuzatuvi" description="FIFO sarf"/><Checkbox checked={form.values.expiryTracking} onChange={v=>form.set('expiryTracking',v)} label="Yaroqlilik muddati" description="Lotga expiry"/><Checkbox checked={Boolean(form.values.serialTracking)} onChange={v=>form.set('serialTracking',v)} label="Serial raqam" description="Har bir dona raqami bilan qabul qilinadi"/></div>
    </div>
    <datalist id="material-categories">{[...new Set(s.rawMaterials.map(m=>m.category))].map(c=><option key={c} value={c}/>)}</datalist>
    <DraftPrompt open={Boolean(ask)} forSupplier={ask?.forSupplier} error={draftError} onSave={saveDraft} onDiscard={()=>ask&&go(ask.then)} onCancel={()=>setAsk(null)}/>
  </Modal>
}

/** Three-way exit prompt for an unsaved form (ZENIX modal, never the native confirm()). */
function DraftPrompt({open,forSupplier,error,onSave,onDiscard,onCancel}:{open:boolean;forSupplier?:boolean;error?:string;onSave:()=>void;onDiscard:()=>void;onCancel:()=>void}){
  return <Modal open={open} onClose={onCancel} size="sm" title="Qoralama saqlansinmi?"
    footer={<><button type="button" className="ghost-btn" onClick={onCancel}>Bekor qilish</button><span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={onDiscard}>Yo‘q, saqlamaslik</button><button type="button" className="primary-glass-btn" data-autofocus onClick={onSave}><Icon name="check" size={16}/>Ha, saqlash</button></>}>
    <div className="confirm-copy"><Icon name="info" size={18}/><div><p>{forSupplier
      ?'Supplier qo‘shishga o‘tishdan oldin formani qoralama sifatida saqlaysizmi? Qaytganingizda kiritilgan qiymatlar baribir tiklanadi.'
      :'Formada saqlanmagan o‘zgarishlar bor. Qoralama sifatida saqlab, keyinroq davom ettirasizmi?'}</p></div></div>
    {error&&<div className="inline-note danger draft-error" role="alert"><Icon name="warning"/><span>{error}</span></div>}
  </Modal>
}

/**
 * Safety stock of one material per branch: MRP nets each site against its own figure and never borrows another's.
 * A branch left empty keeps the default rule (the default branch uses Min stock, the others hold none).
 */
function SiteSafetyModal({material,onClose}:{material:RawMaterial;onClose:()=>void}){
  const app=useApp(),s=app.state
  const branches=s.branches.filter(b=>b.status!=='Arxiv')
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(branches.map(b=>[b.id,material.siteSafety?.[b.id]!==undefined?String(material.siteSafety[b.id]):''])))
  const bad=branches.find(b=>values[b.id]!==''&&!(Number(values[b.id])>=0))
  const save=()=>{if(bad)return;const siteSafety=Object.fromEntries(Object.entries(values).filter(([,v])=>v!=='').map(([k,v])=>[k,Number(v)]));const r=app.updateEntity('rawMaterials',material.id,{siteSafety:Object.keys(siteSafety).length?siteSafety:undefined});if(r.ok)onClose()}
  return <Modal open onClose={onClose} size="sm" title="Safety stock · filiallar" eyebrow={material.name} subtitle={`Bo‘sh = standart: asosiy filial Min stock (${num(material.minStock)} ${material.unit}), boshqalar 0`}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={Boolean(bad)} onClick={save}>Saqlash</button></>}>
    <div className="form-grid">{branches.map(b=><Field key={b.id} label={`${b.name} (${material.unit})`} error={bad?.id===b.id?'0 yoki musbat son':undefined}><Input type="number" min="0" step="any" value={values[b.id]} placeholder={String(siteSafetyStock(s,{...material,siteSafety:undefined},b.id))} onChange={e=>setValues(v=>({...v,[b.id]:e.target.value}))}/></Field>)}</div>
  </Modal>
}

function MaterialDrawer({materialId,onClose,onEdit}:{materialId:string|null;onClose:()=>void;onEdit:(id:string)=>void}){
  const app=useApp()
  const m=app.state.rawMaterials.find(x=>x.id===materialId)
  if(!m)return null
  return <MaterialDrawerBody key={m.id} m={m} onClose={onClose} onEdit={()=>onEdit(m.id)}/>
}

function MaterialDrawerBody({m,onClose,onEdit}:{m:RawMaterial;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState(()=>linksOfMaterial(s,m.id).length?'overview':'suppliers'),[remove,setRemove]=useState(false),[safety,setSafety]=useState(false)
  const [linkEdit,setLinkEdit]=useState<SupplierMaterial|'new'|null>(null),[unlink,setUnlink]=useState<SupplierMaterial|null>(null),[sourcing,setSourcing]=useState<SourcingNeed|null>(null)
  const st=stockOf(s,m.id)
  const links=linksOfMaterial(s,m.id)
  const canLink=app.can('materials','edit')||app.can('purchases','edit')
  const suggestion=createMrpPlan(s).purchases.find(p=>p.materialId===m.id)
  const need:SourcingNeed={materialId:m.id,need:suggestion?.suggested||0,needBy:suggestion?.suggested?suggestion.needBy:undefined,source:'Material'}
  const whereUsed=s.boms.filter(b=>b.status!=='Arxiv'&&b.components.some(c=>c.materialId===m.id))
  const lots=s.lots.filter(l=>l.itemId===m.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const pos=s.purchaseOrders.filter(p=>p.items.some(i=>i.materialId===m.id))
  const moves=s.stockMovements.filter(x=>x.itemId===m.id).slice(0,30)
  const blocker=referenceBlocker(s,'rawMaterials',m.id)
  const level=stockState(m,st.available)
  return <Drawer open onClose={onClose} title={m.name} eyebrow="Xomashyo" icon="layers" subtitle={`${m.sku} · ${m.category}`} size="lg"
    headerExtra={<><StatusBadge>{m.status}</StatusBadge><StatusBadge tone={level==='Kritik'?'danger':level==='Reorder'?'warning':'success'}>{level}</StatusBadge>{m.lotTracking&&<span className="chip">Lot</span>}{m.expiryTracking&&<span className="chip">Expiry</span>}</>}
    actions={<>{app.can('materials','delete')&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}<span className="spacer"/>
      {app.can('purchases','create')&&<button type="button" className="secondary-glass-btn" onClick={()=>setSourcing(need)}><Icon name="cart" size={15}/>Xarid</button>}
      {app.can('materials','edit')&&<button type="button" className="primary-glass-btn" onClick={onEdit}><Icon name="edit" size={16}/>Tahrirlash</button>}</>}>
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'suppliers',label:'Supplierlar',count:links.length},{value:'lots',label:'Lotlar',count:lots.filter(l=>l.qty>0).length},{value:'used',label:'Where-used',count:whereUsed.length},{value:'purchases',label:'Xaridlar',count:pos.length},{value:'moves',label:'Harakatlar'},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<>
      <div className="stock-summary card"><div><span>Available</span><strong>{qty(st.available,m.unit)}</strong></div><Progress value={st.available/Math.max(1,m.reorderPoint)*100} toneName={level==='Kritik'?'danger':level==='Reorder'?'warning':'success'} label="Reorder pointga nisbatan"/><div className="stock-summary-meta"><span>On hand <b>{num(st.onHand)}</b></span><span>Rezerv <b>{num(st.reserved)}</b></span><span>Yo‘lda <b>{num(st.incoming)}</b></span><span>Reorder <b>{num(m.reorderPoint)}</b></span></div></div>
      {s.branches.filter(b=>b.status!=='Arxiv').length>1&&<div className="list-row"><span className="list-row-copy"><b>Safety stock filiallar bo‘yicha (MRP)</b><small>{s.branches.filter(b=>b.status!=='Arxiv').map(b=>`${b.name}: ${num(siteSafetyStock(s,m,b.id))} ${m.unit}`).join(' · ')}</small></span>{app.can('materials','edit')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setSafety(true)}><Icon name="edit" size={14}/>Filiallar</button>}</div>}
      {safety&&<SiteSafetyModal material={m} onClose={()=>setSafety(false)}/>}
      <InfoGrid items={[{label:'Standart narx',value:money(m.standardCost)},{label:'Zaxira qiymati',value:money(st.onHand*m.standardCost)},{label:'Asosiy supplier',value:preferredSupplierId(s,m.id)?supplierName(s,preferredSupplierId(s,m.id)):links.length?`${links.length} ta — tanlanmagan`:'Yo‘q',tone:links.length?undefined:'danger'},{label:'Lead time',value:`${m.leadTime} kun`},{label:'Min stock',value:num(m.minStock)},{label:'Omborlar',value:s.stockBalances.filter(b=>b.itemId===m.id).map(b=>warehouseName(s,b.warehouseId)).join(', ')}]}/>
    </>}
    {tab==='suppliers'&&<div className="stack-list">
      {links.length?<LinkTermsTable links={links} side="material" onEdit={canLink?l=>setLinkEdit(l):undefined} onRemove={canLink?l=>setUnlink(l):undefined} onPreferred={app.can('materials','edit')?l=>app.setPreferredSupplier(m.id,l.supplierId):undefined} onBuy={app.can('purchases','create')?()=>setSourcing(need):undefined}/>:<Empty compact icon="truck" title="Supplier biriktirilmagan" text="Bu material yetishmasa, kimdan xarid qilish noma’lum bo‘ladi. Supplier va shartlarini biriktiring."/>}
      <div className="row-actions">{canLink&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setLinkEdit('new')}><Icon name="plus" size={14}/>Supplier biriktirish</button>}{links.length>1&&app.can('purchases','create')&&<button type="button" className="ghost-btn compact" onClick={()=>setSourcing(need)}>Taqqoslash</button>}{m.supplierId&&app.can('materials','edit')&&<button type="button" className="ghost-btn compact" onClick={()=>app.setPreferredSupplier(m.id,'')}>Asosiyni olib tashlash</button>}</div>
      <p className="soft-meta">“Asosiy” — MRP shu supplierni taklif qiladi. Asosiy belgilanmasa va faol supplier bir nechta bo‘lsa, tanlov odamga qoldiriladi.</p>
    </div>}
    {tab==='lots'&&(lots.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Lot</th><th>Manba</th><th>Sana</th><th className="align-right">Qoldiq</th><th>Expiry</th><th>Sarflangan</th></tr></thead><tbody>{lots.map(l=><tr key={l.id} className={l.qty<=0?'row-muted':undefined}><td><b>{l.code}</b></td><td>{l.sourceCode}</td><td>{l.createdAt.slice(0,10)}</td><td className="align-right">{qty(l.qty,m.unit)}</td><td>{l.expiry||'—'}</td><td className="wrap">{l.consumedBy.join(', ')||'—'}</td></tr>)}</tbody></table></div>:<Empty compact title="Lot yo‘q"/>)}
    {tab==='used'&&(whereUsed.length?<div className="stack-list">{whereUsed.map(b=>{const c=b.components.find(x=>x.materialId===m.id)!;return <button type="button" className="list-row is-clickable" key={b.id} onClick={()=>navigate(`/products?view=bom&id=${b.id}`)}><span className="list-row-copy"><b>{productName(s,b.productId)}</b><small>{b.code} {b.version} · {c.qty} {c.unit}/dona · waste {c.waste}%</small></span><StatusBadge>{b.status}</StatusBadge></button>})}</div>:<Empty compact title="Hech bir BOMda ishlatilmaydi"/>)}
    {tab==='purchases'&&(pos.length?<div className="stack-list">{pos.map(p=>{const i=p.items.find(x=>x.materialId===m.id)!;return <button type="button" className="list-row is-clickable" key={p.id} onClick={()=>navigate(`/purchases?view=orders&id=${p.id}`)}><span className="list-row-copy"><b>{p.code}</b><small>{supplierName(s,p.supplierId)} · {p.expectedDate} · {money(i.price)}/{m.unit}</small></span><span className="list-row-meta"><b>{num(i.received)}/{num(i.qty)}</b><StatusBadge>{p.status}</StatusBadge></span></button>})}</div>:<Empty compact title="Xarid yo‘q"/>)}
    {tab==='moves'&&(moves.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Sana</th><th>Harakat</th><th>Manba</th><th>Lot</th><th className="align-right">Miqdor</th></tr></thead><tbody>{moves.map(x=><tr key={x.id}><td>{x.date}</td><td><StatusBadge tone={x.qty>=0?'success':'warning'}>{x.type}</StatusBadge></td><td>{x.source}</td><td>{x.lot||'—'}</td><td className={`align-right ${x.qty>=0?'positive':'negative'}`}>{x.qty>0?'+':''}{num(x.qty,1)}</td></tr>)}</tbody></table></div>:<Empty compact title="Harakat yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="material" entityId={m.id} canEdit={app.can('materials','edit')}/>}
    {tab==='history'&&<ActivityPanel sources={[m.name,m.sku]}/>}
    {linkEdit&&<SupplierMaterialModal link={linkEdit==='new'?undefined:linkEdit} materialId={m.id} onClose={()=>setLinkEdit(null)}/>}
    {sourcing&&<SourcingModal need={sourcing} onClose={()=>setSourcing(null)}/>}
    <Confirm open={Boolean(unlink)} onClose={()=>setUnlink(null)} onConfirm={()=>{if(unlink)app.removeSupplierMaterial(unlink.id)}} danger title="Supplier aloqasi o‘chirilsinmi?" text={unlink?`${supplierName(s,unlink.supplierId)} → ${m.name}. Ochiq PO bo‘lsa o‘chirilmaydi — nofaol qiling.`:''} confirmText="Aloqani o‘chirish"/>
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>{if(app.deleteEntity('rawMaterials',m.id).ok)onClose()}} danger title="Xomashyo o‘chirilsinmi?" text={blocker?`O‘chirib bo‘lmaydi: ${blocker}. Status’ni “Arxiv” qiling.`:'Material butunlay o‘chiriladi.'} confirmText="O‘chirish"/>
  </Drawer>
}

function Requirements(){
  const s=useApp().state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[shortOnly,setShortOnly]=useSearchParamState('short')
  const rows=s.productionOrders.filter(o=>isOpenOrder(o)&&!o.reworkOf).flatMap(o=>orderMaterialLines(s,o).map(({component,required,covered,shortage,incoming,toBuy,lateForDue,supply})=>(
    {id:`${o.id}-${component.id}`,orderId:o.id,order:o.code,status:o.status,materialId:component.materialId,required,reserved:o.materialReserved,covered,shortage,incoming,toBuy,lateForDue,supply,unit:component.unit,due:o.due}
  ))).filter(r=>shortOnly!=='1'||r.shortage>0)
  return <div className="page-stack">
    <PageHeader title="Material talabi" subtitle="Ochiq MOlar bo‘yicha: rezerv, qoplangan, yetishmaydi"/>
    <div className="kpi-grid cols-3">
      <KPI label="Talab qatorlari" value={rows.length} icon={<Icon name="layers"/>} onClick={()=>setShortOnly('')}/>
      <KPI label="Rezerv qilingan" value={rows.filter(r=>r.reserved).length} tone="mint" icon={<Icon name="check"/>}/>
      <KPI label="Yetishmovchilik" value={rows.filter(r=>r.shortage>0).length} tone="pink" icon={<Icon name="warning"/>} onClick={()=>setShortOnly(shortOnly==='1'?'':'1')}/>
    </div>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="MO yoki material..." onRow={r=>navigate(`/production?view=orders&id=${r.orderId}`)} exportName="material-requirements" resetKey={shortOnly}
      filters={<Checkbox checked={shortOnly==='1'} onChange={v=>setShortOnly(v?'1':'')} label="Faqat yetishmovchilik"/>} filtersActive={shortOnly==='1'} onResetFilters={()=>setShortOnly('')}
      rowClassName={r=>r.shortage>0?'row-danger':undefined}
      columns={[
        {key:'order',label:'MO',value:r=>r.order,render:r=><div className="cell-main"><b>{r.order}</b><small>{r.status} · due {r.due}</small></div>},
        {key:'material',label:'Material',value:r=>materialName(s,r.materialId)},
        {key:'required',label:'Talab',align:'right',value:r=>r.required,render:r=>qty(r.required,r.unit)},
        {key:'covered',label:'Qoplangan',align:'right',value:r=>r.covered,render:r=>qty(r.covered,r.unit)},
        {key:'shortage',label:'Yetishmaydi',align:'right',value:r=>r.shortage,render:r=>r.shortage?<b className="negative">{qty(r.shortage,r.unit)}</b>:'—'},
        {key:'incoming',label:'Yo‘lda',align:'right',value:r=>r.incoming,render:r=>r.incoming?<div className="cell-main"><b>{num(r.incoming,1)}</b><small>{r.supply.map(x=>`${x.code} · ${x.expectedDate.slice(5)}`).join(', ')}</small></div>:'—',priority:'low'},
        {key:'toBuy',label:'Xarid kerak',align:'right',value:r=>r.toBuy,render:r=>r.toBuy?<b className="negative">{qty(r.toBuy,r.unit)}</b>:'—'},
        {key:'state',label:'Holat',value:r=>r.reserved?'Rezervda':r.toBuy?'Shortage':r.shortage?'Yo‘lda':'Ready',render:r=><StatusBadge tone={r.reserved?'success':r.toBuy?'danger':r.lateForDue?'warning':r.shortage?'info':'success'}>{r.reserved?'Rezervda':r.toBuy?'Shortage':r.lateForDue?'Kech keladi':r.shortage?'Yo‘lda':'Available'}</StatusBadge>},
      ]}/>
  </div>
}

function Stock({open}:{open:(id:string)=>void}){
  const s=useApp().state
  const [q,setQ]=useSearchParamState('q'),[level,setLevel]=useSearchParamState('level'),[wh,setWh]=useSearchParamState('wh')
  const all=materialStockRows(s).map(r=>({...r,warehouses:s.stockBalances.filter(b=>b.itemId===r.id&&b.onHand>0).map(b=>b.warehouseId)}))
  const rows=all.filter(r=>(!level||r.state===level)&&(!wh||r.warehouses.includes(wh)))
  const count=(st:string)=>all.filter(r=>r.state===st).length
  return <div className="page-stack">
    <PageHeader title="Xomashyo qoldiqlari" subtitle="Available = on hand − rezerv − karantin · proyeksiya = available + yo‘lda − rezervsiz talab"/>
    <div className="kpi-grid">
      <KPI label="Yetishmovchilik" value={count('Shortage')} sub="Proyeksiya manfiy" tone={count('Shortage')?'pink':'mint'} icon={<Icon name="warning"/>} onClick={()=>setLevel(level==='Shortage'?'':'Shortage')}/>
      <KPI label="Kritik" value={count('Kritik')} sub="Min stock’dan past" tone="orange" icon={<Icon name="layers"/>} onClick={()=>setLevel(level==='Kritik'?'':'Kritik')}/>
      <KPI label="Reorder" value={count('Reorder')} sub="Buyurtma nuqtasidan past" tone="purple" icon={<Icon name="cart"/>} onClick={()=>setLevel(level==='Reorder'?'':'Reorder')}/>
      <KPI label="Normal" value={count('Normal')} tone="mint" icon={<Icon name="check"/>} onClick={()=>setLevel(level==='Normal'?'':'Normal')}/>
    </div>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Material, SKU..." onRow={r=>open(r.id)} exportName="material-stock" resetKey={`${level}|${wh}`}
      filtersActive={Boolean(level||wh)} onResetFilters={()=>{setLevel('');setWh('')}}
      filters={<><FilterSelect label="Holat" value={level} onChange={setLevel} options={MATERIAL_STOCK_STATES}/><FilterSelect label="Ombor" value={wh} onChange={setWh} options={s.warehouses.map(w=>({value:w.id,label:w.name}))}/></>}
      rowClassName={r=>r.state==='Shortage'||r.state==='Kritik'?'row-danger':r.state==='Reorder'?'row-warning':undefined}
      columns={[
        {key:'sku',label:'SKU',value:r=>r.m.sku,render:r=><span className="mono-cell">{r.m.sku}</span>,priority:'low'},
        {key:'name',label:'Material',value:r=>r.m.name,render:r=><div className="cell-main"><b>{r.m.name}</b><small>{r.m.category} · {r.m.unit}</small></div>},
        {key:'wh',label:'Ombor',value:r=>r.warehouses.map(id=>warehouseName(s,id)).join(', '),render:r=><span className="truncate">{r.warehouses.map(id=>warehouseName(s,id)).join(', ')||'—'}</span>,priority:'low'},
        {key:'onHand',label:'On hand',align:'right',value:r=>r.p.onHand,render:r=>num(r.p.onHand)},
        {key:'reserved',label:'Rezerv',align:'right',value:r=>r.p.reserved,render:r=>r.p.reserved?num(r.p.reserved):<span className="muted">—</span>},
        {key:'available',label:'Available',align:'right',value:r=>r.p.available,render:r=><b>{num(r.p.available)}</b>},
        {key:'incoming',label:'Yo‘lda',align:'right',value:r=>r.p.incoming,render:r=>r.p.incoming?num(r.p.incoming):<span className="muted">—</span>},
        {key:'projected',label:'Proyeksiya',align:'right',value:r=>r.p.projected,render:r=><b className={r.p.projected<0?'negative':undefined}>{num(r.p.projected)}</b>},
        {key:'state',label:'Holat',value:r=>r.state,render:r=><StatusBadge tone={r.state==='Shortage'||r.state==='Kritik'?'danger':r.state==='Reorder'?'warning':'success'}>{r.state}</StatusBadge>},
      ]}/>
  </div>
}

function Shortages(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const rows=materialShortages(s).map(r=>({...r,order:r.suggested||Math.ceil(Math.max(0,r.m.reorderPoint+r.m.minStock-r.available-r.incoming)/100)*100}))
  const canBuy=app.can('purchases','create')
  const [sourcing,setSourcing]=useState<SourcingNeed|null>(null),[plan,setPlan]=useState(false)
  const needOf=(r:typeof rows[number]):SourcingNeed=>({materialId:r.m.id,need:r.order,needBy:r.needBy,source:'Shortage'})
  const orderable=rows.filter(r=>r.order>0)
  return <div className="page-stack">
    <PageHeader title="Yetishmovchiliklar" subtitle="MRP talabi va reorder’dan past materiallar · tavsiya butun birlikka yuqoriga yaxlitlanadi"
      actions={<>
        <button type="button" className="secondary-glass-btn" onClick={()=>navigate('/production?view=mrp')}><Icon name="chart"/>MRP</button>
        {orderable.length>0&&canBuy&&<button type="button" className="primary-glass-btn" onClick={()=>setPlan(true)}><Icon name="cart"/>Xarid rejasi ({orderable.length})</button>}
      </>}/>
    {rows.length?<div className="card flush"><div className="table-scroll"><table className="shortage-table"><thead><tr><th>Material</th><th className="align-right">Talab</th><th className="align-right">Available</th><th className="align-right">Yo‘lda</th><th className="align-right">Yetishmaydi</th><th className="align-right">Tavsiya</th><th>Supplier · kerak</th><th className="align-right">Amal</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className={r.critical?'row-danger':'row-warning'}>
      <td><div className="cell-main"><b>{r.m.name}</b><small>{r.m.sku} · lead {r.m.leadTime} kun</small></div></td>
      <td className="align-right">{qty(r.required,r.m.unit)}</td>
      <td className={`align-right ${r.available<r.m.minStock?'negative':''}`}>{num(r.available)}</td>
      <td className="align-right">{r.incoming?num(r.incoming):<span className="muted">—</span>}</td>
      <td className="align-right">{r.shortage>0?<b className="negative">{num(r.shortage)}</b>:<span className="muted">—</span>}</td>
      <td className="align-right">{r.order?<b>{qty(r.order,r.m.unit)}</b>:<StatusBadge tone="info">Yo‘lda qoplaydi</StatusBadge>}</td>
      <td>{r.supplierId?supplierName(s,r.supplierId):r.supplierCount>1?<span className="warning-text">{r.supplierCount} ta — tanlang</span>:<span className="negative">Supplier yo‘q</span>}<small className="cell-sub">{r.needBy}</small></td>
      <td className="align-right"><div className="cell-actions">{r.order>0&&<button type="button" className="soft-glass-btn compact" disabled={!canBuy} onClick={()=>setSourcing(needOf(r))}><Icon name="truck" size={14}/>Supplier</button>}<button type="button" className="icon-ghost" aria-label={`${r.m.name} — materialni ochish`} onClick={()=>navigate(`/materials?view=all&id=${r.m.id}`)}><Icon name="chevron" size={14}/></button></div></td>
    </tr>)}</tbody></table></div></div>:<Card><Empty icon="check" title="Yetishmovchilik yo‘q" text="Talab va safety stock qoplangan"/></Card>}
    {sourcing&&<SourcingModal need={sourcing} onClose={()=>setSourcing(null)}/>}
    {plan&&<PurchasePlanModal needs={orderable.map(needOf)} title="Yetishmovchiliklar — xarid" onClose={()=>setPlan(false)}/>}
  </div>
}
