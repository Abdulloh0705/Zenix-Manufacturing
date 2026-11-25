// Shared pieces of the platform workspace. Platform pages receive only SaaS metadata and the platform store —
// never a tenant's ERP state.
import {createContext,useContext,useState} from 'react'
import type {ReactNode} from 'react'
import {Link} from 'react-router-dom'
import type * as SaaS from '../../domain/saas'
import * as Platform from '../../domain/platform'
import {Icon,Modal,StatusBadge,Textarea,Field} from '../../shared/ui'
import type {Tone} from '../../shared/ui'
import {paginate} from '../../shared/ui/tableSort'

export type OwnerInfo={username:string;email?:string;status:string}
export type PlatformCtx={
  actor:string;now:Date;busy:boolean
  saas:SaaS.SaaSStore;saasState:'ok'|'missing'|'damaged'
  platform:Platform.PlatformStore
  owners:Map<string,OwnerInfo>
  expiresAt:number
  run:(op:(snap:Platform.Snapshot)=>Platform.OpResult)=>Promise<boolean>
}
export const PlatformContext=createContext<PlatformCtx|null>(null)
export function usePlatform(){const ctx=useContext(PlatformContext);if(!ctx)throw new Error('Platform context missing');return ctx}

export const fmtDate=(v?:string)=>v?new Date(v).toLocaleDateString('uz-UZ',{year:'numeric',month:'2-digit',day:'2-digit'}):'—'
export const fmtTime=(v?:string)=>v?new Date(v).toLocaleString('uz-UZ',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'

export const SUB_STATUS:Record<Platform.EffectiveStatus,{label:string;tone:Tone}>={
  trial:{label:'Sinov',tone:'info'},active:{label:'Faol (demo)',tone:'success'},grace:{label:'Imtiyoz davri',tone:'warning'},
  expired:{label:'Muddati o‘tgan',tone:'danger'},suspended:{label:'Obuna to‘xtatilgan',tone:'danger'},none:{label:'Obuna yo‘q',tone:'neutral'},
}
export const TENANT_STATUS:Record<SaaS.Tenant['status'],{label:string;tone:Tone}>={active:{label:'Faol',tone:'success'},suspended:{label:'To‘xtatilgan',tone:'danger'}}
export const SubBadge=({status}:{status:Platform.EffectiveStatus})=><StatusBadge tone={SUB_STATUS[status].tone}>{SUB_STATUS[status].label}</StatusBadge>
export const TenantBadge=({status}:{status:SaaS.Tenant['status']})=><StatusBadge tone={TENANT_STATUS[status].tone}>{TENANT_STATUS[status].label}</StatusBadge>

export const MODULE_LABELS:Record<string,string>={dashboard:'Dashboard',users:'Foydalanuvchilar',roles:'Rollar',audit:'Audit',settings:'Sozlamalar',subscription:'Obuna',production:'Ishlab chiqarish',products:'Mahsulotlar',materials:'Materiallar',warehouse:'Ombor',purchases:'Xaridlar',sales:'Sotuv',quality:'Sifat nazorati',equipment:'Uskunalar',employees:'Xodimlar',costs:'Xarajatlar',reports:'Hisobotlar',ai:'AI yordamchi'}
export const ACTION_LABELS:Record<string,string>={'tenant.rename':'Kompaniya nomi o‘zgardi','tenant.suspend':'Kompaniya to‘xtatildi','tenant.reactivate':'Kompaniya faollashtirildi','tenant.register':'Kompaniya ro‘yxatdan o‘tdi','subscription.override':'Obuna override','subscription.override.demo':'Obuna override (eski)','subscription.change':'Egasi rejani tanladi (demo)','feature.disable':'Modul o‘chirildi','feature.restore':'Modul qaytarildi','settings.update':'Sozlamalar o‘zgardi','ticket.create':'Murojaat yaratildi','ticket.update':'Murojaat yangilandi','session.start':'Operator kirdi','session.end':'Operator chiqdi','session.expired':'Chipta muddati tugadi'}
export const actionLabel=(a:string)=>ACTION_LABELS[a]||a
export const unlimited=(n:number)=>n===Number.MAX_SAFE_INTEGER?'Cheklanmagan':String(n)

/** Backend-dependent capability: says plainly that live data does not exist in this frontend. */
export function Unavailable({title,text}:{title:string;text:ReactNode}){
  return <div className="pf-unavailable"><div><b>{title}</b><span>{text}</span></div><StatusBadge tone="neutral">Backend kerak</StatusBadge></div>
}

/** Confirmation with a mandatory reason. The action is not sent until the reason has 5+ characters. */
export function ReasonDialog({open,onClose,title,text,confirmText,danger,onConfirm,children}:{open:boolean;onClose:()=>void;title:string;text:ReactNode;confirmText:string;danger?:boolean;onConfirm:(reason:string)=>Promise<boolean>;children?:ReactNode}){
  const {busy}=usePlatform()
  const [reason,setReason]=useState('')
  const close=()=>{setReason('');onClose()}
  const problem=Platform.platformReasonProblem(reason)
  const ok=!problem
  return <Modal open={open} onClose={close} title={title} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={close}>Bekor qilish</button><button type="button" className={danger?'danger-glass-btn':'primary-glass-btn'} disabled={!ok||busy} onClick={async()=>{if(await onConfirm(reason))close()}}>{busy?'Saqlanmoqda…':confirmText}</button></>}>
    <div className="form-stack"><p>{text}</p>{children}<Field label="Sabab" required hint="Kamida 5 belgi. Auditga yoziladi; parol yoki kalit yozmang." error={reason?problem||undefined:undefined}><Textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></Field></div>
  </Modal>
}

