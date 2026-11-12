// Security & Audit, Support Center, Feature Management, Platform Settings and System Health.
import {useEffect,useMemo,useState} from 'react'
import * as SaaS from '../../../domain/saas'
import * as Platform from '../../../domain/platform'
import {storage} from '../../../shared/lib/storage'
import {Card,Confirm,Drawer,Empty,Field,InfoGrid,Input,Modal,SearchBox,StatusBadge,Textarea,Timeline} from '../../../shared/ui'
import type {Tone} from '../../../shared/ui'
import {MODULE_LABELS,ReasonDialog,Table,Unavailable,actionLabel,fmtTime,usePlatform} from '../platformShared'

declare const __ZENIX_VERSION__:string|undefined
const tenantName=(saas:SaaS.SaaSStore,id?:string|null)=>id?saas.tenants.find(t=>t.id===id)?.name||id:'—'

// ---------------------------------------------------------------- security & audit
const OUTCOME_TONE:Record<Platform.AuditOutcome,Tone>={success:'success',denied:'danger',failed:'warning'}
export function SecuritySection(){
  const {saas,platform,actor,expiresAt,now}=usePlatform()
  const [query,setQuery]=useState(''),[type,setType]=useState('all'),[outcome,setOutcome]=useState('all'),[limit,setLimit]=useState(50)
  const trail=useMemo(()=>Platform.auditTrail(saas,platform),[saas,platform])
  const rows=trail.filter(a=>(type==='all'||a.targetType===type)&&(outcome==='all'||a.outcome===outcome)&&(!query.trim()||[a.actor,a.action,actionLabel(a.action),a.targetId,a.reason,a.detail,tenantName(saas,a.tenantId)].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
  return <div className="page-stack">
    <div className="pf-grid-2">
      <Card title="Joriy platforma sessiyasi">
        <InfoGrid columns={2} items={[{label:'Operator',value:actor},{label:'Chipta tugashi',value:fmtTime(new Date(expiresAt).toISOString())},{label:'Qolgan vaqt',value:`${Math.max(0,Math.floor((expiresAt-now.getTime())/60000))} daqiqa`},{label:'Saqlash joyi',value:'sessionStorage (shu tab)'}]}/>
      </Card>
      <Card title="Kirish nazorati">
        <ul className="pf-rules">
          <li>Har bir yozish amali oldidan chipta imzosi va muddati qayta tekshiriladi.</li>
          <li>Chipta tugaganda platforma ma’lumotlari darhol yashiriladi.</li>
          <li>Kompaniya roli (Biznes egasi, menejer, xodim) platforma huquqini olmaydi; platforma sessiyasi kompaniya sessiyasini bermaydi.</li>
          <li>Muhim amallar sabab va tasdiqlashni talab qiladi.</li>
        </ul>
      </Card>
    </div>
    <p className="inline-note warning" role="note">Bu audit tarixi brauzer xotirasida saqlanadi va brauzer egasi tomonidan o‘zgartirilishi mumkin. U yuridik dalil yoki ishonchli audit hisoblanmaydi. Parollar, hashlar, tiklash chiptalari va maxfiy kalitlar hech qachon yozilmaydi.</p>
    <Card title="Platforma audit jurnali" subtitle="Kompaniyalarning ichki operatsion auditi bu yerda ko‘rsatilmaydi">
      <div className="pf-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Operator, amal, kompaniya, sabab" ariaLabel="Auditni qidirish"/>
        <select className="ui-input" aria-label="Obyekt turi" value={type} onChange={e=>setType(e.target.value)}><option value="all">Barcha obyektlar</option><option value="tenant">Kompaniya</option><option value="subscription">Obuna</option><option value="feature">Funksiya</option><option value="settings">Sozlamalar</option><option value="ticket">Support</option><option value="session">Sessiya</option></select>
        <select className="ui-input" aria-label="Natija" value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="all">Barcha natijalar</option><option value="success">Muvaffaqiyatli</option><option value="denied">Rad etilgan</option><option value="failed">Xato</option></select>
      </div>
      <p className="pf-muted" role="status">{rows.length} ta yozuv</p>
      {rows.length?<><Table label="Platforma audit jurnali" head={['Vaqt','Operator','Amal','Obyekt','Kompaniya','Sabab','Natija']}>
        {rows.slice(0,limit).map(a=><tr key={a.id}><td>{fmtTime(a.at)}</td><td>{a.actor}</td><td>{actionLabel(a.action)}{a.detail&&<small className="pf-muted pf-block">{a.detail}</small>}</td><td>{a.targetType}</td><td>{tenantName(saas,a.tenantId)}</td><td>{a.reason||'—'}</td><td><StatusBadge tone={OUTCOME_TONE[a.outcome]}>{a.outcome}</StatusBadge></td></tr>)}
      </Table>{rows.length>limit&&<button type="button" className="ghost-btn" onClick={()=>setLimit(l=>l+50)}>Yana 50 ta</button>}</>:<Empty compact icon="shield" title={trail.length?'Mos yozuv yo‘q':'Audit hali bo‘sh'}/>}
    </Card>
    <Card title="Backend talablari">
      <div className="stack-list">
        <Unavailable title="O‘zgarmas (append-only) audit ombori" text="Server vaqt belgisi, ishonchli operator identifikatori, korrelyatsiya ID va xesh zanjiri."/>
        <Unavailable title="Qurilmalararo sessiyani bekor qilish" text="Server sessiyalari va HttpOnly cookie."/>
        <Unavailable title="IP / qurilma metama’lumoti va xavfsizlik ogohlantirishlari" text="Server so‘rov jurnali va ruxsat etilgan saqlash siyosati."/>
      </div>
    </Card>
  </div>
}

// ---------------------------------------------------------------- support center
const STATUS_LABEL:Record<Platform.TicketStatus,string>={open:'Ochiq',in_progress:'Jarayonda',waiting:'Javob kutilmoqda',resolved:'Hal qilindi',closed:'Yopilgan'}
const STATUS_TONE:Record<Platform.TicketStatus,Tone>={open:'info',in_progress:'warning',waiting:'neutral',resolved:'success',closed:'neutral'}
const PRIORITY_LABEL:Record<Platform.TicketPriority,string>={low:'Past',normal:'Oddiy',high:'Yuqori',urgent:'Shoshilinch'}
const CATEGORY_LABEL:Record<Platform.TicketCategory,string>={account:'Akkaunt',subscription:'Obuna',billing:'Billing',technical:'Texnik',data:'Ma’lumot',other:'Boshqa'}
export function SupportSection(){
  const {saas,platform,busy}=usePlatform()
  const [status,setStatus]=useState('active'),[priority,setPriority]=useState('all'),[query,setQuery]=useState('')
  const [creating,setCreating]=useState(false),[openId,setOpenId]=useState('')
  const rows=platform.tickets.filter(t=>(status==='all'||(status==='active'?!['resolved','closed'].includes(t.status):t.status===status))&&(priority==='all'||t.priority===priority)&&(!query.trim()||`#${t.number} ${t.subject} ${tenantName(saas,t.tenantId)}`.toLowerCase().includes(query.trim().toLowerCase())))
  return <div className="page-stack">
    <p className="inline-note" role="note">Demo support jurnali: murojaatlar operator tomonidan qo‘lda kiritiladi. E-pochta, chat yoki telefon integratsiyasi yo‘q. Kompaniyaning ERP yozuvlari ko‘rsatilmaydi va akkauntga “impersonation” qilinmaydi.</p>
    <Card actions={<button type="button" className="primary-glass-btn" disabled={busy} onClick={()=>setCreating(true)}>Yangi murojaat</button>} title="Murojaatlar">
      <div className="pf-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Raqam, mavzu yoki kompaniya" ariaLabel="Murojaatni qidirish"/>
        <select className="ui-input" aria-label="Murojaat holati" value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Ochiq (hal qilinmagan)</option><option value="all">Barchasi</option>{Platform.TICKET_STATUSES.map(s=><option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <select className="ui-input" aria-label="Ustuvorlik" value={priority} onChange={e=>setPriority(e.target.value)}><option value="all">Barcha ustuvorliklar</option>{Platform.TICKET_PRIORITIES.map(p=><option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
      </div>
      {rows.length?<Table label="Murojaatlar" head={['#','Mavzu','Kompaniya','Toifa','Ustuvorlik','Holat','Mas’ul','Yangilangan']}>
        {rows.map(t=><tr key={t.id}><td>{t.number}</td><td><button type="button" className="pf-link" onClick={()=>setOpenId(t.id)}><b>{t.subject}</b></button></td><td>{tenantName(saas,t.tenantId)}</td><td>{CATEGORY_LABEL[t.category]}</td><td><StatusBadge tone={t.priority==='urgent'?'danger':t.priority==='high'?'warning':'neutral'}>{PRIORITY_LABEL[t.priority]}</StatusBadge></td><td><StatusBadge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusBadge></td><td>{t.assignee}</td><td>{fmtTime(t.updatedAt)}</td></tr>)}
      </Table>:<Empty icon="bell" title={platform.tickets.length?'Mos murojaat yo‘q':'Murojaat hali yo‘q'} text={platform.tickets.length?'Filtrlarni o‘zgartiring.':'Kompaniyadan kelgan so‘rovni qo‘lda ro‘yxatga olish uchun “Yangi murojaat” tugmasini bosing.'}/>}
    </Card>
    <Card title="Backend talablari"><div className="stack-list">
      <Unavailable title="Kiruvchi kanal (e-pochta / chat)" text="Xabarni murojaatga bog‘laydigan server integratsiyasi kerak (SupportChannelContract)."/>
      <Unavailable title="Nazoratli support kirishi" text="Kompaniya roziligi, maqsad, muddat va o‘zgarmas audit bilan; cheklanmagan impersonation yo‘q."/>
    </div></Card>
    {creating&&<TicketCreate onClose={()=>setCreating(false)}/>}
    {openId&&<TicketDrawer id={openId} onClose={()=>setOpenId('')}/>}
  </div>
}

function TicketCreate({onClose}:{onClose:()=>void}){
  const {saas,actor,run,busy}=usePlatform()
  const [form,setForm]=useState<Platform.TicketInput>({tenantId:null,subject:'',category:'account',priority:'normal',assignee:actor,note:''})
  const [error,setError]=useState('')
  const set=<K extends keyof Platform.TicketInput>(k:K,v:Platform.TicketInput[K])=>setForm(f=>({...f,[k]:v}))
  const submit=async()=>{
    const subject=Platform.ticketTextProblem(form.subject,5,120);if(subject){setError(`Mavzu: ${subject}`);return}
    setError('')
    if(await run(snap=>Platform.opTicketCreate(snap,actor,form,new Date())))onClose()
  }
  return <Modal open onClose={onClose} title="Yangi support murojaati" size="md" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={busy} onClick={()=>void submit()}>Yaratish</button></>}>
    <div className="form-stack">
      <Field label="Kompaniya"><select className="ui-input" value={form.tenantId||''} onChange={e=>set('tenantId',e.target.value||null)}><option value="">Kompaniyaga bog‘lanmagan</option>{saas.tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Mavzu" required error={error||undefined}><Input value={form.subject} maxLength={120} onChange={e=>set('subject',e.target.value)}/></Field>
      <div className="pf-grid-2">
        <Field label="Toifa"><select className="ui-input" value={form.category} onChange={e=>set('category',e.target.value as Platform.TicketCategory)}>{Platform.TICKET_CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
        <Field label="Ustuvorlik"><select className="ui-input" value={form.priority} onChange={e=>set('priority',e.target.value as Platform.TicketPriority)}>{Platform.TICKET_PRIORITIES.map(p=><option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
      </div>
      <Field label="Mas’ul operator ID"><Input value={form.assignee} onChange={e=>set('assignee',e.target.value)}/></Field>
      <Field label="Izoh" hint="Parol, chipta yoki kalitni yozmang"><Textarea value={form.note} maxLength={2000} onChange={e=>set('note',e.target.value)}/></Field>
    </div>
  </Modal>
}

function TicketDrawer({id,onClose}:{id:string;onClose:()=>void}){
  const {saas,platform,actor,run,busy}=usePlatform()
  const t=platform.tickets.find(x=>x.id===id)
  const [status,setStatus]=useState<Platform.TicketStatus|''>(''),[assignee,setAssignee]=useState(t?.assignee||''),[note,setNote]=useState('')
  if(!t)return null
  const next=Platform.TICKET_STATUSES.filter(s=>Platform.canTransition(t.status,s))
  const save=async()=>{if(await run(snap=>Platform.opTicketUpdate(snap,actor,id,{status:status||undefined,assignee,note},new Date()))){setStatus('');setNote('')}}
  return <Drawer open onClose={onClose} title={`#${t.number} · ${t.subject}`} eyebrow="Support murojaati" icon="bell" size="md" actions={t.status!=='closed'?<button type="button" className="primary-glass-btn" disabled={busy} onClick={()=>void save()}>Saqlash</button>:undefined}>
    <div className="page-stack">
      <InfoGrid columns={2} items={[{label:'Kompaniya',value:tenantName(saas,t.tenantId)},{label:'Holat',value:<StatusBadge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusBadge>},{label:'Toifa',value:CATEGORY_LABEL[t.category]},{label:'Ustuvorlik',value:PRIORITY_LABEL[t.priority]},{label:'Mas’ul',value:t.assignee},{label:'Yaratgan',value:`${t.createdBy} · ${fmtTime(t.createdAt)}`}]}/>
      {t.status==='closed'?<p className="inline-note">Yopilgan murojaat o‘zgartirilmaydi. Kerak bo‘lsa yangi murojaat oching.</p>:<div className="form-stack">
        <Field label="Holatni o‘zgartirish"><select className="ui-input" value={status} onChange={e=>setStatus(e.target.value as Platform.TicketStatus)}><option value="">O‘zgarmasin</option>{next.map(s=><option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
        <Field label="Mas’ul operator ID"><Input value={assignee} onChange={e=>setAssignee(e.target.value)}/></Field>
        <Field label="Izoh qo‘shish" hint="Parol, chipta yoki kalitni yozmang"><Textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></Field>
      </div>}
      <Card title="Hal qilish tarixi"><Timeline items={[...t.notes].reverse().map(n=>({title:n.kind==='note'?n.text:n.kind==='status'?`Holat: ${n.text}`:n.kind==='assign'?`Mas’ul: ${n.text}`:n.text,meta:n.actor,time:fmtTime(n.at),tone:n.kind==='status'?'warning':'info'}))}/></Card>
    </div>
  </Drawer>
}

// ---------------------------------------------------------------- feature management
const ALL_MODULES=[...SaaS.CORE_MODULES,...SaaS.RESTRICTABLE_MODULES]
export function FeaturesSection(){
  const {saas,platform,actor,run,busy}=usePlatform()
  const [tenantId,setTenantId]=useState(saas.tenants[0]?.id||'')
  const [pending,setPending]=useState<{module:string;enable:boolean}|null>(null)
  const plan=tenantId?SaaS.subscriptionFor(saas,tenantId)?.planId:undefined
  const disabled=tenantId?SaaS.disabledModules(saas,tenantId):new Set<string>()
  const history=Platform.auditTrail(saas,platform).filter(a=>a.targetType==='feature'&&(!tenantId||a.tenantId===tenantId))
  return <div className="page-stack">
    <Card title="Uch bosqichli ruxsat" subtitle="Kompaniya ichidagi muhim amal uchun uchalasi ham bajarilishi shart">
      <div className="pf-layers">
        <div><b>1. Obuna huquqi</b><span>Reja moduli va obuna holati (domain/saas.ts katalogi).</span></div>
        <div><b>2. Funksiya mavjudligi</b><span>Platforma modulni ushbu kompaniya uchun faqat o‘chira oladi; reja bermagan modulni yoqa olmaydi.</span></div>
        <div><b>3. Foydalanuvchi ruxsati (RBAC)</b><span>Kompaniya roli. Funksiya sozlamasi hech qachon rol ruxsatini bermaydi yoki ishlab chiqarish huquqini qo‘shmaydi.</span></div>
      </div>
    </Card>
    <Card title="Rejalar bo‘yicha modullar">
      <Table label="Reja modullari matritsasi" head={['Modul',...Object.values(SaaS.PLAN_CATALOG).map(p=>p.name)]}>
        {ALL_MODULES.map(m=><tr key={m}><td>{MODULE_LABELS[m]||m}{SaaS.CORE_MODULES.includes(m)&&<small className="pf-muted"> · asosiy</small>}</td>{Object.values(SaaS.PLAN_CATALOG).map(p=><td key={p.id}>{SaaS.CORE_MODULES.includes(m)||p.modules.includes(m)?<span aria-label="Mavjud">✓</span>:<span className="pf-muted" aria-label="Mavjud emas">—</span>}</td>)}</tr>)}
      </Table>
    </Card>
    <Card title="Kompaniya bo‘yicha funksiyalar">
      {!saas.tenants.length?<Empty compact icon="factory" title="Kompaniya yo‘q"/>:<>
        <div className="pf-toolbar"><select className="ui-input" aria-label="Kompaniya tanlash" value={tenantId} onChange={e=>setTenantId(e.target.value)}>{saas.tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><span className="pf-muted">Reja: {plan?SaaS.PLAN_CATALOG[plan].name:'obuna yo‘q'}</span></div>
        <Table label="Kompaniya funksiyalari" head={['Modul','Rejada','Holat','Amal']}>
          {ALL_MODULES.map(m=>{const core=SaaS.CORE_MODULES.includes(m),inPlan=core||!!plan&&SaaS.PLAN_CATALOG[plan].modules.includes(m),off=disabled.has(m)
            return <tr key={m}><td>{MODULE_LABELS[m]||m}</td><td>{inPlan?'Ha':'Yo‘q'}</td>
              <td>{core?<StatusBadge tone="info">Asosiy</StatusBadge>:off?<StatusBadge tone="danger">Platforma o‘chirgan</StatusBadge>:inPlan?<StatusBadge tone="success">Yoqilgan</StatusBadge>:<StatusBadge tone="neutral">Rejada yo‘q</StatusBadge>}</td>
              <td>{core?<span className="pf-muted">O‘chirib bo‘lmaydi</span>:off?<button type="button" className="secondary-glass-btn" disabled={busy} onClick={()=>setPending({module:m,enable:true})}>Reja holatiga qaytarish</button>:inPlan?<button type="button" className="ghost-btn" disabled={busy} onClick={()=>setPending({module:m,enable:false})}>O‘chirish</button>:<span className="pf-muted">Reja o‘zgarishi kerak</span>}</td></tr>})}
        </Table>
      </>}
    </Card>
    <Card title="Funksiya o‘zgarishlari tarixi"><Timeline items={history.map(a=>({title:`${actionLabel(a.action)} · ${MODULE_LABELS[a.targetId]||a.targetId}`,meta:`${tenantName(saas,a.tenantId)} · ${a.actor} · ${a.reason||''}`,time:fmtTime(a.at),tone:a.action==='feature.disable'?'warning':'info'}))}/></Card>
    <ReasonDialog open={!!pending} onClose={()=>setPending(null)} danger={pending?.enable===false} title={pending?.enable?'Modulni qaytarish':'Modulni o‘chirish'} confirmText={pending?.enable?'Qaytarish':'O‘chirish'}
      text={pending?`${MODULE_LABELS[pending.module]||pending.module}: ${pending.enable?'reja bo‘yicha qayta mavjud bo‘ladi (rol ruxsati alohida tekshiriladi).':'bu kompaniya uchun yopiladi. Ma’lumotlar o‘chirilmaydi.'}`:''}
      onConfirm={reason=>pending?run(snap=>Platform.opFeature(snap,actor,tenantId,pending.module,pending.enable,reason,new Date())):Promise.resolve(false)}/>
  </div>
}

// ---------------------------------------------------------------- platform settings
const SETTING_LABELS:Record<keyof Platform.PlatformSettings,string>={brandName:'Platforma nomi',supportEmail:'Support e-pochtasi',supportPhone:'Support telefoni',defaultTrialDays:'Sinov muddati (kun)',graceDays:'Imtiyoz davri (kun)',registration:'Yangi kompaniya ro‘yxati'}
export function SettingsSection(){
  const {platform,actor,run,busy}=usePlatform()
  const [form,setForm]=useState(()=>({...platform.settings,defaultTrialDays:String(platform.settings.defaultTrialDays),graceDays:String(platform.settings.graceDays)}))
  const [reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),[touched,setTouched]=useState(false)
  const parsed:Platform.PlatformSettings={...form,defaultTrialDays:form.defaultTrialDays.trim()===''?NaN:Number(form.defaultTrialDays),graceDays:form.graceDays.trim()===''?NaN:Number(form.graceDays)}
  const errors=Platform.validateSettings(parsed)
  const diff=Platform.settingsDiff(platform.settings,{...parsed,brandName:parsed.brandName.trim(),supportEmail:parsed.supportEmail.trim(),supportPhone:parsed.supportPhone.trim()})
  const sensitive=diff.some(d=>Platform.SENSITIVE_SETTINGS.includes(d.key))
  const valid=!Object.keys(errors).length&&diff.length>0&&(!sensitive||reason.trim().length>=5)
  const err=(k:keyof Platform.PlatformSettings)=>touched?errors[k]:undefined
  const set=(k:keyof typeof form,v:string)=>{setTouched(true);setForm(f=>({...f,[k]:v}))}
  const reset=()=>{setForm({...platform.settings,defaultTrialDays:String(platform.settings.defaultTrialDays),graceDays:String(platform.settings.graceDays)});setReason('');setTouched(false)}
  return <div className="page-stack">
    <Card title="Platforma sozlamalari" subtitle="Faqat kelajakdagi ro‘yxatdan o‘tish va override amallariga ta’sir qiladi; mavjud obunalar o‘zgarmaydi">
      <form className="form-stack" noValidate onSubmit={e=>{e.preventDefault();setTouched(true);if(valid)setConfirm(true)}}>
        <div className="pf-grid-2">
          <Field label={SETTING_LABELS.brandName} required error={err('brandName')}><Input value={form.brandName} maxLength={40} onChange={e=>set('brandName',e.target.value)}/></Field>
          <Field label={SETTING_LABELS.registration} hint="Yopilsa, yangi kompaniya /register orqali yaratilmaydi"><select className="ui-input" value={form.registration} onChange={e=>set('registration',e.target.value)}><option value="open">Ochiq</option><option value="closed">Yopiq</option></select></Field>
          <Field label={SETTING_LABELS.supportEmail} error={err('supportEmail')}><Input type="email" value={form.supportEmail} onChange={e=>set('supportEmail',e.target.value)}/></Field>
          <Field label={SETTING_LABELS.supportPhone} error={err('supportPhone')}><Input value={form.supportPhone} onChange={e=>set('supportPhone',e.target.value)}/></Field>
          <Field label={SETTING_LABELS.defaultTrialDays} required error={err('defaultTrialDays')} hint="1–60 kun, yangi kompaniyalar uchun"><Input inputMode="numeric" value={form.defaultTrialDays} onChange={e=>set('defaultTrialDays',e.target.value)}/></Field>
          <Field label={SETTING_LABELS.graceDays} required error={err('graceDays')} hint="1–30 kun, imtiyoz override uchun"><Input inputMode="numeric" value={form.graceDays} onChange={e=>set('graceDays',e.target.value)}/></Field>
        </div>
        {sensitive&&<Field label="O‘zgarish sababi" required hint="Muhim sozlama o‘zgaryapti — kamida 5 belgi"><Textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></Field>}
        <div className="row-actions"><button type="submit" className="primary-glass-btn" disabled={busy||!diff.length}>Saqlash</button><button type="button" className="ghost-btn" disabled={!diff.length} onClick={reset}>Bekor qilish</button>{!diff.length&&<span className="pf-muted">O‘zgarish yo‘q</span>}</div>
      </form>
    </Card>
    <Card title="Faqat backendda sozlanadigan parametrlar"><div className="stack-list">
      <Unavailable title="SMTP / SMS provayderlari" text="Maxfiy kalitlar brauzerda saqlanmaydi."/>
      <Unavailable title="To‘lov provayderi va soliq" text="Server konfiguratsiyasi va webhook kalitlari."/>
      <Unavailable title="Ma’lumotlar bazasi, SSO va sessiya siyosati" text="Infratuzilma darajasidagi sozlamalar."/>
    </div></Card>
    <Confirm open={confirm} onClose={()=>setConfirm(false)} title="Sozlamalarni saqlash" confirmText="Saqlash" text={<>Quyidagi o‘zgarishlar auditga yoziladi:</>}
      onConfirm={()=>void run(snap=>Platform.opSettings(snap,actor,parsed,reason,new Date())).then(ok=>{if(ok){setReason('');setTouched(false)}})}>
      <ul className="pf-rules">{diff.map(d=><li key={d.key}><b>{SETTING_LABELS[d.key]}</b>: {String(d.from||'—')} → {String(d.to||'—')}</li>)}</ul>
    </Confirm>
  </div>
}

// ---------------------------------------------------------------- system health
type Check={label:string;ok:boolean|null;detail:string}
function probe(store:Storage|undefined){try{if(!store)return false;const k='zenix-platform-probe';store.setItem(k,'1');const ok=store.getItem(k)==='1';store.removeItem(k);return ok}catch{return false}}
export function HealthSection(){
  const {saasState}=usePlatform()
  const [checks,setChecks]=useState<Check[]>([]),[estimate,setEstimate]=useState<string>('Tekshirilmoqda…'),[checkedAt,setCheckedAt]=useState('')
  const runChecks=()=>{
    const platformRaw=storage.getRaw(Platform.PLATFORM_KEY)
    const env=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env
    setChecks([
      {label:'localStorage (yozish/o‘qish)',ok:probe(globalThis.localStorage),detail:'Demo ma’lumotlari shu yerda'},
      {label:'sessionStorage',ok:probe(globalThis.sessionStorage),detail:'Platforma sessiyasi shu yerda'},
      {label:'Web Crypto (imzo tekshiruvi)',ok:Boolean(globalThis.crypto?.subtle),detail:'ECDSA P-256 chipta tekshiruvi uchun'},
      {label:'IndexedDB',ok:typeof indexedDB!=='undefined',detail:'Brauzer imkoniyati (ilova hozircha ishlatmaydi)'},
      {label:'Brauzer tarmoq holati',ok:typeof navigator!=='undefined'?navigator.onLine:null,detail:'Faqat brauzer ulanishi; server holati emas'},
      {label:'Kompaniya metama’lumoti',ok:saasState==='damaged'?false:true,detail:saasState==='missing'?'Hali yaratilmagan':saasState==='ok'?'Tuzilma tekshiruvidan o‘tdi':'Shikastlangan — o‘zgartirish to‘xtatilgan'},
      {label:'Platforma yozuvi',ok:Platform.normalizePlatformStore(storage.get(Platform.PLATFORM_KEY,null))!==null,detail:platformRaw?`${platformRaw.length.toLocaleString('uz-UZ')} belgi`:'Hali yaratilmagan (standart sozlamalar)'},
      {label:'Platforma ochiq kaliti',ok:Boolean(env?.VITE_PLATFORM_PUBLIC_KEY),detail:'VITE_PLATFORM_PUBLIC_KEY build sozlamasi'},
    ])
    setCheckedAt(new Date().toISOString())
    const usage=storage.usage(Platform.PLATFORM_KEY)
    if(navigator.storage?.estimate)void navigator.storage.estimate().then(e=>setEstimate(`${fmtBytes(e.usage)} / ${fmtBytes(e.quota)} (brauzer bahosi)`)).catch(()=>setEstimate(`${fmtBytes(usage.total*2)} localStorage (taxminiy)`))
    else setEstimate(`${fmtBytes(usage.total*2)} localStorage (taxminiy)`)
  }
  // Checks run once on open; the button re-runs them. eslint: runChecks only reads browser APIs and current props.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(runChecks,[])
  const env=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env
  const version=typeof __ZENIX_VERSION__==='string'?__ZENIX_VERSION__:'—'
  return <div className="page-stack">
    <div className="pf-grid-2">
      <Card title="Ilova ma’lumoti">
        <InfoGrid columns={2} items={[{label:'Versiya',value:version},{label:'Build rejimi',value:env?.MODE||'—'},{label:'Brauzer xotirasi',value:estimate},{label:'Oxirgi tekshiruv',value:fmtTime(checkedAt||undefined)}]}/>
      </Card>
      <Card title="Backend integratsiyalari" subtitle="Hozircha birortasi ulanmagan">
        <ul className="pf-list">{['API server (autentifikatsiya, RBAC)','PostgreSQL (tenant izolyatsiyasi)','To‘lov provayderi','E-pochta / SMS','Monitoring va alerting','O‘zgarmas audit ombori'].map(s=><li key={s}><span>{s}</span><StatusBadge tone="neutral">Ulanmagan</StatusBadge></li>)}</ul>
      </Card>
    </div>
    <Card title="Brauzer diagnostikasi" actions={<button type="button" className="secondary-glass-btn" onClick={runChecks}>Qayta tekshirish</button>}>
      <ul className="pf-list">{checks.map(c=><li key={c.label}><span><b>{c.label}</b><small>{c.detail}</small></span><StatusBadge tone={c.ok===null?'neutral':c.ok?'success':'danger'}>{c.ok===null?'Noma’lum':c.ok?'Ishlaydi':'Muammo'}</StatusBadge></li>)}</ul>
    </Card>
    <Card title="Server ko‘rsatkichlari" subtitle="Frontend bu qiymatlarni o‘lchay olmaydi — ular ataylab ko‘rsatilmaydi"><div className="stack-list">
      <Unavailable title="CPU, xotira, worker holati" text="SystemHealthContract: server monitoring agenti kerak."/>
      <Unavailable title="Ma’lumotlar bazasi holati va replikatsiya" text="PostgreSQL monitoring kerak."/>
      <Unavailable title="API kechikishi, xatolar ulushi, uptime" text="Server so‘rov metrikalari kerak."/>
    </div></Card>
  </div>
}
const fmtBytes=(n?:number)=>n===undefined?'—':n>1e9?`${(n/1e9).toFixed(1)} GB`:n>1e6?`${(n/1e6).toFixed(1)} MB`:`${Math.round(n/1e3)} KB`
