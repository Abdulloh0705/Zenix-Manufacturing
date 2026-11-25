// CAPA actions of an NCR: owner and deadline, evidence when done, independent verification before the NCR may close.
import {useState} from 'react'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Field,Icon,Input,Modal,Select,StatusBadge,Textarea} from '../../../shared/ui'
import type {Tone} from '../../../shared/ui'
import type {CapaAction,QualityAlert} from '../../../types'
import {capaCloseBlocker} from '../../../domain/actions'
import {addDays,todayISO} from '../../../utils/dates'
import {employeeName} from '../../common/lookups'

const TONE:Record<CapaAction['status'],Tone>={'Ochiq':'warning','Bajarildi':'info','Tasdiqlandi':'success','Bekor':'neutral'}
export const capaLate=(c:CapaAction,today=todayISO())=>(c.status==='Ochiq'||c.status==='Bajarildi')&&c.dueDate<today

export function CapaPanel({alert}:{alert:QualityAlert}){
  const app=useApp(),s=app.state
  const [add,setAdd]=useState(false),[step,setStep]=useState<{action:CapaAction;mode:'done'|'verify'|'cancel'}|null>(null)
  const closed=alert.status==='Yopilgan'
  const canEdit=app.can('quality','edit')&&!closed,canVerify=app.can('quality','approve')&&!closed
  const list=alert.capa||[]
  const blocker=capaCloseBlocker(alert)
  return <Card title="CAPA amallari" subtitle="Mas’ul va muddat → dalil bilan bajarildi → boshqa xodim tekshiradi" actions={canEdit?<button type="button" className="secondary-glass-btn compact" onClick={()=>setAdd(true)}><Icon name="plus" size={14}/>Amal qo‘shish</button>:undefined}>
    {list.length?<div className="stack-list">{list.map(c=>{const late=capaLate(c);return <div key={c.id} className="list-row capa-row">
      <span className="list-row-copy"><b>{c.kind}: {c.description}</b><small>{employeeName(s,c.ownerId)} · muddat {c.dueDate}{c.evidence?` · dalil: ${c.evidence}`:''}{c.verificationNote?` · tekshiruv: ${c.verificationNote}`:''}</small></span>
      <span className="badge-row">{late&&<StatusBadge tone="danger">Muddati o‘tgan</StatusBadge>}<StatusBadge tone={TONE[c.status]}>{c.status}</StatusBadge>
        {canEdit&&c.status==='Ochiq'&&<button type="button" className="ghost-btn compact" onClick={()=>setStep({action:c,mode:'done'})}>Bajarildi</button>}
        {canVerify&&c.status==='Bajarildi'&&<button type="button" className="ghost-btn compact" disabled={c.doneBy===app.currentEmployee?.id} title={c.doneBy===app.currentEmployee?.id?'O‘zingiz bajargan amalni boshqa xodim tekshiradi':undefined} onClick={()=>setStep({action:c,mode:'verify'})}>Tekshirish</button>}
        {canEdit&&(c.status==='Ochiq'||c.status==='Bajarildi')&&<button type="button" className="ghost-btn compact" onClick={()=>setStep({action:c,mode:'cancel'})}>Bekor</button>}
      </span></div>})}</div>
      :<Empty compact icon="shield" title="CAPA amali yo‘q" text="Tuzatuvchi va oldini oluvchi amallarni mas’ul va muddat bilan qo‘shing."/>}
    {!closed&&blocker&&<div className="inline-note warning" role="note"><Icon name="info"/>{blocker}</div>}
    {add&&<AddModal alert={alert} onClose={()=>setAdd(false)}/>}
    {step&&<StepModal alert={alert} action={step.action} mode={step.mode} onClose={()=>setStep(null)}/>}
  </Card>
}

function AddModal({alert,onClose}:{alert:QualityAlert;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [kind,setKind]=useState<CapaAction['kind']>('Tuzatuvchi'),[description,setDescription]=useState(''),[ownerId,setOwnerId]=useState(alert.ownerId),[dueDate,setDueDate]=useState(addDays(todayISO(),7))
  const valid=description.trim().length>=5&&Boolean(ownerId)&&dueDate>=todayISO()
  return <Modal open onClose={onClose} title="CAPA amali" eyebrow={alert.title} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!valid} onClick={()=>{if(app.addCapaAction(alert.id,{kind,description,ownerId,dueDate}).ok)onClose()}}>Qo‘shish</button></>}>
    <div className="form-stack">
      <Field label="Turi"><Select value={kind} onChange={v=>setKind(v as CapaAction['kind'])}><option value="Tuzatuvchi">Tuzatuvchi (corrective)</option><option value="Oldini oluvchi">Oldini oluvchi (preventive)</option></Select></Field>
      <Field label="Amal" required hint="Kamida 5 belgi"><Textarea value={description} onChange={e=>setDescription(e.target.value)}/></Field>
      <Field label="Mas’ul" required><Select value={ownerId} onChange={setOwnerId}>{s.employees.filter(e=>e.status!=='Arxiv').map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Muddat" required error={dueDate<todayISO()?'O‘tgan sana':undefined}><Input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></Field>
    </div>
  </Modal>
}

function StepModal({alert,action,mode,onClose}:{alert:QualityAlert;action:CapaAction;mode:'done'|'verify'|'cancel';onClose:()=>void}){
  const app=useApp()
  const [text,setText]=useState(''),[effective,setEffective]=useState('yes')
  const valid=text.trim().length>=5
  const run=()=>{const r=mode==='done'?app.completeCapaAction(alert.id,action.id,text):mode==='verify'?app.verifyCapaAction(alert.id,action.id,effective==='yes',text):app.cancelCapaAction(alert.id,action.id,text);if(r.ok)onClose()}
  return <Modal open onClose={onClose} title={mode==='done'?'Amal bajarildi':mode==='verify'?'Samaradorlikni tekshirish':'Amalni bekor qilish'} eyebrow={action.description} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Ortga</button><button type="button" className={mode==='cancel'?'danger-glass-btn':'primary-glass-btn'} disabled={!valid} onClick={run}>{mode==='done'?'Bajarildi':mode==='verify'?'Saqlash':'Bekor qilish'}</button></>}>
    <div className="form-stack">
      {mode==='verify'&&<Field label="Natija"><Select value={effective} onChange={setEffective}><option value="yes">Samarali — tasdiqlash</option><option value="no">Samarasiz — qayta ochish</option></Select></Field>}
      <Field label={mode==='done'?'Dalil (hujjat, akt, o‘lchov)':mode==='verify'?'Tekshiruv natijasi':'Sabab'} required hint="Kamida 5 belgi · tarixga yoziladi"><Textarea value={text} onChange={e=>setText(e.target.value)}/></Field>
    </div>
  </Modal>
}
