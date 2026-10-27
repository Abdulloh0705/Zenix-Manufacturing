import {useState} from 'react'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {Field,Icon,Input,Modal,Segmented,StatusBadge,Textarea,useForm} from '../../shared/ui'
import type {QualityCheck} from '../../types'
import {sourceLabel} from '../../domain/actions'
import {receiptQuantities,rejectedOpen} from '../../domain/supplierMaterials'
import {num} from '../../utils/format'
import {itemUnitOf,materialName} from './lookups'

const RESULTS:QualityCheck['status'][]=['Passed','Hold','Failed','Rework','Scrap']

export function QualityResolveModal({checkId,onClose}:{checkId:string|null;onClose:()=>void}){
  const app=useApp()
  const check=app.state.qualityChecks.find(q=>q.id===checkId)
  if(!check)return null
  return <ResolveForm key={check.id} check={check} onClose={onClose}/>
}

function ResolveForm({check,onClose}:{check:QualityCheck;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [dispose,setDispose]=useState<'return'|'scrap'|null>(null)
  const qcp=s.qualityControlPoints.find(c=>c.id===check.controlPointId)
  // In-process scrap of a running order can name the rejected units: they are scrapped on the order (stock and cost).
  const order=check.sourceType==='production'&&check.type!=='Final'?s.productionOrders.find(o=>o.id===check.sourceId&&['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status)):undefined
  // Incoming checks can split the receipt: the accepted part goes to stock, the rest stays in quarantine as rejected.
  const po=check.sourceType==='purchase'?s.purchaseOrders.find(p=>p.id===check.sourceId):undefined
  const receipt=po?.receipts.find(r=>r.id===check.receiptId)
  const receiptQty=receipt?.qty??0,unit=itemUnitOf(s,check.itemId)
  const form=useForm({status:'Passed' as QualityCheck['status'],reason:'',measured:check.measured||'',qty:'',accepted:String(receiptQty)},v=>{
    const acc=Number(v.accepted),split=Boolean(receipt)&&(v.status==='Passed'||v.status==='Failed')
    return {reason:(v.status!=='Passed'||(split&&acc<receiptQty))&&!v.reason.trim()?'Rad etilgan qism yoki Hold / Failed / Rework / Scrap uchun sabab majburiy':undefined,qty:v.qty!==''&&!(Number.isInteger(Number(v.qty))&&Number(v.qty)>0)?'Musbat butun son':undefined,
      accepted:split&&(v.accepted===''||!(acc>=0)||acc>receiptQty)?`0 dan ${num(receiptQty,3)} gacha`:undefined}
  })
  const splitting=Boolean(receipt)&&(form.values.status==='Passed'||form.values.status==='Failed')
  const reasonNeeded=form.values.status!=='Passed'||(splitting&&Number(form.values.accepted)<receiptQty)
  const save=()=>form.submit(v=>{
    const r=splitting
      ?app.inspectReceipt(check.id,Number(v.accepted),v.reason.trim(),v.measured.trim())
      :app.resolveQuality(check.id,v.status,v.reason.trim(),v.measured.trim(),order&&v.status==='Scrap'&&v.qty!==''?Number(v.qty):undefined)
    if(r.ok)onClose();return r.ok
  })
  // Customer-return checks are decided by the return's disposition, never here (N-05).
  const viaReturn=check.sourceType==='return'
  const readOnly=check.status!=='Pending'||viaReturn
  const split=po&&receipt?receiptQuantities(s,po,receipt):undefined
  const open=po&&receipt?rejectedOpen(s,po,receipt):0
  const disposable=readOnly&&!viaReturn&&check.sourceType==='purchase'&&['Failed','Hold','Rework'].includes(check.status)&&open>0
  return <>
  <Modal open onClose={onClose} title={readOnly?'Tekshiruv natijasi':'Tekshiruv natijasini kiritish'} eyebrow={`${check.type} inspection`} subtitle={`${sourceLabel(s,check.sourceId)} · ${materialName(s,check.itemId)}${check.lot?` · ${check.lot}`:''}`} size="md"
    footer={readOnly?<>{disposable&&(app.can('purchases','edit')||app.can('warehouse','edit'))&&<button type="button" className="danger-glass-btn" onClick={()=>setDispose('return')}><Icon name="undo" size={15}/>Supplierga qaytarish</button>}{disposable&&app.can('quality','edit')&&<button type="button" className="ghost-btn" onClick={()=>setDispose('scrap')}><Icon name="trash" size={15}/>Scrap</button>}<span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button></>:<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className={form.values.status==='Passed'?'primary-glass-btn':'danger-glass-btn'} disabled={!app.can('quality','edit')} title={app.can('quality','edit')?undefined:'Sifat natijasini kiritish uchun quality.edit ruxsati kerak'} onClick={save}>Natijani saqlash</button></>}>
    <div className="form-stack">
      {viaReturn&&check.status==='Pending'&&<div className="inline-note"><Icon name="info"/>Bu mijoz qaytarishi tekshiruvi — qaror Sotuv → Qaytarishlar bo‘limida qabul qilinadi.</div>}
      {qcp&&<div className="inline-note"><b>{qcp.title}</b> · {qcp.checkType} · namuna {qcp.sampleRate}% — {qcp.instructions}</div>}
      {readOnly?<div className="detail-grid cols-2"><div className="info-cell"><span>Natija</span><b><StatusBadge>{check.status}</StatusBadge></b></div><div className="info-cell"><span>O‘lchov</span><b>{check.measured||'—'}</b></div><div className="info-cell"><span>Inspector</span><b>{s.employees.find(e=>e.id===check.inspectorId)?.name||'—'}</b></div><div className="info-cell"><span>Sana</span><b>{check.date}</b></div>{check.reason&&<div className="info-cell span-all"><span>Izoh</span><b>{check.reason}</b></div>}{split&&split.inspection!=='pending'&&<div className="info-cell span-all"><span>Qabul taqsimoti</span><b>{num(split.accepted,3)} qabul · {num(split.rejected,3)} rad · {num(split.returned,3)} qaytarilgan · {num(split.scrapped,3)} scrap {unit}{open>0?` · qaror kutmoqda ${num(open,3)}`:''}</b></div>}</div>:<>
        <div className="field"><label>Natija</label><Segmented ariaLabel="Natija" items={check.sourceType==='subcontract'?['Passed','Scrap']:RESULTS} value={form.values.status} onChange={v=>form.set('status',v as QualityCheck['status'])}/></div>
        {splitting&&<Field label={`Qabul qilinadigan miqdor (${unit})`} error={form.error('accepted')} hint={`Qabul: ${num(receiptQty,3)} ${unit} · qolgani rad etiladi va karantinda qoladi (qaytarish yoki scrap)`}><Input type="number" min="0" step="any" max={receiptQty} value={form.values.accepted} onChange={e=>form.set('accepted',e.target.value)}/></Field>}
        <Field label="O‘lchov / kuzatuv"><Input value={form.values.measured} onChange={e=>form.set('measured',e.target.value)} placeholder="Masalan: 0.18 mm, vizual OK"/></Field>
        {order&&form.values.status==='Scrap'&&<Field label="Scrap miqdori" error={form.error('qty')} hint={`${order.code}: material sarflanadi, scrap hisobga olinadi · bo‘sh = faqat qaror`}><Input type="number" min="1" step="1" {...form.input('qty')}/></Field>}
        <Field label="Sabab / izoh" required={reasonNeeded} error={form.error('reason')}><Textarea {...form.input('reason')} placeholder={reasonNeeded?'Nuqson tavsifi, joyi va miqdori':'Ixtiyoriy izoh'}/></Field>
        {form.values.status!=='Passed'&&<div className="inline-note warning">Hold / Failed / Rework / Scrap material yoki MO release’ini bloklaydi.</div>}
      </>}
    </div>
  </Modal>
  {dispose&&<DisposeModal checkId={check.id} mode={dispose} open={open} unit={unit} onClose={()=>setDispose(null)} onDone={onClose}/>}
  </>
}

/** Rejected receipt units leave quarantine: back to the supplier or written off, all or part of what is undecided. */
function DisposeModal({checkId,mode,open,unit,onClose,onDone}:{checkId:string;mode:'return'|'scrap';open:number;unit:string;onClose:()=>void;onDone:()=>void}){
  const app=useApp()
  const form=useForm({qty:String(open),note:''},v=>({qty:!(Number(v.qty)>0)||Number(v.qty)>open?`0 dan katta, ${num(open,3)} dan oshmasin`:undefined,note:mode==='scrap'&&!v.note.trim()?'Sabab majburiy':undefined}))
  const save=()=>form.submit(v=>{const r=mode==='return'?app.returnPurchaseToSupplier(checkId,Number(v.qty),v.note.trim()):app.scrapRejectedReceipt(checkId,v.note.trim(),Number(v.qty));if(r.ok){onClose();onDone()}return r.ok})
  return <Modal open onClose={onClose} size="sm" title={mode==='return'?'Supplierga qaytarish':'Rad etilgan materialni scrap qilish'} subtitle={`Qaror kutayotgan rad etilgan qoldiq: ${num(open,3)} ${unit}`}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={save}>{mode==='return'?'Qaytarish':'Hisobdan chiqarish'}</button></>}>
    <div className="form-stack">
      <Field label={`Miqdor (${unit})`} error={form.error('qty')}><Input type="number" min="0" step="any" {...form.input('qty')}/></Field>
      <Field label={mode==='return'?'Izoh (yo‘llanma, RMA)':'Sabab'} required={mode==='scrap'} error={form.error('note')}><Textarea {...form.input('note')}/></Field>
      <p className="soft-meta">Karantindagi rad etilgan qism ombordan chiqariladi, harakat yoziladi; qabul qilingan qism va boshqa qabullarga tegilmaydi.</p>
    </div>
  </Modal>
}
