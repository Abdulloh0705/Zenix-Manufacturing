import {useMemo,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,Modal,MoneyInput,PageHeader,ResourceTable,SectionTitle,Select,StatusBadge,Tabs,Textarea,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Bom,Product,ProductVariant} from '../../../types'
import {activeBomFor,estimateOrderCost,perUnit,stockOf} from '../../../domain/manufacturingEngine'
import {ecoChanges,referenceBlocker,variantValues} from '../../../domain/actions'
import {addDays,todayISO} from '../../../utils/dates'
import {money,num} from '../../../utils/format'
import {employeeName,materialName,productName,warehouseName,workCenterName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {ProductFormModal} from '../components/ProductForm'
import {BomEditor} from '../components/BomEditor'
import {OrderFormModal} from '../../production/components/OrderParts'

export default function Products(){
  const [sp]=useSearchParams(),view=sp.get('view')||'all'
  if(view==='bom')return <BomView/>
  if(view==='routing')return <Routing/>
  if(view==='categories')return <Categories/>
  if(view==='variants')return <Variants/>
  if(view==='versions')return <Versions/>
  if(view==='plm')return <PLM/>
  return <AllProducts/>
}

/* --------------------------------------------------------------- products -- */
function AllProducts(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[category,setCategory]=useSearchParamState('category'),[type,setType]=useSearchParamState('type'),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false)
  const categories=[...new Set(s.products.map(p=>p.category))]
  const rows=s.products.filter(p=>(!category||p.category===category)&&(!type||p.type===type)&&(!status||p.status===status))
  return <div className="page-stack">
    <PageHeader title="Mahsulotlar" subtitle="BOM, narx, tannarx va qoldiq"
      actions={<><button type="button" className="secondary-glass-btn" disabled={!app.can('products','edit')} onClick={()=>app.rollUpCosts()} title="Standart tannarxni faol BOM, routing va stavkalardan qayta hisoblash"><Icon name="refresh"/>Roll-up</button><button type="button" className="primary-glass-btn" disabled={!app.can('products','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Mahsulot qo‘shish</button></>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Nomi, SKU, kategoriya..." onRow={p=>setId(p.id)} exportName="products" resetKey={`${category}|${type}|${status}`}
      filtersActive={Boolean(category||type||status)} onResetFilters={()=>{setCategory('');setType('');setStatus('')}}
      filters={<><FilterSelect label="Kategoriya" value={category} onChange={setCategory} options={categories}/><FilterSelect label="Tur" value={type} onChange={setType} options={[{value:'finished',label:'Tayyor'},{value:'semi',label:'Yarim tayyor'}]}/><FilterSelect label="Status" value={status} onChange={setStatus} options={['Faol','Arxiv']}/></>}
      rowClassName={p=>p.status==='Arxiv'?'row-muted':undefined}
      columns={[
        {key:'name',label:'Mahsulot',value:p=>p.name,render:p=><div className="product-cell"><span className="product-thumb" aria-hidden="true"><Icon name="box" size={16}/></span><div className="cell-main"><b>{p.name}</b><small>{p.sku} · {p.category}</small></div></div>},
        {key:'status',label:'Status',value:p=>p.status,render:p=><StatusBadge>{p.status}</StatusBadge>},
        {key:'type',label:'Tur',value:p=>p.type==='finished'?'Tayyor':'Yarim tayyor',render:p=><span>{p.type==='finished'?'Tayyor':'Yarim tayyor'}<small className="cell-sub">{p.procurement==='make'?'Make':'Buy'} · {p.tracking==='lot'?'Lot':p.tracking==='serial'?'Serial':'—'}</small></span>},
        {key:'bom',label:'Faol BOM',value:p=>activeBomFor(s,p.id)?.code||'',render:p=>{const b=activeBomFor(s,p.id);return b?<span>{b.code}<small className="cell-sub">{b.version}</small></span>:<span className="muted">{p.procurement==='buy'?'Buy':'BOM yo‘q'}</span>},priority:'low'},
        {key:'stock',label:'Available',align:'right',value:p=>stockOf(s,p.id).available,render:p=><span className="num">{num(stockOf(s,p.id).available)} {p.unit}</span>},
        ...(app.can('costs')?[{key:'cost',label:'Tannarx',align:'right' as const,value:(p:Product)=>p.standardCost,render:(p:Product)=>money(p.standardCost)}]:[]),
        {key:'price',label:'Sotuv narxi',align:'right',value:p=>p.salePrice,render:p=>money(p.salePrice)},
        ...(app.can('costs')?[{key:'margin',label:'Marja',align:'right' as const,value:(p:Product)=>p.salePrice?(1-p.standardCost/p.salePrice)*100:0,render:(p:Product)=>`${p.salePrice?Math.round((1-p.standardCost/p.salePrice)*100):0}%`,priority:'low' as const}]:[])
      ]}/>
    {create&&<ProductFormModal onClose={()=>setCreate(false)}/>}
    <ProductDrawer productId={id} onClose={()=>setId(null)}/>
  </div>
}

function ProductDrawer({productId,onClose}:{productId:string|null;onClose:()=>void}){
  const app=useApp()
  const product=app.state.products.find(p=>p.id===productId)
  if(!product)return null
  return <ProductDrawerBody key={product.id} product={product} onClose={onClose}/>
}

function ProductDrawerBody({product,onClose}:{product:Product;onClose:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('overview'),[edit,setEdit]=useState(false),[remove,setRemove]=useState(false),[order,setOrder]=useState(false)
  const bom=activeBomFor(s,product.id)
  const balances=s.stockBalances.filter(b=>b.itemId===product.id)
  const lots=s.lots.filter(l=>l.itemId===product.id&&l.qty>0)
  const sales=s.salesOrders.flatMap(o=>o.items.filter(i=>i.productId===product.id).map(i=>({o,i})))
  const orders=s.productionOrders.filter(o=>o.productId===product.id)
  const blocker=referenceBlocker(s,'products',product.id)
  const stock=stockOf(s,product.id)
  return <Drawer open onClose={onClose} title={product.name} eyebrow="Mahsulot" icon="box" size="lg" subtitle={`${product.sku} · ${product.category}`}
    headerExtra={<><StatusBadge>{product.status}</StatusBadge><span className="chip">{product.procurement==='make'?'Make':'Buy'}</span><span className="chip">{product.tracking==='lot'?'Lot tracked':product.tracking==='serial'?'Serial tracked':'Kuzatilmaydi'}</span></>}
    actions={<>
      {app.can('products','delete')&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}
      {app.can('products','edit')&&<button type="button" className="secondary-glass-btn" onClick={()=>app.updateEntity('products',product.id,{status:product.status==='Arxiv'?'Faol':'Arxiv'})}><Icon name={product.status==='Arxiv'?'undo':'box'} size={15}/>{product.status==='Arxiv'?'Faollashtirish':'Arxivlash'}</button>}
      {app.can('products','create')&&<button type="button" className="secondary-glass-btn" onClick={()=>app.duplicateEntity('products',product.id)}><Icon name="copy" size={15}/>Nusxa</button>}
      <span className="spacer"/>
      {bom&&app.can('production','create')&&product.status==='Faol'&&<button type="button" className="secondary-glass-btn" onClick={()=>setOrder(true)}><Icon name="factory" size={15}/>Yangi MO</button>}
      {app.can('products','edit')&&<button type="button" className="primary-glass-btn" onClick={()=>setEdit(true)}><Icon name="edit" size={16}/>Tahrirlash</button>}
    </>}>
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'bom',label:'BOM'},{value:'stock',label:'Ombor',count:lots.length},{value:'variants',label:'Variantlar',count:product.variants.length},{value:'demand',label:'Talab',count:sales.length+orders.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<>
      <InfoGrid items={[{label:'Sotuv narxi',value:money(product.salePrice)},...(app.can('costs')?[{label:'Standart tannarx',value:money(product.standardCost)},{label:'Marja',value:`${product.salePrice?Math.round((1-product.standardCost/product.salePrice)*100):0}%`}]:[]),{label:'Lead time',value:`${product.leadTime} kun`},{label:'On hand',value:`${num(stock.onHand)} ${product.unit}`},{label:'Rezerv',value:num(stock.reserved)},{label:'Available',value:num(stock.available),tone:stock.available<=0?'warning':undefined},{label:'Faol BOM',value:bom?`${bom.code} ${bom.version}`:'—'}]}/>
      {!bom&&product.procurement==='make'&&<div className="inline-note warning"><Icon name="warning"/>Faol BOM yo‘q — ishlab chiqarish buyurtmasi yaratib bo‘lmaydi. <button type="button" className="link-btn" onClick={()=>navigate(`/products?view=bom&product=${product.id}`)}>BOM yaratish</button></div>}
    </>}
    {tab==='bom'&&(bom?<><SectionTitle title={`${bom.code} ${bom.version}`} subtitle={`Revision ${bom.revision} · effective ${bom.effectiveDate}`} actions={<button type="button" className="ghost-btn" onClick={()=>navigate(`/products?view=bom&id=${bom.id}`)}>BOM’ni ochish <Icon name="chevron" size={13}/></button>}/><BomTree bom={bom} quantity={1}/></>:<Empty compact title="Faol BOM yo‘q"/>)}
    {tab==='stock'&&<div className="two-col">
      <div><SectionTitle title="Omborlar bo‘yicha"/>{balances.length?<div className="stack-list">{balances.map(b=><div className="list-row" key={b.id}><span className="list-row-copy"><b>{warehouseName(s,b.warehouseId)}</b><small>Rezerv {num(b.reserved)} · yo‘lda {num(b.incoming)}</small></span><b className="num">{num(b.onHand)} {b.unit}</b></div>)}</div>:<Empty compact title="Qoldiq yo‘q"/>}</div>
      <div><SectionTitle title="Faol lot / serial"/>{lots.length?<div className="stack-list">{lots.map(l=><div className="list-row" key={l.id}><span className="list-row-copy"><b>{l.code}</b><small>{l.sourceCode} · {l.createdAt.slice(0,10)}</small></span><b className="num">{num(l.qty)}</b></div>)}</div>:<Empty compact title="Kuzatiladigan lot yo‘q"/>}</div>
    </div>}
    {tab==='variants'&&<VariantManager product={product}/>}
    {tab==='demand'&&<div className="two-col">
      <div><SectionTitle title="Sotuv buyurtmalari"/>{sales.length?<div className="stack-list">{sales.map(({o,i})=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/sales?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code}</b><small>{s.customers.find(c=>c.id===o.customerId)?.name} · {o.deliveryDate}</small></span><span className="list-row-meta"><b>{num(i.qty)}</b><StatusBadge>{o.status}</StatusBadge></span></button>)}</div>:<Empty compact title="Sotuv yo‘q"/>}</div>
      <div><SectionTitle title="Ishlab chiqarish"/>{orders.length?<div className="stack-list">{orders.slice(0,10).map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code}</b><small>{num(o.completed)}/{num(o.quantity)} · {o.due}</small></span><StatusBadge>{o.status}</StatusBadge></button>)}</div>:<Empty compact title="Buyurtma yo‘q"/>}</div>
    </div>}
    {tab==='docs'&&<AttachmentsPanel entityType="product" entityId={product.id} canEdit={app.can('products','edit')}/>}
    {tab==='history'&&<ActivityPanel sources={[product.name,product.sku]}/>}
    {edit&&<ProductFormModal product={product} onClose={()=>setEdit(false)}/>}
    {order&&<OrderFormModal defaults={{productId:product.id}} onClose={()=>setOrder(false)}/>}
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>{if(app.deleteEntity('products',product.id).ok)onClose()}} danger title="Mahsulot o‘chirilsinmi?" text={blocker?`Bu mahsulotni o‘chirib bo‘lmaydi: ${blocker}. Uning o‘rniga arxivlang — tarix va hisobotlar saqlanadi.`:'Mahsulot katalogdan butunlay o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.'} confirmText={blocker?'Baribir urinib ko‘rish':'O‘chirish'}/>
  </Drawer>
}

