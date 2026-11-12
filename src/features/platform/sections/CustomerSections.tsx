// Platform Overview, Companies, Plans & Subscriptions and Billing. Inputs are SaaS metadata only.
import {useMemo,useState} from 'react'
import {Link,useNavigate,useSearchParams} from 'react-router-dom'
import * as SaaS from '../../../domain/saas'
import * as Platform from '../../../domain/platform'
import {Card,Drawer,Empty,Field,InfoGrid,KPI,MetricBar,Modal,SearchBox,StatusBadge,Textarea,Timeline,Icon} from '../../../shared/ui'
import {Table,TenantBadge,SubBadge,ReasonDialog,Unavailable,actionLabel,fmtDate,fmtTime,unlimited,usePlatform,SUB_STATUS} from '../platformShared'

const PLANS=Object.values(SaaS.PLAN_CATALOG)
const planName=(id:SaaS.PlanId|null|undefined)=>id?SaaS.PLAN_CATALOG[id].name:'—'

export function OverviewSection(){
  const {saas,platform,now}=usePlatform()
  const o=useMemo(()=>Platform.platformOverview(saas,platform,now),[saas,platform,now])
  const trail=useMemo(()=>Platform.auditTrail(saas,platform).slice(0,8),[saas,platform])
  if(!o.total)return <div className="page-stack">
    <Empty icon="factory" title="Hali kompaniya ro‘yxatdan o‘tmagan" text="Biznes egasi /register sahifasida kompaniya yaratgach, u shu yerda ko‘rinadi. Statistikalar faqat haqiqiy yozuvlardan hisoblanadi."/>
    <LiveDataUnavailable/>
  </div>
  return <div className="page-stack">
    <div className="kpi-grid cols-6">
      <KPI label="Jami kompaniyalar" value={o.total} icon={<Icon name="factory"/>}/>
      <KPI label="Faol kompaniyalar" value={o.active} icon={<Icon name="check"/>} tone="green"/>
      <KPI label="To‘xtatilgan" value={o.suspended} icon={<Icon name="warning"/>} tone="red"/>
      <KPI label="Sinovda" value={o.byStatus.trial} icon={<Icon name="clock"/>}/>
      <KPI label="Obunasi tugagan" value={o.byStatus.expired} icon={<Icon name="calendar"/>} tone="amber"/>
      <KPI label="Faol a’zoliklar" value={o.activeMemberships} sub={`${o.activeAccounts} ta noyob akkaunt`} icon={<Icon name="users"/>}/>
    </div>
    <div className="pf-grid-2">
      <Card title="Reja bo‘yicha taqsimot" subtitle="Har kompaniyaning joriy (oxirgi) obunasi bir marta hisoblanadi">
        <div className="stack-list pf-bars">{PLANS.map(p=><MetricBar key={p.id} label={p.name} value={o.byPlan[p.id]} max={o.total} caption={`${o.byPlan[p.id]} ta`}/>)}{o.byStatus.none>0&&<MetricBar label="Obunasiz" value={o.byStatus.none} max={o.total} caption={`${o.byStatus.none} ta`}/>}</div>
      </Card>
      <Card title="Obuna holati">
        <div className="stack-list pf-bars">{(Object.keys(SUB_STATUS) as Platform.EffectiveStatus[]).filter(s=>o.byStatus[s]>0).map(s=><MetricBar key={s} label={SUB_STATUS[s].label} value={o.byStatus[s]} max={o.total} caption={`${o.byStatus[s]} ta`}/>)}</div>
      </Card>
    </div>
    <div className="pf-grid-2">
      <Card title="Sinov muddati yaqin (7 kun)" actions={<Link className="ghost-btn" to="/platform/subscriptions">Obunalar</Link>}>
        {o.expiringTrials.length?<ul className="pf-list">{o.expiringTrials.map(r=><li key={r.id}><span><b>{r.name}</b><small>{planName(r.planId)} · {fmtDate(r.endsAt)} gacha</small></span><StatusBadge tone={r.daysLeft!<=2?'danger':'warning'}>{r.daysLeft} kun</StatusBadge></li>)}</ul>:<Empty compact icon="clock" title="Yaqin tugaydigan sinov yo‘q"/>}
      </Card>
      <Card title="So‘nggi platforma amallari" actions={<Link className="ghost-btn" to="/platform/security">Audit</Link>}>
        <Timeline items={trail.map(a=>({title:actionLabel(a.action),meta:`${a.actor}${a.tenantId?` · ${saas.tenants.find(t=>t.id===a.tenantId)?.name||a.tenantId}`:''}${a.reason?` · ${a.reason}`:''}`,time:fmtTime(a.at),tone:a.outcome==='success'?'info':'danger'}))}/>
      </Card>
    </div>
    <LiveDataUnavailable/>
  </div>
}

