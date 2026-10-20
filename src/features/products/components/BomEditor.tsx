import {useState} from 'react'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Checkbox,Confirm,Field,Icon,Input,Modal,Select,Textarea} from '../../../shared/ui'
import type {Bom,BomComponent,BomOperation} from '../../../types'
import {estimateOrderCost} from '../../../domain/manufacturingEngine'
import {money} from '../../../utils/format'
import {itemUnitOf,productName} from '../../common/lookups'

const newId=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`

export function BomEditor({bom,onClose}:{bom:Bom;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [draft,setDraft]=useState<Bom>(()=>JSON.parse(JSON.stringify(bom)))
  const [confirmActivate,setConfirmActivate]=useState(false)
  const [error,setError]=useState('')
  const items=[...s.rawMaterials.filter(m=>m.status!=='Arxiv').map(m=>({id:m.id,label:`${m.name} · ${m.sku}`})),...s.products.filter(p=>p.id!==draft.productId&&p.status!=='Arxiv'&&s.boms.some(b=>b.productId===p.id&&b.status==='Faol')).map(p=>({id:p.id,label:`${p.name} · sub-assembly`}))]
  const setComponent=(i:number,patch:Partial<BomComponent>)=>setDraft(d=>({...d,components:d.components.map((c,x)=>x===i?{...c,...patch,unit:patch.materialId?itemUnitOf(s,patch.materialId):c.unit}:c)}))
  const setOperation=(i:number,patch:Partial<BomOperation>)=>setDraft(d=>({...d,operations:d.operations.map((o,x)=>x===i?{...o,...patch}:o)}))
  const addComponent=()=>setDraft(d=>({...d,components:[...d.components,{id:newId('bc'),materialId:items[0]?.id||'',qty:1,unit:itemUnitOf(s,items[0]?.id),waste:0}]}))
  const addOperation=()=>setDraft(d=>({...d,operations:[...d.operations,{id:newId('bo'),name:'',workCenterId:s.workCenters[0]?.id||'',setupMin:10,runMin:1,employeeCount:1,instructions:'',qualityCheck:false,dependsOn:d.operations.length?[d.operations[d.operations.length-1].id]:[]}]}))
  const removeOperation=(i:number)=>setDraft(d=>{const removed=d.operations[i].id;return {...d,operations:d.operations.filter((_,x)=>x!==i).map(o=>({...o,dependsOn:(o.dependsOn||[]).filter(dep=>dep!==removed)}))}})
  const estimate=estimateOrderCost(s,{bomSnapshot:draft,quantity:100})
  const unitCost=(id:string)=>s.rawMaterials.find(m=>m.id===id)?.standardCost??s.products.find(p=>p.id===id)?.standardCost??0
  const save=()=>{setError('');const r=app.saveBom(draft);if(!r.ok)setError(r.message);return r.ok}
  return <Modal open onClose={onClose} title={`${draft.code} ${draft.version} — tahrirlash`} eyebrow="Draft" subtitle={`${productName(s,draft.productId)} · faol BOM faqat ECO orqali o‘zgaradi`} size="xl"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button><span className="spacer"/><span className="soft-meta">Tannarx ≈ <b>{money(estimate.total/100)}</b>/dona</span><button type="button" className="secondary-glass-btn" onClick={()=>{if(save())onClose()}}><Icon name="check" size={16}/>Saqlash</button>{app.can('products','approve')&&<button type="button" className="primary-glass-btn" onClick={()=>{if(save())setConfirmActivate(true)}}><Icon name="flag" size={16}/>Faollashtirish</button>}</>}>
    <div className="form-stack">
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/>{error}</div>}
      <div className="form-grid cols-3">
        <Field label="Versiya"><Input value={draft.version} onChange={e=>setDraft(d=>({...d,version:e.target.value}))}/></Field>
        <Field label="Effective date"><Input type="date" value={draft.effectiveDate} onChange={e=>setDraft(d=>({...d,effectiveDate:e.target.value}))}/></Field>
        <Field label="Umumiy waste % (ma’lumot uchun)" hint="Hisobda har bir komponentning waste % i ishlatiladi"><Input type="number" min="0" step="0.1" value={String(draft.waste)} onChange={e=>setDraft(d=>({...d,waste:Number(e.target.value)||0}))}/></Field>
      </div>
      <section className="editor-section">
        <div className="editor-head"><h4>Komponentlar</h4><button type="button" className="secondary-glass-btn compact" onClick={addComponent}><Icon name="plus" size={14}/>Komponent</button></div>
        {draft.components.length?<div className="table-scroll"><table className="fit editor-table"><thead><tr><th>Komponent</th><th className="align-right">Qty / dona</th><th>UOM</th><th className="align-right">Scrap %</th><th className="align-right">Tannarx / dona</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>{draft.components.map((c,i)=><tr key={c.id}>
          <td className="wide-cell"><Select value={c.materialId} onChange={v=>setComponent(i,{materialId:v})} ariaLabel={`Komponent ${i+1}`}>{items.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</Select></td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="0" step="0.001" aria-label="Miqdor" value={String(c.qty)} onChange={e=>setComponent(i,{qty:Number(e.target.value)})}/></td>
          <td>{c.unit}</td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="0" step="0.1" aria-label="Scrap %" value={String(c.waste)} onChange={e=>setComponent(i,{waste:Number(e.target.value)||0})}/></td>
          <td className="align-right num">{money(c.qty*(1+c.waste/100)*unitCost(c.materialId))}</td>
          <td className="align-right"><button type="button" className="icon-ghost danger" aria-label="Komponentni o‘chirish" onClick={()=>setDraft(d=>({...d,components:d.components.filter((_,x)=>x!==i)}))}><Icon name="trash" size={15}/></button></td>
        </tr>)}</tbody></table></div>:<p className="soft-meta">Komponent qo‘shilmagan.</p>}
      </section>
      <section className="editor-section">
        <div className="editor-head"><h4>Routing — operatsiyalar</h4><button type="button" className="secondary-glass-btn compact" onClick={addOperation}><Icon name="plus" size={14}/>Operatsiya</button></div>
        {draft.operations.map((o,i)=><div className="op-editor" key={o.id}>
          <span className="op-index">{i+1}</span>
          <div className="form-grid cols-3">
            <Field label="Nomi" required error={!o.name.trim()?'Nom kiriting':undefined}><Input value={o.name} onChange={e=>setOperation(i,{name:e.target.value})}/></Field>
            <Field label="Work center"><Select value={o.workCenterId} onChange={v=>setOperation(i,{workCenterId:v})}>{s.workCenters.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Bog‘liq (oldingi)"><Select value={o.dependsOn?.[0]||''} onChange={v=>setOperation(i,{dependsOn:v?[v]:[]})}><option value="">Yo‘q — parallel boshlanadi</option>{draft.operations.filter((_,x)=>x<i).map(p=><option key={p.id} value={p.id}>{p.name||'(nomsiz)'}</option>)}</Select></Field>
            <Field label="Setup (min)"><Input type="number" min="0" value={String(o.setupMin)} onChange={e=>setOperation(i,{setupMin:Number(e.target.value)||0})}/></Field>
            <Field label="Run (min / dona)"><Input type="number" min="0" step="0.01" value={String(o.runMin)} onChange={e=>setOperation(i,{runMin:Number(e.target.value)||0})}/></Field>
            <Field label="Operatorlar"><Input type="number" min="1" value={String(o.employeeCount)} onChange={e=>setOperation(i,{employeeCount:Math.max(1,Number(e.target.value)||1)})}/></Field>
            <Field className="span-2" label="Ko‘rsatma (work instruction)"><Textarea rows={2} value={o.instructions} onChange={e=>setOperation(i,{instructions:e.target.value})}/></Field>
            <div className="field op-flags"><Checkbox checked={o.qualityCheck} onChange={v=>setOperation(i,{qualityCheck:v})} label="Operatsiyadan keyin QC" description="In-process tekshiruv avtomatik yaratiladi"/><Field label="Worksheet"><Input value={o.worksheet||''} onChange={e=>setOperation(i,{worksheet:e.target.value})} placeholder="WI-..."/></Field></div>
          </div>
          <button type="button" className="icon-ghost danger" aria-label="Operatsiyani o‘chirish" onClick={()=>removeOperation(i)}><Icon name="trash" size={15}/></button>
        </div>)}
      </section>
      <section className="editor-section">
        <div className="editor-head"><h4>By-product / co-product</h4><button type="button" className="secondary-glass-btn compact" onClick={()=>setDraft(d=>({...d,byProducts:[...(d.byProducts||[]),{productId:s.products.find(p=>p.id!==d.productId)?.id||'',qty:.01,unit:'kg'}]}))}><Icon name="plus" size={14}/>By-product</button></div>
        {(draft.byProducts||[]).map((b,i)=><div className="inline-row" key={i}>
          <Select value={b.productId} onChange={v=>setDraft(d=>({...d,byProducts:d.byProducts!.map((x,j)=>j===i?{...x,productId:v,unit:itemUnitOf(s,v)}:x)}))} ariaLabel="By-product">{s.products.filter(p=>p.id!==draft.productId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <input className="ui-input cell-input" type="number" min="0" step="0.001" aria-label="Miqdor / dona" value={String(b.qty)} onChange={e=>setDraft(d=>({...d,byProducts:d.byProducts!.map((x,j)=>j===i?{...x,qty:Number(e.target.value)||0}:x)}))}/><span className="soft-meta">{b.unit} / dona</span>
          <button type="button" className="icon-ghost danger" aria-label="O‘chirish" onClick={()=>setDraft(d=>({...d,byProducts:d.byProducts!.filter((_,j)=>j!==i)}))}><Icon name="trash" size={15}/></button>
        </div>)}
      </section>
      <Field label="Izoh"><Textarea rows={2} value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))}/></Field>
    </div>
    <Confirm open={confirmActivate} onClose={()=>setConfirmActivate(false)} onConfirm={()=>{if(app.activateBom(draft.id).ok)onClose()}} title={`${draft.version} faollashtirilsinmi?`} text="Joriy faol BOM arxivga o‘tadi va mahsulotning default BOM’i yangilanadi. Mavjud buyurtmalar eski snapshot bilan davom etadi." confirmText="Faollashtirish"/>
  </Modal>
}
