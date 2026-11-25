// Spare parts of a maintenance work: issued from free stock (FEFO lots), returned if unused; their value joins the
// maintenance cost once, at completion.
import {useState} from 'react'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Field,Icon,Input,Modal,Select,Textarea} from '../../../shared/ui'
import type {MaintenanceOrder,MaintenancePart,MaintenanceRequest} from '../../../types'
import {maintenancePartsCost} from '../../../domain/actions'
import {MAINTENANCE_PART_RULES,maintenancePartAssignmentBlocker} from '../../../domain/access'
import {money,num} from '../../../utils/format'
import {materialName,warehouseName} from '../../common/lookups'

const newKey=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`

export function SparePartsPanel({order}:{order:MaintenanceOrder}){
  const app=useApp(),s=app.state
  const [issue,setIssue]=useState(false),[back,setBack]=useState<MaintenancePart|null>(null)
  const open=order.status==='Rejada'||order.status==='Jarayonda'
  // The command checks assignment and scope again at submission, using the latest saved order.
  const assignment=maintenancePartAssignmentBlocker(s,app.currentEmployee,order.id)
  const can=MAINTENANCE_PART_RULES.some(([module,action])=>app.can(module,action))&&open
    &&!assignment
  const parts=order.parts||[]
  return <Card title="Ehtiyot qismlar" subtitle={`Ombordan beriladi · qiymati ${money(maintenancePartsCost(order))} (yakunlashda xarajatga bir marta qo‘shiladi)`} actions={can?<button type="button" className="secondary-glass-btn compact" onClick={()=>setIssue(true)}><Icon name="plus" size={14}/>Qism berish</button>:undefined}>
    {assignment&&open&&<div className="inline-note warning"><Icon name="lock"/>{assignment}</div>}
    {parts.length?<div className="stack-list">{parts.map(p=>{const unit=s.rawMaterials.find(m=>m.id===p.materialId)?.unit||'',left=p.qty-p.returned;return <div className="list-row" key={p.id}>
      <span className="list-row-copy"><b>{materialName(s,p.materialId)} · {num(left,3)} {unit}</b><small>{warehouseName(s,p.warehouseId)} · {p.at.slice(0,16)}{p.returned?` · qaytgan ${num(p.returned,3)}`:''}{p.lots.some(l=>l.lot)?` · ${p.lots.map(l=>l.lot||'LOT’siz').join(', ')}`:''} · {money(maintenancePartsCost({parts:[p]}))}</small></span>
      {can&&left>1e-9&&<button type="button" className="ghost-btn compact" onClick={()=>setBack(p)}>Qaytarish</button>}
    </div>})}</div>:<Empty compact icon="box" title="Ehtiyot qism berilmagan"/>}
    {issue&&<IssueModal order={order} onClose={()=>setIssue(false)}/>}
    {back&&<ReturnModal order={order} part={back} onClose={()=>setBack(null)}/>}
  </Card>
}

function IssueModal({order,onClose}:{order:MaintenanceOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [key]=useState(()=>newKey('mp'))
  const lines=s.stockBalances.filter(b=>b.itemType==='raw'&&!b.variantId&&b.onHand-b.reserved-(b.quarantine||0)>0)
  const [line,setLine]=useState(lines[0]?.id||''),[qty,setQty]=useState('')
  const b=s.stockBalances.find(x=>x.id===line)
  const free=b?b.onHand-b.reserved-(b.quarantine||0):0,v=Number(qty)
  const error=!qty?undefined:!(v>0)?'Musbat miqdor':v>free+1e-9?`Bo‘sh qoldiq ${num(free,3)}`:undefined
  return <Modal open onClose={onClose} title="Ehtiyot qism berish" eyebrow={order.code} subtitle="Faqat bo‘sh, yaroqli qoldiq (rezerv va karantin emas)" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!b||!qty||Boolean(error)} onClick={()=>{if(app.issueMaintenancePart(order.id,{materialId:b!.itemId,warehouseId:b!.warehouseId,qty:v,key}).ok)onClose()}}>Berish</button></>}>
    {lines.length?<div className="form-stack">
      <Field label="Qism va ombor" required><Select value={line} onChange={setLine}>{lines.map(x=><option key={x.id} value={x.id}>{materialName(s,x.itemId)} · {warehouseName(s,x.warehouseId)} · {num(x.onHand-x.reserved-(x.quarantine||0),1)} {x.unit}</option>)}</Select></Field>
      <Field label="Miqdor" required error={error}><Input type="number" min="0" step="any" aria-label="Qism miqdori" value={qty} onChange={e=>setQty(e.target.value)}/></Field>
    </div>:<div className="inline-note warning"><Icon name="warning"/>Bo‘sh xomashyo/qism qoldig‘i yo‘q.</div>}
  </Modal>
}

function ReturnModal({order,part,onClose}:{order:MaintenanceOrder;part:MaintenancePart;onClose:()=>void}){
  const app=useApp()
  const [key]=useState(()=>newKey('mpr'))
  const left=part.qty-part.returned
  const [qty,setQty]=useState(String(left))
  const v=Number(qty),ok=v>0&&v<=left+1e-9
  return <Modal open onClose={onClose} title="Qismni omborga qaytarish" eyebrow={order.code} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!ok} onClick={()=>{if(app.returnMaintenancePart(order.id,part.id,v,key).ok)onClose()}}>Qaytarish</button></>}>
    <Field label="Miqdor" required error={qty&&!ok?`0–${num(left,3)}`:undefined}><Input type="number" min="0" step="any" aria-label="Qaytarish miqdori" value={qty} onChange={e=>setQty(e.target.value)}/></Field>
  </Modal>
}

export function RejectRequestModal({request,onClose}:{request:MaintenanceRequest;onClose:()=>void}){
  const app=useApp()
  const [reason,setReason]=useState('')
  return <Modal open onClose={onClose} title="So‘rovni rad etish" eyebrow={request.code} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Ortga</button><button type="button" className="danger-glass-btn" disabled={reason.trim().length<5} onClick={()=>{if(app.rejectMaintenanceRequest(request.id,reason).ok)onClose()}}>Rad etish</button></>}>
    <Field label="Sabab" required hint="Kamida 5 belgi · so‘rov egasiga ko‘rinadi"><Textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field>
  </Modal>
}