function LiveDataUnavailable(){
  return <Card title="Jonli biznes va server ko‘rsatkichlari" subtitle="Frontend demo bu qiymatlarni o‘lchay olmaydi, shuning uchun ko‘rsatmaydi">
    <div className="stack-list">
      <Unavailable title="MRR va daromad" text="Tasdiqlangan to‘lovlar va invoice jadvali kerak."/>
      <Unavailable title="Uptime va API kechikishi" text="Server monitoring xizmati kerak."/>
      <Unavailable title="Faol foydalanuvchilar (real vaqt)" text="Server sessiyalari kerak; bu yerda faqat a’zolik yozuvlari sanaladi."/>
    </div>
  </Card>
}

// ---------------------------------------------------------------- companies
export function CompaniesSection(){
  const {saas,now,saasState}=usePlatform()
  const [query,setQuery]=useState(''),[status,setStatus]=useState('all'),[plan,setPlan]=useState('all'),[sub,setSub]=useState('all'),[sort,setSort]=useState('name')
  const [openId,setOpenId]=useState('')
  const all=useMemo(()=>Platform.companyRows(saas,now),[saas,now])
  const rows=useMemo(()=>{
    const q=query.trim().toLowerCase()
    return all.filter(r=>!q||r.name.toLowerCase().includes(q)||r.id.toLowerCase().includes(q))
      .filter(r=>status==='all'||r.status===status).filter(r=>plan==='all'||r.planId===plan).filter(r=>sub==='all'||r.subStatus===sub)
      .sort((a,b)=>sort==='created'?b.createdAt.localeCompare(a.createdAt):sort==='status'?a.status.localeCompare(b.status)||a.name.localeCompare(b.name):sort==='expiry'?(a.endsAt||'9999').localeCompare(b.endsAt||'9999'):sort==='members'?b.activeMembers-a.activeMembers:a.name.localeCompare(b.name))
  },[all,query,status,plan,sub,sort])
  const filtered=query||status!=='all'||plan!=='all'||sub!=='all'
  if(saasState==='damaged')return null
  return <div className="page-stack">
    <Card>
      <div className="pf-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Nomi yoki ID" ariaLabel="Kompaniyani qidirish"/>
        <select className="ui-input" aria-label="Holat filtri" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Barcha holatlar</option><option value="active">Faol</option><option value="suspended">To‘xtatilgan</option></select>
        <select className="ui-input" aria-label="Reja filtri" value={plan} onChange={e=>setPlan(e.target.value)}><option value="all">Barcha rejalar</option>{PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="ui-input" aria-label="Obuna filtri" value={sub} onChange={e=>setSub(e.target.value)}><option value="all">Barcha obunalar</option>{(Object.keys(SUB_STATUS) as Platform.EffectiveStatus[]).map(s=><option key={s} value={s}>{SUB_STATUS[s].label}</option>)}</select>
        <select className="ui-input" aria-label="Saralash" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Nomi (A–Z)</option><option value="created">Yangi avval</option><option value="status">Holati</option><option value="expiry">Tugash sanasi</option><option value="members">A’zolar soni</option></select>
        {filtered&&<button type="button" className="ghost-btn" onClick={()=>{setQuery('');setStatus('all');setPlan('all');setSub('all')}}>Filtrlarni tozalash</button>}
      </div>
      <p className="pf-muted" role="status">{rows.length} / {all.length} ta kompaniya</p>
      {rows.length?<Table label="Kompaniyalar" head={['Kompaniya','Holat','Reja','Obuna','Tugash','A’zolar','Yaratilgan']}>
        {rows.map(r=><tr key={r.id}>
          <td><button type="button" className="pf-link" onClick={()=>setOpenId(r.id)}><b>{r.name}</b><small>{r.legacy?'Eski (legacy) ma’lumot · ':''}{r.id}</small></button></td>
          <td><TenantBadge status={r.status}/></td><td>{planName(r.planId)}</td><td><SubBadge status={r.subStatus}/></td>
          <td>{r.endsAt?`${fmtDate(r.endsAt)}${r.daysLeft!==null&&r.daysLeft>=0?` (${r.daysLeft} kun)`:''}`:'—'}</td>
          <td>{r.activeMembers}{r.members!==r.activeMembers?<small className="pf-muted"> / {r.members}</small>:null}</td><td>{fmtDate(r.createdAt)}</td>
        </tr>)}
      </Table>:<Empty icon="search" title={all.length?'Natija topilmadi':'Kompaniya yo‘q'} text={all.length?'Qidiruv yoki filtrlarni o‘zgartiring.':'Kompaniya ro‘yxatdan o‘tgach shu yerda ko‘rinadi.'}/>}
    </Card>
    {openId&&<CompanyDrawer id={openId} onClose={()=>setOpenId('')}/>}
  </div>
}

function CompanyDrawer({id,onClose}:{id:string;onClose:()=>void}){
  const {saas,platform,owners,now,actor,run,busy}=usePlatform()
  const navigate=useNavigate()
  const [confirm,setConfirm]=useState(false)
  const row=Platform.companyRows(saas,now).find(r=>r.id===id)
  if(!row)return null
  const owner=owners.get(row.ownerAccountId),plan=row.planId?SaaS.PLAN_CATALOG[row.planId]:null
  const disabled=[...SaaS.disabledModules(saas,id)]
  const history=Platform.auditTrail(saas,platform).filter(a=>a.tenantId===id)
  const subs=saas.subscriptions.filter(s=>s.tenantId===id).reverse()
  const members=saas.memberships.filter(member=>member.tenantId===id)
  const target=row.status==='active'?'suspended':'active'
  return <Drawer open onClose={onClose} title={row.name} eyebrow="Kompaniya" icon="factory" size="lg" actions={<>
    <button type="button" className="secondary-glass-btn" onClick={()=>navigate(`/platform/subscriptions?tenant=${encodeURIComponent(id)}`)}>Obunani boshqarish</button>
    <button type="button" className={row.status==='active'?'danger-glass-btn':'primary-glass-btn'} disabled={busy} onClick={()=>setConfirm(true)}>{row.status==='active'?'Kompaniyani to‘xtatish':'Kompaniyani qayta faollashtirish'}</button>
  </>}>
    <div className="page-stack">
      <InfoGrid columns={2} items={[
        {label:'ID',value:<code>{row.id}</code>},{label:'Holat',value:<TenantBadge status={row.status}/>},
        row.suspensionReason?{label:'To‘xtatish sababi',value:row.suspensionReason,tone:'danger'}:null,
        {label:'Ro‘yxatdan o‘tgan',value:fmtDate(row.createdAt)},
        {label:'Biznes egasi',value:owner?`${owner.username} · ${Platform.maskEmail(owner.email)}`:'Akkaunt topilmadi'},
        {label:'Egasi akkaunti',value:owner?.status==='active'?'Faol':owner?.status||'—'},
        {label:'A’zoliklar',value:`${row.activeMembers} faol / ${row.members} jami`},
        {label:'Reja',value:plan?.name||'—'},{label:'Obuna',value:<SubBadge status={row.subStatus}/>},
        {label:'Sinov boshlangan',value:fmtDate(Platform.trialStart(saas,id))},{label:'Tugash',value:fmtDate(row.endsAt)},
        {label:'Limitlar',value:plan?`${unlimited(plan.maxEmployees)} xodim · ${unlimited(plan.maxBranches)} filial · ${unlimited(plan.maxWarehouses)} ombor`:'—'},
        {label:'Platforma cheklagan modullar',value:disabled.length?disabled.join(', '):'Yo‘q'},
      ]}/>
      <p className="inline-note">Joriy foydalanish (xodim/filial/ombor soni) kompaniyaning ERP ma’lumotidan hisoblanadi. Platforma operatori ERP ma’lumotini o‘qimaydi; bu ko‘rsatkich backend API orqali beriladi.</p>
      <Card title="Kompaniya a’zolari" subtitle={row.activeMembers+" faol / "+row.members+" jami"}>
        {members.length?<Table label="Kompaniya a’zolari" head={['Login','E-pochta','Turi','A’zolik','Qo‘shilgan']}>
          {members.map(member=>{
            const account=owners.get(member.accountId)
            return <tr key={member.id}>
              <td>{account?.username||'Akkaunt topilmadi'}</td>
              <td>{Platform.maskEmail(account?.email)}</td>
              <td>{member.accountId===row.ownerAccountId?'Biznes egasi':'Xodim'}</td>
              <td>{member.status==='active'?'Faol':member.status==='invited'?'Taklif qilingan':'O‘chirilgan'}</td>
              <td>{fmtDate(member.createdAt)}</td>
            </tr>
          })}
        </Table>:<Empty compact title="A’zolik yozuvi yo‘q"/>}
      </Card>
      <Card title="Obuna tarixi">{subs.length?<ul className="pf-list">{subs.map(s=><li key={s.id}><span><b>{SaaS.PLAN_CATALOG[s.planId].name} · {s.status}</b><small>{fmtDate(s.startsAt)}{s.endsAt?` → ${fmtDate(s.endsAt)}`:''} · {s.changedBy?(s.changedBy===row.ownerAccountId?'egasi tanlovi':s.changedBy):'ro‘yxatdan o‘tish'}</small></span></li>)}</ul>:<Empty compact title="Obuna yozuvi yo‘q"/>}</Card>
      <Card title="Ma’muriy tarix"><Timeline items={history.map(a=>({title:actionLabel(a.action),meta:`${a.actor}${a.reason?` · ${a.reason}`:''}${a.detail?` · ${a.detail}`:''}`,time:fmtTime(a.at),tone:a.action.includes('suspend')||a.action.includes('disable')?'warning':'info'}))}/></Card>
    </div>
    <ReasonDialog open={confirm} onClose={()=>setConfirm(false)} danger={target==='suspended'} title={target==='suspended'?'Kompaniyani to‘xtatish':'Kompaniyani qayta faollashtirish'} confirmText={target==='suspended'?'To‘xtatish':'Faollashtirish'}
      text={target==='suspended'?`${row.name} a’zolari tizimga kira olmaydi. Hech qanday yozuv o‘chirilmaydi.`:`${row.name} a’zolari yana kira oladi (obuna holati alohida tekshiriladi).`}
      onConfirm={reason=>run(snap=>Platform.opTenantStatus(snap,actor,id,target,reason,new Date()))}/>
  </Drawer>
}

// ---------------------------------------------------------------- plans & subscriptions
export function SubscriptionsSection(){
  const {saas,platform,now,actor,run,busy}=usePlatform()
  const [params]=useSearchParams()
  const focus=params.get('tenant')||''
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(()=>saas.tenants.find(t=>t.id===focus)?.name||'')
  const [editing,setEditing]=useState<string>('')
  const rows=Platform.companyRows(saas,now).filter(r=>(filter==='all'||r.subStatus===filter)&&(!query.trim()||r.name.toLowerCase().includes(query.trim().toLowerCase())))
  const overrides=Platform.auditTrail(saas,platform).filter(a=>a.action.startsWith('subscription.override'))
  return <div className="page-stack">
    <Card title="Reja katalogi" subtitle="Yagona manba: domain/saas.ts. Narxlar belgilanmagan; tahrirlash versiyalangan server katalogini talab qiladi.">
      <Table label="Reja katalogi" head={['Reja','Xodimlar','Filiallar','Omborlar','Modullar','AI krediti','API']}>
        {PLANS.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{unlimited(p.maxEmployees)}</td><td>{unlimited(p.maxBranches)}</td><td>{unlimited(p.maxWarehouses)}</td><td>{p.modules.length}</td><td>{unlimited(p.aiCredits)}<small className="pf-muted"> (o‘lchanmaydi)</small></td><td>{p.api?'Ha':'Yo‘q'}</td></tr>)}
      </Table>
    </Card>
    <Card title="Kompaniya obunalari">
      <div className="pf-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Kompaniya nomi" ariaLabel="Obunani qidirish"/>
        <select className="ui-input" aria-label="Obuna holati filtri" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Barcha holatlar</option>{(Object.keys(SUB_STATUS) as Platform.EffectiveStatus[]).map(s=><option key={s} value={s}>{SUB_STATUS[s].label}</option>)}</select>
      </div>
      {rows.length?<Table label="Kompaniya obunalari" head={['Kompaniya','Reja','Holat','Sinov boshlangan','Tugash','Qolgan','Amal']}>
        {rows.map(r=><tr key={r.id} className={r.id===focus?'pf-focus':''}><td><b>{r.name}</b>{r.status==='suspended'&&<small className="pf-muted"> · kompaniya to‘xtatilgan</small>}</td><td>{planName(r.planId)}</td><td><SubBadge status={r.subStatus}/></td><td>{fmtDate(Platform.trialStart(saas,r.id))}</td><td>{fmtDate(r.endsAt)}</td><td>{r.daysLeft===null?'—':r.daysLeft<0?'Tugagan':`${r.daysLeft} kun`}</td>
          <td><button type="button" className="secondary-glass-btn" disabled={busy} onClick={()=>setEditing(r.id)}>Override</button></td></tr>)}
      </Table>:<Empty compact icon="layers" title="Obuna topilmadi"/>}
    </Card>
    <div className="pf-grid-2">
      <Card title="Override tarixi">{overrides.length?<Timeline items={overrides.map(a=>({title:`${saas.tenants.find(t=>t.id===a.tenantId)?.name||a.tenantId||'—'} · ${a.detail||a.targetId}`,meta:`${a.actor} · ${a.reason||''}`,time:fmtTime(a.at),tone:'warning'}))}/>:<Empty compact title="Override hali yozilmagan"/>}</Card>
      <Card title="Obuna qoidalari">
        <ul className="pf-rules">
          <li>Biznes egasi platforma to‘xtatgan kompaniya yoki obunani o‘zi tiklay olmaydi.</li>
          <li>Egasining o‘z tanlovi tasdiqlanmagan pullik obuna yaratmaydi: faol rejani faqat pasaytirish mumkin.</li>
          <li>Sinov muddati reja qayta tanlanganda uzaymaydi; platforma override sinov bermaydi.</li>
          <li>Imtiyoz davri sozlamadagi {platform.settings.graceDays} kun bilan cheklanadi.</li>
          <li>Reja pasaytirilsa tarixiy yozuvlar o‘chirilmaydi; limitdan ortiq yangi xodim, filial yoki ombor yaratib bo‘lmaydi.</li>
          <li>Override to‘lov tasdig‘i emas va faqat platforma operatori tomonidan sabab bilan yoziladi.</li>
        </ul>
      </Card>
    </div>
    {editing&&<OverrideModal tenantId={editing} onClose={()=>setEditing('')} run={run} actor={actor}/>}
  </div>
}

