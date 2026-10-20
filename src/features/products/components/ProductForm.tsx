import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Field,Icon,Input,Modal,MoneyInput,Select,nonNegative,required,useForm} from '../../../shared/ui'
import type {Product} from '../../../types'
import {stamp} from '../../../utils/dates'

const UNITS=['dona','kg','m','l','komplekt']

export function ProductFormModal({product,onClose}:{product?:Product;onClose:()=>void}){
  const app=useApp(),s=app.state
  const categories=[...new Set(s.products.map(p=>p.category))]
  const form=useForm(()=>({name:product?.name||'',sku:product?.sku||'',category:product?.category||categories[0]||'',unit:product?.unit||'dona',type:product?.type||'finished',procurement:product?.procurement||'make',tracking:product?.tracking||'lot',salePrice:String(product?.salePrice??''),standardCost:String(product?.standardCost??''),leadTime:String(product?.leadTime??2),status:product?.status||'Faol'}),v=>({
    name:required(v.name,'Nomi'),
    sku:required(v.sku,'SKU')||(s.products.some(p=>p.id!==product?.id&&p.sku.toLowerCase()===v.sku.trim().toLowerCase())?'Bu SKU allaqachon mavjud':undefined),
    category:required(v.category,'Kategoriya'),
    salePrice:nonNegative(v.salePrice,'Sotuv narxi'),
    standardCost:nonNegative(v.standardCost,'Tannarx'),
    leadTime:nonNegative(v.leadTime,'Lead time'),
  }))
  const submit=()=>form.submit(v=>{
    const payload={name:v.name.trim(),sku:v.sku.trim().toUpperCase(),category:v.category.trim(),unit:v.unit,type:v.type,procurement:v.procurement,tracking:v.tracking,salePrice:Number(v.salePrice),standardCost:Number(v.standardCost),leadTime:Number(v.leadTime),status:v.status}
    const r=product?app.updateEntity('products',product.id,payload):app.createEntity('products',{...payload,defaultBomId:'',variants:[],createdAt:stamp(new Date())})
    if(r.ok)onClose()
    return r.ok
  })
  return <Modal open onClose={onClose} title={product?`${product.name} — tahrirlash`:'Yangi mahsulot'} subtitle="Qoldiq ombor balanslaridan olinadi" size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button>{form.dirty&&<button type="button" className="ghost-btn" onClick={()=>form.reset()}>Qaytarish</button>}<button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Saqlash</button></>}>
    <div className="form-grid">
      <div className="form-group-title">Asosiy</div>
      <Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="SKU" required error={form.error('sku')} hint="Masalan: FG-AL-4040"><Input {...form.input('sku')}/></Field>
      <Field label="Kategoriya" required error={form.error('category')}><Input list="product-categories" {...form.input('category')}/></Field>
      <Field label="O‘lchov birligi"><Select value={form.values.unit} onChange={v=>form.set('unit',v)}>{UNITS.map(u=><option key={u} value={u}>{u}</option>)}</Select></Field>
      <div className="form-group-title">Ishlab chiqarish</div>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v as Product['type'])}><option value="finished">Tayyor mahsulot</option><option value="semi">Yarim tayyor / sub-assembly</option></Select></Field>
      <Field label="Ta’minot (make or buy)"><Select value={form.values.procurement} onChange={v=>form.set('procurement',v as Product['procurement'])}><option value="make">Make — ishlab chiqariladi</option><option value="buy">Buy — sotib olinadi</option></Select></Field>
      <Field label="Kuzatuv (traceability)"><Select value={form.values.tracking} onChange={v=>form.set('tracking',v as Product['tracking'])}><option value="lot">Lot / partiya</option><option value="serial">Serial raqam</option><option value="none">Kuzatilmaydi</option></Select></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v)}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field>
      <div className="form-group-title">Narx</div>
      <Field label="Sotuv narxi" required error={form.error('salePrice')}><MoneyInput min="0" {...form.money('salePrice')}/></Field>
      <Field label="Standart tannarx" required error={form.error('standardCost')} hint="BOM roll-up bilan yangilanadi"><MoneyInput min="0" {...form.money('standardCost')}/></Field>
      <Field label="Lead time (kun)" error={form.error('leadTime')}><Input type="number" min="0" {...form.input('leadTime')}/></Field>
    </div>
    <datalist id="product-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
  </Modal>
}