function VariantManager({product}:{product:Product}){
  const app=useApp(),s=app.state
  const [editing,setEditing]=useState<ProductVariant|null|'new'>(null)
  const canEdit=app.can('products','edit')
  const variantBom=(v:ProductVariant)=>s.boms.find(b=>b.productId===product.id&&b.variantId===v.id&&b.status==='Faol')
  return <div className="stack-list">
    {product.variants.length?product.variants.map(v=><div className="list-row" key={v.id}><span className="list-row-copy"><b>{v.code}</b><small>{v.attributes} · {v.priceDelta?`${v.priceDelta>0?'+':''}${money(v.priceDelta)}`:'narx farqi yo‘q'}{v.barcode?` · ${v.barcode}`:''} · BOM: {variantBom(v)?`${variantBom(v)!.code} ${variantBom(v)!.version}`:'umumiy'}</small></span><span className="list-row-meta"><StatusBadge>{v.status}</StatusBadge>{canEdit&&<button type="button" className="icon-ghost" aria-label={`${v.code} — tahrirlash`} onClick={()=>setEditing(v)}><Icon name="edit" size={15}/></button>}</span></div>):<Empty compact title="Variant yo‘q"/>}
    {canEdit&&<div className="row-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>setEditing('new')}><Icon name="plus" size={14}/>Variant qo‘shish</button></div>}
    <p className="soft-meta">Zaxira mahsulot darajasida yuritiladi — variantlar alohida qoldiq saqlamaydi.</p>
    {editing&&<VariantModal product={product} variant={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
  </div>
}

/** Attribute rows of a variant; variants saved before structured values are read from their text. */
const valuesOf=(v?:ProductVariant):{key:string;value:string}[]=>Object.entries(v?.values||variantValues(v?.attributes||'')).map(([key,value])=>({key,value}))

function VariantModal({product,variant,onClose,chooseProduct}:{product:Product;variant?:ProductVariant;onClose:()=>void;chooseProduct?:boolean}){
  const app=useApp()
  const [productId,setProductId]=useState(product.id)
  const target=app.state.products.find(p=>p.id===productId)||product
  const [attrs,setAttrs]=useState(()=>{const rows=valuesOf(variant);return rows.length?rows:[{key:'',value:''}]})
  const [error,setError]=useState('')
  const form=useForm({code:variant?.code||`${product.sku}-`,barcode:variant?.barcode||'',priceDelta:String(variant?.priceDelta??0),status:variant?.status||'Faol'},v=>({code:required(v.code,'Kod')}))
  const setAttr=(i:number,patch:Partial<{key:string;value:string}>)=>setAttrs(x=>x.map((a,j)=>j===i?{...a,...patch}:a))
  const save=()=>form.submit(v=>{
    setError('')
    const r=app.saveVariant(target.id,{id:variant?.id,code:v.code,barcode:v.barcode,values:Object.fromEntries(attrs.filter(a=>a.key.trim()&&a.value.trim()).map(a=>[a.key.trim(),a.value.trim()])),priceDelta:Number(v.priceDelta)||0,status:v.status as ProductVariant['status']})
    if(r.ok)onClose();else setError(r.message)
    return r.ok
  })
  return <Modal open onClose={onClose} title={variant?'Variantni tahrirlash':'Yangi variant'} eyebrow={target.name} size="md" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={save}>Saqlash</button></>}>
    <div className="form-stack">
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/>{error}</div>}
      {chooseProduct&&<Field label="Mahsulot" required><Select value={productId} onChange={v=>{setProductId(v);const p=app.state.products.find(x=>x.id===v);if(p&&!variant)form.set('code',`${p.sku}-`)}}>{app.state.products.filter(p=>p.status!=='Arxiv').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
      <div className="form-grid">
        <Field label="Variant SKU" required error={form.error('code')} hint="Mahsulot, xomashyo va boshqa variantlar orasida yagona"><Input {...form.input('code')}/></Field>
        <Field label="Shtrix-kod" hint="Ixtiyoriy, yagona"><Input {...form.input('barcode')}/></Field>
      </div>
      <section className="editor-section">
        <div className="editor-head"><h4>Atributlar</h4><button type="button" className="secondary-glass-btn compact" onClick={()=>setAttrs(x=>[...x,{key:'',value:''}])}><Icon name="plus" size={14}/>Atribut</button></div>
        {attrs.map((a,i)=><div className="inline-row" key={i}>
          <input className="ui-input cell-input wide" aria-label="Atribut nomi" placeholder="Rang" value={a.key} onChange={e=>setAttr(i,{key:e.target.value})}/>
          <input className="ui-input cell-input wide" aria-label="Qiymat" placeholder="kumush" value={a.value} onChange={e=>setAttr(i,{value:e.target.value})}/>
          <button type="button" className="icon-ghost danger" disabled={attrs.length<2} aria-label="Atributni o‘chirish" onClick={()=>setAttrs(x=>x.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button>
        </div>)}
      </section>
      <div className="form-grid"><Field label="Narx farqi"><MoneyInput {...form.money('priceDelta')}/></Field><Field label="Status" hint="Ishlatilgan variant o‘chirilmaydi — arxivlanadi"><Select value={form.values.status} onChange={v=>form.set('status',v as ProductVariant['status'])}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field></div>
    </div>
  </Modal>
}

/* --------------------------------------------------------------- BOM tree -- */
type BomLine={key:string;depth:number;component:Bom['components'][number];need:number;sub?:Bom;last:boolean}
function flattenBom(s:ReturnType<typeof useApp>['state'],bom:Bom,quantity:number,depth=0,trail:string[]=[]):BomLine[]{
  return bom.components.flatMap((c,i)=>{
    const sub=c.subBomId?s.boms.find(b=>b.id===c.subBomId):undefined
    const need=perUnit(c)*quantity
    const line:BomLine={key:`${trail.join('/')}/${c.id}`,depth,component:c,need,sub,last:i===bom.components.length-1}
    return sub&&!trail.includes(sub.id)&&depth<4?[line,...flattenBom(s,sub,need,depth+1,[...trail,bom.id])]:[line]
  })
}

/** Indented BOM table: Component · Qty · UOM · Scrap · Cost · Available. Sub-assemblies expand in place. */
export function BomTree({bom,quantity=1}:{bom:Bom;quantity?:number}){
  const app=useApp(),s=app.state
  const lines=flattenBom(s,bom,quantity)
  const unitCost=(id:string)=>s.rawMaterials.find(m=>m.id===id)?.standardCost??s.products.find(p=>p.id===id)?.standardCost??0
  const top=lines.filter(l=>l.depth===0).reduce((a,l)=>a+l.need*unitCost(l.component.materialId),0)
  return <div className="table-scroll"><table className="fit bom-table"><thead><tr><th>Komponent</th><th className="align-right">Qty</th><th>UOM</th><th className="align-right">Scrap</th><th className="align-right">Tannarx</th><th className="align-right">Available</th></tr></thead><tbody>
    {lines.map(l=>{const c=l.component,st=stockOf(s,c.materialId),short=st.available<l.need;return <tr key={l.key} className={l.depth?'bom-child':undefined}>
      <td><div className="bom-cell" style={{['--depth' as string]:l.depth}}><span className={`bom-node-icon ${l.sub?'sub':''}`}><Icon name={l.sub?'box':'layers'} size={13}/></span><span className="cell-main"><b>{materialName(s,c.materialId)}</b><small>{l.sub?`sub-assembly · ${l.sub.code} ${l.sub.version}`:s.rawMaterials.find(m=>m.id===c.materialId)?.sku||''}</small></span></div></td>
      <td className="align-right">{num(l.need,3)}</td>
      <td className="muted">{c.unit}</td>
      <td className="align-right">{c.waste?`${c.waste}%`:<span className="muted">—</span>}</td>
      <td className="align-right">{l.depth?<span className="muted">{money(l.need*unitCost(c.materialId))}</span>:money(l.need*unitCost(c.materialId))}</td>
      <td className={`align-right ${short?'negative':''}`}>{num(st.available)}</td>
    </tr>})}
  </tbody><tfoot><tr className="total"><td colSpan={4}>Material jami <span className="soft-meta">· {num(quantity)} dona uchun, 1-daraja</span></td><td className="align-right">{money(top)}</td><td/></tr></tfoot></table></div>
}

/* -------------------------------------------------------------------- BOM -- */
function BomView(){
  const app=useApp(),s=app.state
  const [q,setQ]=useState(''),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useSearchParamState('id')
  const [presetProduct]=useSearchParamState('product')
  const [create,setCreate]=useState(Boolean(presetProduct))
  const list=s.boms.filter(b=>(!status||b.status===status)&&`${b.code} ${b.version} ${productName(s,b.productId)} ${variantCode(s,b)}`.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.code.localeCompare(b.code)||b.version.localeCompare(a.version))
  const selected=s.boms.find(b=>b.id===id)||list[0]
  return <div className="page-stack">
    <PageHeader title="BOM" subtitle="Tuzilma, routing va tannarx · faol BOM ECO orqali o‘zgaradi"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('products','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi BOM</button>}/>
    <div className="master-detail">
      <Card className="master-pane">
        <div className="master-tools"><Input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="BOM qidirish..." aria-label="BOM qidirish"/><FilterSelect label="Status" value={status} onChange={setStatus} options={['Faol','Draft','Arxiv']}/></div>
        {list.length?<div className="master-list" role="listbox" aria-label="BOMlar">{list.map(b=><button type="button" role="option" aria-selected={selected?.id===b.id} key={b.id} className={selected?.id===b.id?'active':''} onClick={()=>setId(b.id)}><span><b>{b.code} · {b.version}</b><small>{productName(s,b.productId)}{b.variantId?` · ${variantCode(s,b)}`:''}</small></span><StatusBadge>{b.status}</StatusBadge></button>)}</div>:<Empty compact title="BOM topilmadi"/>}
      </Card>
      {selected?<BomDetail bom={selected}/>:<Card><Empty title="BOM tanlang"/></Card>}
    </div>
    {create&&<NewBomModal defaultProduct={presetProduct} onClose={()=>setCreate(false)} onCreated={newId=>setId(newId)}/>}
  </div>
}

const variantCode=(s:ReturnType<typeof useApp>['state'],b:Bom)=>b.variantId?s.products.find(p=>p.id===b.productId)?.variants.find(v=>v.id===b.variantId)?.code||'variant':''

function NewBomModal({defaultProduct,onClose,onCreated}:{defaultProduct?:string;onClose:()=>void;onCreated:(id:string)=>void}){
  const app=useApp(),s=app.state
  const candidates=s.products.filter(p=>p.procurement==='make'&&p.status!=='Arxiv')
  const [productId,setProductId]=useState(defaultProduct&&candidates.some(p=>p.id===defaultProduct)?defaultProduct:candidates[0]?.id||'')
  const [variantId,setVariantId]=useState('')
  const [fromBomId,setFromBomId]=useState('')
  const product=s.products.find(p=>p.id===productId)
  const active=activeBomFor(s,productId,variantId||undefined)
  const hasDraft=s.boms.some(b=>b.productId===productId&&b.status==='Draft'&&(b.variantId||'')===variantId)
  const sources=s.boms.filter(b=>b.status!=='Draft')
  return <Modal open onClose={onClose} title="Yangi BOM revision" size="md" subtitle={fromBomId?'Tanlangan BOM nusxasidan draft yaratiladi':active?`${active.code} ${active.version} nusxasidan draft yaratiladi`:'Bo‘sh draft yaratiladi'}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!productId||hasDraft} onClick={()=>{const r=app.createBomDraft(productId,fromBomId||undefined,variantId||undefined);if(r.ok&&r.id){onCreated(r.id);onClose()}}}>Draft yaratish</button></>}>
    {candidates.length?<div className="form-stack">
      <Field label="Mahsulot"><Select value={productId} onChange={v=>{setProductId(v);setVariantId('')}}>{candidates.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</Select></Field>
      {(product?.variants||[]).some(v=>v.status==='Faol')&&<Field label="Qo‘llanish" hint="Variant BOM’i faqat shu variant uchun; qolganlari umumiy BOM’dan foydalanadi"><Select value={variantId} onChange={setVariantId}><option value="">Umumiy (barcha variantlar)</option>{product!.variants.filter(v=>v.status==='Faol').map(v=><option key={v.id} value={v.id}>{v.code} · {v.attributes}</option>)}</Select></Field>}
      <Field label="Nusxa manbai" hint="Bo‘sh — joriy faol revision"><Select value={fromBomId} onChange={setFromBomId}><option value="">Joriy faol revision</option>{sources.map(b=><option key={b.id} value={b.id}>{b.code} {b.version} · {productName(s,b.productId)} ({b.status})</option>)}</Select></Field>
      {hasDraft&&<div className="inline-note warning"><Icon name="warning"/>Bu mahsulot{variantId?' varianti':''} uchun draft mavjud — o‘shani tahrirlang.</div>}
    </div>:<Empty compact title="Ishlab chiqariladigan mahsulot yo‘q"/>}
  </Modal>
}

/** Archive (take out of use) a BOM revision, with a reason. */
function ArchiveBomModal({bom,onClose}:{bom:Bom;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({reason:''},v=>({reason:required(v.reason,'Sabab')}))
  const open=s.productionOrders.filter(o=>o.bomId===bom.id&&!['Yakunlangan','Bekor qilingan'].includes(o.status)).length
  return <Modal open onClose={onClose} size="sm" title={`${bom.code} ${bom.version} arxivlansinmi?`} footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={()=>form.submit(v=>{const r=app.archiveBom(bom.id,v.reason);if(r.ok)onClose();return r.ok})}>Arxivlash</button></>}>
    <div className="form-stack">
      <p className="soft-meta">{bom.status==='Faol'?'Faol revision arxivlansa, yangi revision faollashmaguncha bu mahsulot uchun yangi MO ochilmaydi.':'Draft arxivga o‘tadi va tahrirlanmaydi.'}{open?` ${open} ta ochiq MO o‘z snapshoti bilan davom etadi.`:''} Tarix o‘chirilmaydi.</p>
      <Field label="Sabab" required error={form.error('reason')}><Input {...form.input('reason')} autoFocus/></Field>
    </div>
  </Modal>
}

/** Copies the routing of another revision into this draft. */
function CopyRoutingModal({bom,onClose}:{bom:Bom;onClose:()=>void}){
  const app=useApp(),s=app.state
  const sources=s.boms.filter(b=>b.id!==bom.id&&b.operations.length)
  const [source,setSource]=useState(sources.find(b=>b.productId===bom.productId)?.id||sources[0]?.id||'')
  return <Modal open onClose={onClose} size="sm" title="Routingni nusxalash" subtitle={`${bom.code} ${bom.version} draft routingi almashtiriladi`} footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!source} onClick={()=>{if(app.copyRouting(bom.id,source).ok)onClose()}}>Nusxalash</button></>}>
    {sources.length?<Field label="Manba"><Select value={source} onChange={setSource}>{sources.map(b=><option key={b.id} value={b.id}>{b.code} {b.version} · {productName(s,b.productId)} · {b.operations.length} op ({b.status})</option>)}</Select></Field>:<Empty compact title="Routingli BOM yo‘q"/>}
  </Modal>
}

function BomDetail({bom}:{bom:Bom}){
  const app=useApp(),s=app.state
  const [edit,setEdit]=useState(false),[remove,setRemove]=useState(false),[eco,setEco]=useState(false),[tab,setTab]=useState('structure'),[archive,setArchive]=useState(false),[copy,setCopy]=useState(false)
  const cost=estimateOrderCost(s,{bomSnapshot:bom,quantity:100})
  const usedBy=s.productionOrders.filter(o=>o.bomId===bom.id)
  const draftOfProduct=s.boms.find(b=>b.productId===bom.productId&&b.status==='Draft'&&(b.variantId||'')===(bom.variantId||''))
  const lockedBy=s.engineeringChanges.find(e=>e.newBomId===bom.id&&['Draft','Review','Approved'].includes(e.status))
  const editable=bom.status==='Draft'&&(!lockedBy||lockedBy.status==='Draft')
  return <Card className="detail-pane">
    <div className="detail-title"><div><span className="eyebrow">{productName(s,bom.productId)}{bom.variantId?` · ${variantCode(s,bom)}`:''}</span><h2>{bom.code} · {bom.version}</h2><p>Revision {bom.revision} · effective {bom.effectiveDate}{bom.previousBomId?` · oldingi: ${s.boms.find(b=>b.id===bom.previousBomId)?.version||'—'}`:''}{bom.releasedAt?` · faollashgan ${bom.releasedAt}`:''}{bom.archivedAt?` · arxiv ${bom.archivedAt}`:''}{bom.ecoId?` · ${s.engineeringChanges.find(e=>e.id===bom.ecoId)?.code||'ECO'}`:''}</p></div>
      <div className="row-actions"><StatusBadge>{bom.status}</StatusBadge>
        {lockedBy&&<span className="chip">{lockedBy.code} · {lockedBy.status}</span>}
        {bom.status==='Draft'&&!lockedBy&&app.can('products','delete')&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}
        {bom.status!=='Arxiv'&&!lockedBy&&app.can('products','approve')&&<button type="button" className="ghost-btn" onClick={()=>setArchive(true)}><Icon name="box" size={15}/>Arxivlash</button>}
        {editable&&app.can('products','edit')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setCopy(true)}><Icon name="copy" size={14}/>Routing nusxasi</button>}
        {editable&&app.can('products','edit')&&<button type="button" className="primary-glass-btn compact" onClick={()=>setEdit(true)}><Icon name="edit" size={14}/>Tahrirlash</button>}
        {bom.status==='Faol'&&!draftOfProduct&&app.can('products','create')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setEco(true)}><Icon name="copy" size={14}/>Yangi revision (ECO)</button>}
        {bom.status==='Faol'&&draftOfProduct&&<span className="soft-meta">Draft {draftOfProduct.version} mavjud</span>}
      </div>
    </div>
    <InfoGrid columns={4} items={[...(app.can('costs')?[{label:'Material / dona',value:money(cost.material/100)},{label:'Mehnat + uskuna / dona',value:money((cost.labor+cost.machine)/100)},{label:'Jami tannarx / dona',value:money(cost.total/100)}]:[]),{label:'MOlarda ishlatilgan',value:`${usedBy.length} ta`}]}/>
    <Tabs items={[{value:'structure',label:'Tuzilma'},{value:'routing',label:'Routing',count:bom.operations.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='structure'&&<>{bom.components.length?<BomTree bom={bom}/>:<Empty compact title="Komponent yo‘q"/>}
      {bom.byProducts?.length?<><SectionTitle title="By-product / co-product"/>{bom.byProducts.map(b=><div className="list-row" key={b.productId}><span className="list-row-copy"><b>{productName(s,b.productId)}</b><small>har birlik uchun</small></span><b>{b.qty} {b.unit}</b></div>)}</>:null}
      {bom.notes&&<div className="inline-note"><Icon name="info"/>{bom.notes}</div>}</>}
    {tab==='routing'&&<RoutingFlow bom={bom}/>}
    {tab==='docs'&&<AttachmentsPanel entityType="bom" entityId={bom.id} canEdit={app.can('products','edit')}/>}
    {tab==='history'&&<ActivityPanel sources={[bom.code]}/>}
    {edit&&<BomEditor bom={bom} onClose={()=>setEdit(false)}/>}
    {eco&&<EcoModal productId={bom.productId} onClose={()=>setEco(false)}/>}
    {archive&&<ArchiveBomModal bom={bom} onClose={()=>setArchive(false)}/>}
    {copy&&<CopyRoutingModal bom={bom} onClose={()=>setCopy(false)}/>}
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>app.deleteBomDraft(bom.id)} danger title="Draft BOM o‘chirilsinmi?" text={`${bom.code} ${bom.version} draft butunlay o‘chiriladi.`} confirmText="O‘chirish"/>
  </Card>
}

function RoutingFlow({bom}:{bom:Bom}){
  const s=useApp().state
  if(!bom.operations.length)return <Empty compact title="Routing yo‘q"/>
  return <ol className="routing-flow">{bom.operations.map((o,i)=><li key={o.id}>
    <span className="op-index">{i+1}</span>
    <div><b>{o.name}</b><small>{workCenterName(s,o.workCenterId)} · setup {o.setupMin} min · run {o.runMin} min/dona · {o.employeeCount} operator</small>
      <p>{o.instructions}</p>
      <div className="badge-row">{o.qualityCheck&&<StatusBadge tone="purple">QC</StatusBadge>}{o.worksheet&&<span className="chip"><Icon name="file" size={12}/>{o.worksheet}</span>}{o.dependsOn?.length?<span className="chip">Bog‘liq: {o.dependsOn.map(d=>bom.operations.find(x=>x.id===d)?.name).join(', ')}</span>:<span className="chip">Birinchi operatsiya</span>}</div>
    </div>
  </li>)}</ol>
}

function Routing(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status','Faol'),[wc,setWc]=useSearchParamState('wc')
  const [edit,setEdit]=useState<Bom|null>(null),[copy,setCopy]=useState<Bom|null>(null),[archive,setArchive]=useState<Bom|null>(null)
  const text=(b:Bom)=>`${productName(s,b.productId)} ${b.code} ${b.version} ${b.operations.map(o=>o.name).join(' ')}`.toLowerCase()
  const list=s.boms.filter(b=>(!status||b.status===status)&&(!wc||b.operations.some(o=>o.workCenterId===wc))&&(!q||text(b).includes(q.toLowerCase()))).sort((a,b)=>productName(s,a.productId).localeCompare(productName(s,b.productId))||b.version.localeCompare(a.version))
  const locked=(b:Bom)=>s.engineeringChanges.some(e=>e.newBomId===b.id&&['Review','Approved'].includes(e.status))
  // A released routing is history: a change starts a new draft revision (its routing is copied), then it is edited.
  const revise=(b:Bom)=>{
    const draft=s.boms.find(x=>x.productId===b.productId&&x.status==='Draft'&&(x.variantId||'')===(b.variantId||''))
    if(draft){navigate(`/products?view=bom&id=${draft.id}`);return}
    const r=app.createBomDraft(b.productId,b.id,b.variantId)
    if(r.ok&&r.id)navigate(`/products?view=bom&id=${r.id}`)
  }
  return <div className="page-stack">
    <PageHeader title="Routing" subtitle="Operatsiyalar BOM revisioni bilan versiyalanadi · faol routing yangi revision orqali o‘zgaradi"/>
    <Card className="flush">
      <div className="master-tools"><Input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Mahsulot, BOM, operatsiya..." aria-label="Routing qidirish"/><FilterSelect label="Status" value={status} onChange={setStatus} defaultValue="Faol" options={['Faol','Draft','Arxiv']}/><FilterSelect label="Work center" value={wc} onChange={setWc} options={s.workCenters.map(w=>({value:w.id,label:w.name}))}/></div>
      {list.length?<div className="table-scroll"><table className="routing-table"><thead><tr><th>#</th><th>Operatsiya</th><th>Work center</th><th className="align-right">Setup</th><th className="align-right">Run / dona</th><th className="align-right">Operator</th><th>Nazorat</th><th>Bog‘liqlik</th></tr></thead><tbody>
      {list.map(b=>[
        <tr key={b.id} className="ops-group"><td colSpan={8}><span className="badge-row"><span>{productName(s,b.productId)}{b.variantId?` · ${variantCode(s,b)}`:''}</span><span className="soft-meta">{b.code} · {b.version} · effective {b.effectiveDate} · {b.operations.length} operatsiya</span><StatusBadge>{b.status}</StatusBadge>
          <button type="button" className="link-btn" onClick={()=>navigate(`/products?view=bom&id=${b.id}`)}>BOM</button>
          {b.status==='Draft'&&!locked(b)&&app.can('products','edit')&&<><button type="button" className="link-btn" onClick={()=>setEdit(b)}>Tahrirlash</button><button type="button" className="link-btn" onClick={()=>setCopy(b)}>Nusxa olish</button></>}
          {b.status==='Faol'&&app.can('products','create')&&<button type="button" className="link-btn" onClick={()=>revise(b)}>Yangi revision</button>}
          {b.status!=='Arxiv'&&!locked(b)&&app.can('products','approve')&&<button type="button" className="link-btn" onClick={()=>setArchive(b)}>Arxivlash</button>}
          {locked(b)&&<span className="chip">ECO review — qulflangan</span>}
        </span></td></tr>,
        ...b.operations.map((o,i)=><tr key={o.id}>
          <td><span className="op-index sm">{i+1}</span></td>
          <td><div className="cell-main"><b>{o.name}</b>{o.instructions&&<small title={o.instructions}>{o.instructions}</small>}</div></td>
          <td>{workCenterName(s,o.workCenterId)}</td>
          <td className="align-right">{o.setupMin} min</td>
          <td className="align-right">{o.runMin} min</td>
          <td className="align-right">{o.employeeCount}</td>
          <td><span className="badge-row">{o.qualityCheck?<StatusBadge tone="purple">QC</StatusBadge>:<span className="muted">—</span>}{o.worksheet&&<span className="chip">{o.worksheet}</span>}</span></td>
          <td className="muted">{o.dependsOn?.length?o.dependsOn.map(d=>b.operations.find(x=>x.id===d)?.name).join(', '):'Birinchi'}</td>
        </tr>)
      ])}
    </tbody></table></div>:<Empty title="Routing topilmadi" text="Filtrlarni o‘zgartiring"/>}
    </Card>
    {edit&&<BomEditor bom={edit} onClose={()=>setEdit(null)}/>}
    {copy&&<CopyRoutingModal bom={copy} onClose={()=>setCopy(null)}/>}
    {archive&&<ArchiveBomModal bom={archive} onClose={()=>setArchive(null)}/>}
  </div>
}

/* ------------------------------------------------------------- categories -- */
function Categories(){
  const s=useApp().state,navigate=useNavigate()
  const cats=useMemo(()=>[...new Set(s.products.map(p=>p.category))].map(c=>{const items=s.products.filter(p=>p.category===c);return {c,items,stock:items.reduce((a,p)=>a+stockOf(s,p.id).onHand,0),active:items.filter(p=>p.status!=='Arxiv').length}}),[s])
  return <div className="page-stack">
    <PageHeader title="Kategoriyalar" subtitle="Bosing — kategoriya mahsulotlari"/>
    <div className="card flush"><div className="table-scroll"><table className="fit is-interactive"><thead><tr><th>Kategoriya</th><th className="align-right">Mahsulot</th><th className="align-right">Faol</th><th className="align-right">On hand</th><th>SKU</th><th className="action-col" aria-hidden="true"/></tr></thead><tbody>
      {cats.map(({c,items,stock,active})=><tr key={c} tabIndex={0} aria-label={`${c} — ochish`} onClick={()=>navigate(`/products?view=all&category=${encodeURIComponent(c)}`)} onKeyDown={e=>{if(e.key==='Enter')navigate(`/products?view=all&category=${encodeURIComponent(c)}`)}}>
        <td><b>{c}</b></td><td className="align-right">{items.length}</td><td className="align-right">{active}</td><td className="align-right">{num(stock)}</td><td><span className="badge-row">{items.slice(0,4).map(p=><span className="chip" key={p.id}>{p.sku}</span>)}{items.length>4&&<span className="soft-meta">+{items.length-4}</span>}</span></td><td className="action-col"><Icon name="chevron" size={14}/></td>
      </tr>)}
    </tbody></table></div></div>
  </div>
}

/* --------------------------------------------------------------- variants -- */
function Variants(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[productId,setProductId]=useSearchParamState('product')
  const [editing,setEditing]=useState<{product:Product;variant?:ProductVariant}|null>(null)
  const [status,setStatus]=useSearchParamState('status')
  const rows=s.products.flatMap(p=>p.variants.map(v=>({...v,id:`${p.id}:${v.id}`,variantId:v.id,product:p}))).filter(r=>(!productId||r.product.id===productId)&&(!status||r.status===status))
  return <div className="page-stack">
    <PageHeader title="Variantlar" subtitle="Atributlar va narx farqi"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('products','edit')} onClick={()=>setEditing({product:s.products.find(p=>p.id===productId)||s.products[0]})}><Icon name="plus"/>Variant qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Kod, atribut, mahsulot..." onRow={r=>setEditing({product:r.product,variant:r.product.variants.find(v=>v.id===r.variantId)})} exportName="product-variants"
      filters={<><FilterSelect label="Mahsulot" value={productId} onChange={setProductId} options={s.products.map(p=>({value:p.id,label:p.name}))}/><FilterSelect label="Status" value={status} onChange={setStatus} options={['Faol','Arxiv']}/></>} filtersActive={Boolean(productId||status)} onResetFilters={()=>{setProductId('');setStatus('')}}
      emptyText="Variant qo‘shing"
      columns={[{key:'code',label:'Variant',value:r=>r.code,render:r=><div className="cell-main"><b>{r.code}</b><small>{r.product.name}{r.barcode?` · ${r.barcode}`:''}</small></div>},{key:'attributes',label:'Atributlar',value:r=>r.attributes},
        {key:'bom',label:'BOM',value:r=>s.boms.find(b=>b.productId===r.product.id&&b.variantId===r.variantId&&b.status==='Faol')?.version||'umumiy',priority:'low'},{key:'price',label:'Narx',align:'right',value:r=>r.product.salePrice+r.priceDelta,render:r=><span>{money(r.product.salePrice+r.priceDelta)}{r.priceDelta?<small className="cell-sub">+{money(r.priceDelta)}</small>:null}</span>},{key:'status',label:'Status',value:r=>r.status,render:r=><StatusBadge>{r.status}</StatusBadge>}]}/>
    {editing&&<VariantPicker editing={editing} onClose={()=>setEditing(null)}/>}
  </div>
}

function VariantPicker({editing,onClose}:{editing:{product:Product;variant?:ProductVariant};onClose:()=>void}){
  return <VariantModal product={editing.product} variant={editing.variant} chooseProduct={!editing.variant} onClose={onClose}/>
}

/* --------------------------------------------------------------- versions -- */
function Versions(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[productId,setProductId]=useSearchParamState('product')
  const [activate,setActivate]=useState<Bom|null>(null),[archive,setArchive]=useState<Bom|null>(null)
  const rows=s.boms.filter(b=>!productId||b.productId===productId)
  return <div className="page-stack">
    <PageHeader title="BOM versiyalari" subtitle="Yangi versiya faollashsa eskisi arxivlanadi"/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="BOM kodi, versiya..." onRow={b=>navigate(`/products?view=bom&id=${b.id}`)} exportName="bom-versions" initialSort={{key:'product',dir:1}}
      filters={<FilterSelect label="Mahsulot" value={productId} onChange={setProductId} options={s.products.filter(p=>p.procurement==='make').map(p=>({value:p.id,label:p.name}))}/>} filtersActive={Boolean(productId)} onResetFilters={()=>setProductId('')}
      columns={[
        {key:'code',label:'BOM',value:b=>b.code},
        {key:'product',label:'Mahsulot',value:b=>productName(s,b.productId)},
        {key:'version',label:'Versiya',value:b=>b.version},
        {key:'variant',label:'Qo‘llanish',value:b=>variantCode(s,b)||'Umumiy',priority:'low'},
        {key:'revision',label:'Revision',align:'right',value:b=>b.revision},
        {key:'effective',label:'Effective',value:b=>b.effectiveDate},
        {key:'status',label:'Status',value:b=>b.status,render:b=><StatusBadge>{b.status}</StatusBadge>},
        {key:'orders',label:'MOlar',align:'right',value:b=>s.productionOrders.filter(o=>o.bomId===b.id).length},
        {key:'actions',label:'',sortable:false,searchable:false,render:b=>app.can('products','approve')?<span className="badge-row">{b.status==='Draft'&&!s.engineeringChanges.some(e=>e.newBomId===b.id&&['Draft','Review','Approved'].includes(e.status))&&<button type="button" className="soft-glass-btn compact" onClick={e=>{e.stopPropagation();setActivate(b)}}>Faollashtirish</button>}{b.status!=='Arxiv'&&<button type="button" className="ghost-btn" onClick={e=>{e.stopPropagation();setArchive(b)}}>Arxivlash</button>}</span>:null},
      ]}/>
    {archive&&<ArchiveBomModal bom={archive} onClose={()=>setArchive(null)}/>}
    <Confirm open={!!activate} onClose={()=>setActivate(null)} onConfirm={()=>activate&&app.activateBom(activate.id)} title="Versiyani faollashtirish" text={`${activate?.code} ${activate?.version} faol bo‘ladi, joriy faol versiya arxivlanadi.`} confirmText="Faollashtirish"/>
  </div>
}

/* -------------------------------------------------------------------- PLM -- */
function PLM(){
  const app=useApp(),s=app.state
  const [id,setId]=useSearchParamState('id'),[status,setStatus]=useSearchParamState('status')
  const [create,setCreate]=useState(false),[edit,setEdit]=useState<Bom|null>(null),[apply,setApply]=useState(false),[decide,setDecide]=useState<'Rejected'|'Cancelled'|null>(null)
  const list=[...s.engineeringChanges].filter(e=>!status||e.status===status).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const eco=list.find(e=>e.id===id)||list[0]
  const from=s.boms.find(b=>b.id===eco?.bomId),to=s.boms.find(b=>b.id===eco?.newBomId)
  // Once reviewed, the frozen requested changes are what was approved; before that, the live difference.
  const diff=eco?.changes&&eco.status!=='Draft'&&eco.status!=='Rejected'?eco.changes:ecoChanges(s,from,to)
  const canApprove=app.can('products','approve')
  const mine=eco?.ownerId===app.currentEmployee.id
  return <div className="page-stack">
    <PageHeader title="PLM / ECO" subtitle="Draft → review → approve → apply"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('products','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi ECO</button>}/>
    <div className="master-detail">
      <Card className="master-pane"><div className="master-tools"><FilterSelect label="Status" value={status} onChange={setStatus} options={['Draft','Review','Approved','Applied','Rejected','Cancelled']}/></div>{list.length?<div className="master-list" role="listbox" aria-label="ECOlar">{list.map(e=><button type="button" role="option" aria-selected={eco?.id===e.id} key={e.id} className={eco?.id===e.id?'active':''} onClick={()=>setId(e.id)}><span><b>{e.code}</b><small>{e.title}</small></span><StatusBadge>{e.status}</StatusBadge></button>)}</div>:<Empty compact title="ECO yo‘q"/>}</Card>
      {eco?<Card className="detail-pane">
        <div className="detail-title"><div><span className="eyebrow">{productName(s,eco.productId)}</span><h2>{eco.code}</h2><p>{eco.title}</p></div>
          <div className="row-actions"><StatusBadge>{eco.status}</StatusBadge>
            {to?.status==='Draft'&&['Draft','Rejected'].includes(eco.status)&&app.can('products','edit')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setEdit(to)}><Icon name="edit" size={14}/>Draft BOM’ni tahrirlash</button>}
            {['Draft','Rejected'].includes(eco.status)&&(app.can('products','edit')||canApprove)&&<button type="button" className="secondary-glass-btn compact" onClick={()=>app.setEcoStatus(eco.id,'Review')}>Reviewga yuborish</button>}
            {['Review','Approved'].includes(eco.status)&&canApprove&&<button type="button" className="ghost-btn" onClick={()=>setDecide('Rejected')}>Rad etish</button>}
            {eco.status==='Review'&&canApprove&&<button type="button" className="secondary-glass-btn compact" disabled={mine} title={mine?'O‘zingiz yaratgan ECO’ni boshqa mas’ul tasdiqlaydi':undefined} onClick={()=>app.setEcoStatus(eco.id,'Approved')}><Icon name="check" size={14}/>Tasdiqlash</button>}
            {!['Applied','Cancelled'].includes(eco.status)&&(mine||canApprove)&&<button type="button" className="ghost-btn" onClick={()=>setDecide('Cancelled')}><Icon name="x" size={14}/>Bekor qilish</button>}
            {eco.status==='Approved'&&canApprove&&<button type="button" className="primary-glass-btn compact" onClick={()=>setApply(true)}><Icon name="flag" size={14}/>Qo‘llash</button>}
          </div>
        </div>
        <InfoGrid columns={4} items={[{label:'Effective',value:eco.effectiveDate},{label:'So‘ragan',value:employeeName(s,eco.ownerId)},{label:'Tasdiqlagan',value:eco.approvedBy?`${employeeName(s,eco.approvedBy)}${eco.approvedAt?` · ${eco.approvedAt}`:''}`:'—'},{label:eco.appliedAt?'Qo‘llangan':'Yaratilgan',value:eco.appliedAt?`${eco.appliedAt} · ${employeeName(s,eco.appliedBy||'')}`:eco.createdAt}]}/>
        <div className="version-compare"><div><span>Joriy</span><strong>{eco.fromVersion}</strong><small>{from?.status||'—'}</small></div><Icon name="arrow-right"/><div><span>Yangi</span><strong>{eco.toVersion}</strong><small>{to?.status||'—'}</small></div></div>
        <SectionTitle title={eco.changes&&!['Draft','Rejected'].includes(eco.status)?'Tasdiqlanadigan o‘zgarishlar (review’da muzlatilgan)':'BOM / routing farqi'}/>
        {diff.length?<div className="table-scroll"><table className="fit"><thead><tr><th>O‘zgarish</th><th>Joriy</th><th>Taklif</th></tr></thead><tbody>{diff.map((d,i)=><tr key={i} className={`diff-${d.kind}`}><td><span className="badge-row"><Icon name={d.kind==='add'?'plus':d.kind==='remove'?'minus':'edit'} size={13}/>{d.text}</span></td><td className="muted">{'old' in d&&d.old!==undefined?d.old:'—'}</td><td>{'proposed' in d&&d.proposed!==undefined?d.proposed:'—'}</td></tr>)}</tbody></table></div>:<div className="inline-note warning"><Icon name="info"/>Draft joriy versiyadan farq qilmaydi</div>}
        <SectionTitle title="Sabab va xulosa"/><p className="prose">{eco.reason}</p>{eco.changeSummary&&<div className="inline-note">{eco.changeSummary}</div>}
        {eco.history?.length?<><SectionTitle title="ECO tarixi"/><div className="stack-list">{eco.history.map((h,i)=><div className="list-row" key={i}><span className="list-row-copy"><b>{h.action}</b><small>{h.at} · {employeeName(s,h.by)}{h.note?` · ${h.note}`:''}</small></span></div>)}</div></>:null}
        <SectionTitle title="Hujjatlar"/><AttachmentsPanel entityType="eco" entityId={eco.id} canEdit={app.can('products','edit')&&eco.status!=='Applied'}/>
        <SectionTitle title="Audit tarixi"/><ActivityPanel sources={[eco.code]}/>
      </Card>:<Card><Empty title="ECO tanlang"/></Card>}
    </div>
    {create&&<EcoModal onClose={()=>setCreate(false)} onCreated={setId}/>}
    {edit&&<BomEditor bom={edit} onClose={()=>setEdit(null)}/>}
    <Confirm open={apply} onClose={()=>setApply(false)} onConfirm={()=>eco&&app.applyEngineeringChange(eco.id)} title={`${eco?.code} qo‘llansinmi?`} text={`${eco?.toVersion} faol BOM bo‘ladi, ${eco?.fromVersion} arxivlanadi. Yangi MOlar yangi versiyadan foydalanadi.`} confirmText="Qo‘llash"/>
    {decide&&eco&&<EcoDecisionModal ecoId={eco.id} code={eco.code} action={decide} onClose={()=>setDecide(null)}/>}
  </div>
}

/** Rejection (back to editing) or cancellation of an ECO, with the reason recorded in its history. */
function EcoDecisionModal({ecoId,code,action,onClose}:{ecoId:string;code:string;action:'Rejected'|'Cancelled';onClose:()=>void}){
  const app=useApp()
  const form=useForm({note:''},v=>({note:required(v.note,'Sabab')}))
  const save=()=>form.submit(v=>{const r=action==='Rejected'?app.setEcoStatus(ecoId,'Rejected',v.note):app.cancelEngineeringChange(ecoId,v.note);if(r.ok)onClose();return r.ok})
  return <Modal open onClose={onClose} size="sm" title={action==='Rejected'?`${code} rad etilsinmi?`:`${code} bekor qilinsinmi?`} footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button><button type="button" className="danger-glass-btn" onClick={save}>{action==='Rejected'?'Rad etish':'Bekor qilish'}</button></>}>
    <div className="form-stack">
      <p className="soft-meta">{action==='Rejected'?'Draft qulfdan chiqadi va tahrirlanishi mumkin; qayta reviewga yuboriladi.':'ECO yopiladi; draft BOM oddiy draft sifatida qoladi (o‘chirish yoki arxivlash mumkin).'}</p>
      <Field label="Sabab" required error={form.error('note')}><Textarea {...form.input('note')} autoFocus/></Field>
    </div>
  </Modal>
}