function OverrideModal({tenantId,onClose,run,actor}:{tenantId:string;onClose:()=>void;run:ReturnType<typeof usePlatform>['run'];actor:string}){
  const {saas,platform,now,busy}=usePlatform()
  const current=SaaS.subscriptionFor(saas,tenantId),tenant=saas.tenants.find(t=>t.id===tenantId)
  const [plan,setPlan]=useState<SaaS.PlanId>(current?.planId||'free'),[status,setStatus]=useState<typeof Platform.OVERRIDE_STATUSES[number]>('active'),[reason,setReason]=useState('')
  const [step,setStep]=useState<'edit'|'confirm'>('edit')
  const graceEnd=new Date(now.getTime()+platform.settings.graceDays*86400000).toISOString()
  const labels:Record<string,string>={active:'Faol (demo, to‘lov tasdiqlanmagan)',grace:`Imtiyoz davri (${platform.settings.graceDays} kun)`,expired:'Muddati o‘tgan',suspended:'Obuna to‘xtatilgan'}
  return <Modal open onClose={onClose} title={`Obuna override · ${tenant?.name||''}`} size="md" footer={step==='edit'
    ?<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={reason.trim().length<5} onClick={()=>setStep('confirm')}>Davom etish</button></>
    :<><button type="button" className="secondary-glass-btn" onClick={()=>setStep('edit')}>Orqaga</button><button type="button" className="primary-glass-btn" disabled={busy} onClick={async()=>{if(await run(snap=>Platform.opOverride(snap,actor,tenantId,plan,status,reason,new Date())))onClose()}}>{busy?'Saqlanmoqda…':'Override yozish'}</button></>}>
    {step==='edit'?<div className="form-stack">
      <p>Joriy: <b>{planName(current?.planId)}</b> · <SubBadge status={Platform.effectiveStatus(current,now)}/></p>
      <Field label="Yangi reja"><select className="ui-input" value={plan} onChange={e=>setPlan(e.target.value as SaaS.PlanId)}>{PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Obuna holati" hint={status==='grace'?`${fmtDate(graceEnd)} gacha amal qiladi`:undefined}><select className="ui-input" value={status} onChange={e=>setStatus(e.target.value as typeof status)}>{Platform.OVERRIDE_STATUSES.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></Field>
      <Field label="Sabab" required hint="Kamida 5 belgi; auditga yoziladi"><Textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></Field>
      <p className="inline-note warning">Override to‘lov tasdig‘i emas. Kompaniya ma’lumotlari o‘zgarmaydi; reja pasaysa limitdan ortiq yangi yozuv cheklanadi.</p>
    </div>:<div className="confirm-copy"><Icon name="info"/><div><p><b>{tenant?.name}</b>: {planName(current?.planId)} → <b>{SaaS.PLAN_CATALOG[plan].name}</b>, holat: <b>{labels[status]}</b>.</p><p>Sabab: {reason.trim()}</p></div></div>}
  </Modal>
}

// ---------------------------------------------------------------- billing
const sourceOf=(e?:SaaS.SaaSEvent)=>!e?'Ro‘yxatdan o‘tish':e.action==='subscription.change'?'Egasi tanlovi (demo)':e.action.startsWith('subscription.override')?'Platforma override':e.action
export function BillingSection(){
  const {saas,now}=usePlatform()
  const rows=Platform.companyRows(saas,now)
  const events=saas.events.filter(e=>e.action.startsWith('subscription.')).sort((a,b)=>b.at.localeCompare(a.at))
  return <div className="page-stack">
    <Card title="To‘lov integratsiyasi" subtitle="Hech qanday to‘lov, invoice yoki tranzaksiya bu brauzerda yaratilmaydi va ko‘rsatilmaydi">
      <div className="stack-list">
        <Unavailable title="Tasdiqlangan to‘lovlar" text="To‘lov provayderi webhooki (imzo tekshiruvi, idempotent) kerak."/>
        <Unavailable title="Invoice va soliq hisobotlari" text="Server invoice jadvali va soliq qoidalari kerak."/>
        <Unavailable title="Qaytarishlar (refund)" text="Provayder API va tasdiqlash jarayoni kerak."/>
        <Unavailable title="Avtomatik takroriy to‘lov" text="Server rejalashtiruvchi va provayder obunasi kerak."/>
      </div>
    </Card>
    <Card title="Billing holati" subtitle="Obuna holati demo yozuvi; to‘lov tasdig‘i alohida va hozircha mavjud emas">
      {rows.length?<Table label="Billing holati" head={['Kompaniya','Reja','Obuna','To‘lov tasdig‘i','Oxirgi o‘zgarish manbai']}>
        {rows.map(r=>{const last=saas.events.find(e=>e.tenantId===r.id&&e.action.startsWith('subscription.'));return <tr key={r.id}><td><b>{r.name}</b></td><td>{planName(r.planId)}</td><td><SubBadge status={r.subStatus}/></td><td><StatusBadge tone="neutral">Tasdiqlanmagan</StatusBadge></td><td>{sourceOf(last)}</td></tr>})}
      </Table>:<Empty compact icon="wallet" title="Kompaniya yo‘q"/>}
    </Card>
    <Card title="Reja o‘zgarishlari tarixi" subtitle="Yozilgan demo hodisalar; bu to‘lov tranzaksiyalari emas">
      {events.length?<Table label="Reja o‘zgarishlari" head={['Vaqt','Kompaniya','Hodisa','Reja','Kim','Izoh']}>
        {events.map(e=><tr key={e.id}><td>{fmtTime(e.at)}</td><td>{saas.tenants.find(t=>t.id===e.tenantId)?.name||e.tenantId}</td><td>{sourceOf(e)}</td><td>{SaaS.PLAN_CATALOG[e.targetId as SaaS.PlanId]?.name||e.targetId}</td><td>{e.actorAccountId||'—'}</td><td>{e.reason||'—'}</td></tr>)}
      </Table>:<Empty compact icon="history" title="Reja o‘zgarishi yozilmagan"/>}
    </Card>
    <Card title="Backend integratsiya shartnomasi">
      <dl className="pf-contract">
        <dt>POST /billing/webhooks/:provider</dt><dd>Imzo tekshiriladi, <code>providerEventId</code> bo‘yicha idempotent; to‘lov tasdiqlangandan keyingina obuna <code>active</code> bo‘ladi.</dd>
        <dt>GET /platform/v1/tenants/:id/invoices</dt><dd>Invoice: raqam, holat (draft/open/paid/void), summa (minor units), soliq, davr, berilgan/to‘langan sana.</dd>
        <dt>POST /platform/v1/tenants/:id/refunds</dt><dd>Ikki bosqichli tasdiq, sabab va audit bilan.</dd>
      </dl>
      <p className="pf-muted">TypeScript turlari: <code>InvoiceContract</code>, <code>PaymentEventContract</code> (src/domain/platform.ts).</p>
    </Card>
  </div>
}