export function Table({head,children,label}:{head:ReactNode[];children:ReactNode;label:string}){
  return <div className="table-scroll pf-table"><table aria-label={label}><thead><tr>{head.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
}

export const PAGE_SIZES=[10,25,50] as const
/** Client-side paging for platform tables. `resetKey` (filters, sort) sends the view back to page 1. */
export function usePaged<T>(rows:T[],resetKey:string,initialSize=10){
  const [page,setPage]=useState(1),[size,setSize]=useState(initialSize),[key,setKey]=useState(resetKey)
  if(key!==resetKey){setKey(resetKey);setPage(1)}
  const p=paginate(rows,page,size)
  return {...p,size,total:rows.length,setPage,setSize:(n:number)=>{setSize(n);setPage(1)}}
}
export type Paged<T>=ReturnType<typeof usePaged<T>>
export function Pager<T>({pg,label}:{pg:Paged<T>;label:string}){
  if(pg.total<=PAGE_SIZES[0])return null
  return <nav className="pagination pf-pager" aria-label={`${label} sahifalari`}>
    <span>{pg.from+1}–{Math.min(pg.from+pg.size,pg.total)} / {pg.total}</span>
    <div className="pagination-controls">
      <select className="ui-input pf-page-size" aria-label="Sahifadagi yozuvlar soni" value={pg.size} onChange={e=>pg.setSize(Number(e.target.value))}>{PAGE_SIZES.map(n=><option key={n} value={n}>{n} / sahifa</option>)}</select>
      <button type="button" className="icon-ghost" disabled={pg.page<=1} onClick={()=>pg.setPage(pg.page-1)} aria-label="Oldingi sahifa"><Icon name="chevron" style={{transform:'rotate(180deg)'}}/></button>
      <b aria-live="polite">{pg.page} / {pg.pages}</b>
      <button type="button" className="icon-ghost" disabled={pg.page>=pg.pages} onClick={()=>pg.setPage(pg.page+1)} aria-label="Keyingi sahifa"><Icon name="chevron"/></button>
    </div>
  </nav>
}

/** Renders stored free text with secret-looking values hidden (stored data is browser-editable). */
export const safe=(text?:string|null,fallback='—')=>Platform.safeText(text)||fallback

export const ALERT_TONE:Record<Platform.AlertSeverity,Tone>={danger:'danger',warning:'warning',info:'info'}
export const ALERT_LABEL:Record<Platform.AlertSeverity,string>={danger:'Muhim',warning:'Ogohlantirish',info:'Ma’lumot'}
export function AlertList({alerts}:{alerts:Platform.PlatformAlert[]}){
  return <ul className="pf-list pf-alerts">{alerts.map(a=><li key={a.id} data-severity={a.severity}>
    <span><b>{a.title}</b><small>{a.detail}</small></span>
    <div className="pf-alert-actions"><StatusBadge tone={ALERT_TONE[a.severity]}>{ALERT_LABEL[a.severity]}</StatusBadge><Link className="ghost-btn" to={a.link}>Ochish</Link></div>
  </li>)}</ul>
}