function EcoModal({productId,onClose,onCreated}:{productId?:string;onClose:()=>void;onCreated?:(id:string)=>void}){
  const app=useApp(),s=app.state
  const products=s.products.filter(p=>activeBomFor(s,p.id))
  const form=useForm({productId:productId||products[0]?.id||'',title:'',reason:'',summary:'',effective:addDays(todayISO(),7)},v=>({reason:required(v.reason,'Sabab'),productId:v.productId?undefined:'Mahsulot tanlang'}))
  return <Modal open onClose={onClose} title="Engineering Change Order" subtitle="Faol versiyadan draft BOM yaratiladi" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createEngineeringChange({productId:v.productId,title:v.title,reason:v.reason,changeSummary:v.summary,effectiveDate:v.effective});if(r.ok){onCreated?.(r.id!);onClose()}return r.ok})}>ECO yaratish</button></>}>
    <div className="form-grid">
      <Field label="Mahsulot" required error={form.error('productId')}><Select value={form.values.productId} onChange={v=>form.set('productId',v)}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {activeBomFor(s,p.id)?.version}</option>)}</Select></Field>
      <Field label="Effective date"><Input type="date" {...form.input('effective')}/></Field>
      <Field className="span-2" label="Sarlavha"><Input {...form.input('title')} placeholder="Bo‘sh — avtomatik"/></Field>
      <Field className="span-2" label="Sabab" required error={form.error('reason')}><Textarea {...form.input('reason')} placeholder="Nega o‘zgartirish kerak?"/></Field>
      <Field className="span-2" label="Rejalashtirilgan o‘zgarishlar"><Textarea {...form.input('summary')} placeholder="Masalan: bo‘yash setup 18→14 min"/></Field>
    </div>
  </Modal>
}

