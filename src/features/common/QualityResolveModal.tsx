import {useState} from 'react'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {Confirm,Field,Icon,Input,Modal,Segmented,StatusBadge,Textarea,useForm} from '../../shared/ui'
import type {QualityCheck} from '../../types'
import {sourceLabel} from '../../domain/actions'
import {materialName} from './lookups'

const RESULTS:QualityCheck['status'][]=['Passed','Hold','Failed','Rework','Scrap']

export function QualityResolveModal({checkId,onClose}:{checkId:string|null;onClose:()=>void}){
  const app=useApp()
  const check=app.state.qualityChecks.find(q=>q.id===checkId)
  if(!check)return null
  return <ResolveForm check={check} onClose={onClose}/>
}

function ResolveForm({check,onClose}:{check:QualityCheck;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [supplierReturn,setSupplierReturn]=useState(false)
  const qcp=s.qualityControlPoints.find(c=>c.id===check.controlPointId)
  const form=useForm({status:'Passed' as QualityCheck['status'],reason:'',measured:check.measured||''},v=>({reason:v.status!=='Passed'&&!v.reason.trim()?'Hold / Failed / Rework / Scrap uchun sabab majburiy':undefined}))
  const save=()=>form.submit(v=>{const r=app.resolveQuality(check.id,v.status,v.reason.trim(),v.measured.trim());if(r.ok)onClose();return r.ok})
  // Customer-return checks are decided by the return's disposition, never here (N-05).
  const viaReturn=check.sourceType==='return'
  const readOnly=check.status!=='Pending'||viaReturn
  const returned=check.returnedQty??(check.reason?.includes('Supplierga qaytarildi')?Infinity:0)
  const receiptQty=s.purchaseOrders.find(p=>p.id===check.sourceId)?.receipts.find(r=>r.id===check.receiptId)?.qty??0
  const supplierReturnAllowed=readOnly&&!viaReturn&&check.sourceType==='purchase'&&['Failed','Hold','Rework'].includes(check.status)&&returned<receiptQty&&(app.can('purchases','edit')||app.can('warehouse','edit'))
  return <>
  <Modal open onClose={onClose} title={readOnly?'Tekshiruv natijasi':'Tekshiruv natijasini kiritish'} eyebrow={`${check.type} inspection`} subtitle={`${sourceLabel(s,check.sourceId)} · ${materialName(s,check.itemId)}${check.lot?` · ${check.lot}`:''}`} size="md"
    footer={readOnly?<>{supplierReturnAllowed&&<button type="button" className="danger-glass-btn" onClick={()=>setSupplierReturn(true)}><Icon name="undo" size={15}/>Supplierga qaytarish</button>}<span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button></>:<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className={form.values.status==='Passed'?'primary-glass-btn':'danger-glass-btn'} disabled={!app.can('quality','edit')} title={app.can('quality','edit')?undefined:'Sifat natijasini kiritish uchun quality.edit ruxsati kerak'} onClick={save}>Natijani saqlash</button></>}>
    <div className="form-stack">
      {viaReturn&&check.status==='Pending'&&<div className="inline-note"><Icon name="info"/>Bu mijoz qaytarishi tekshiruvi — qaror Sotuv → Qaytarishlar bo‘limida qabul qilinadi.</div>}
      {qcp&&<div className="inline-note"><b>{qcp.title}</b> · {qcp.checkType} · namuna {qcp.sampleRate}% — {qcp.instructions}</div>}
      {readOnly?<div className="detail-grid cols-2"><div className="info-cell"><span>Natija</span><b><StatusBadge>{check.status}</StatusBadge></b></div><div className="info-cell"><span>O‘lchov</span><b>{check.measured||'—'}</b></div><div className="info-cell"><span>Inspector</span><b>{s.employees.find(e=>e.id===check.inspectorId)?.name||'—'}</b></div><div className="info-cell"><span>Sana</span><b>{check.date}</b></div>{check.reason&&<div className="info-cell span-all"><span>Izoh</span><b>{check.reason}</b></div>}</div>:<>
        <div className="field"><label>Natija</label><Segmented ariaLabel="Natija" items={check.sourceType==='subcontract'?['Passed','Scrap']:RESULTS} value={form.values.status} onChange={v=>form.set('status',v as QualityCheck['status'])}/></div>
        <Field label="O‘lchov / kuzatuv"><Input value={form.values.measured} onChange={e=>form.set('measured',e.target.value)} placeholder="Masalan: 0.18 mm, vizual OK"/></Field>
        <Field label="Sabab / izoh" required={form.values.status!=='Passed'} error={form.error('reason')}><Textarea {...form.input('reason')} placeholder={form.values.status==='Passed'?'Ixtiyoriy izoh':'Nuqson tavsifi, joyi va miqdori'}/></Field>
        {form.values.status!=='Passed'&&<div className="inline-note warning">Hold / Failed / Rework / Scrap material yoki MO release’ini bloklaydi.</div>}
      </>}
    </div>
  </Modal>
  <Confirm open={supplierReturn} onClose={()=>setSupplierReturn(false)} danger title="Material supplierga qaytarilsinmi?" text="QC hold qoldig‘i stockdan chiqariladi va Supplier Return movement yoziladi. Receipt tarixi o‘zgarmaydi." confirmText="Supplierga qaytarish" onConfirm={()=>{const r=app.returnPurchaseToSupplier(check.id);if(r.ok){setSupplierReturn(false);onClose()}return r.ok}}/>
  </>
}
