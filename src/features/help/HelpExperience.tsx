import {useEffect,useMemo,useRef,useState} from 'react'
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {PERMISSION_ACTIONS,PERMISSION_MODULES} from '../../domain/access'
import {moduleNav} from '../../routes/navigation'
import {Card,Drawer,Empty,Icon,PageHeader,Select,StatusBadge} from '../../shared/ui'
import {storage} from '../../shared/lib/storage'
import {cls} from '../../utils/format'
import type {PermissionAction} from '../../types'
import {dailyGuides,HELP_TOPICS,onboardingKey,requirementRules,roleActions,searchHelp,topicAt,unavailableModules,visibleFaq,visibleGuides,visibleTopics,workflowPartners} from './helpContent'
import type {HelpGuide,HelpTopic} from './helpContent'
import {contextNotes,guideProbe,moduleOfPath,recordContext,unavailableGuides,workContext} from './helpContext'
import type {HelpCtx,Probe,RecordHelp,WorkContext} from './helpContext'
import './help.css'

type OnboardingStatus='done'|'skipped'|null
const CHANGED='zenix-help-onboarding-changed'
function useOnboarding(){
  const app=useApp()
  const key=onboardingKey(app.saas.tenant?.id||'unknown',app.auth.account?.id||'unknown',app.currentEmployee?.id||'unknown')
  const [status,setStatus]=useState<OnboardingStatus>(()=>storage.get<OnboardingStatus>(key,null))
  useEffect(()=>{
    const sync=()=>setStatus(storage.get<OnboardingStatus>(key,null))
    sync();window.addEventListener(CHANGED,sync)
    return()=>window.removeEventListener(CHANGED,sync)
  },[key])
  const save=(value:Exclude<OnboardingStatus,null>)=>{
    if(!storage.set(key,value)){app.toast('Yo‘riqnoma holati brauzerda saqlanmadi','warning');return false}
    setStatus(value);window.dispatchEvent(new Event(CHANGED));return true
  }
  return {status,save}
}

/** The person, their visible data and rights: the input of every context-aware answer. */
function useHelpCtx():HelpCtx{
  const app=useApp()
  return useMemo(()=>({state:app.state,employee:app.currentEmployee,role:app.currentRole,can:app.can,company:app.saas.tenant?.name,blocker:app.actionBlocker}),[app.state,app.currentEmployee,app.currentRole,app.can,app.saas.tenant?.name,app.actionBlocker])
}
/** After an in-page change, put keyboard focus on the main region (the control that had it is gone). */
const focusMain=()=>requestAnimationFrame(()=>document.getElementById('main')?.focus({preventScroll:true}))

function scopeRows(wc:WorkContext,ctx:HelpCtx):Array<[string,string]>{
  const rows:Array<[string,string]>=[['Kompaniya',wc.company||'—'],['Filial',wc.allBranches?'Barcha filiallar':wc.branches.join(', ')||'Biriktirilmagan']]
  if(ctx.can('warehouse'))rows.push(['Omborlar',wc.allWarehouses?`Barcha omborlar (${wc.warehouses.length})`:wc.warehouses.join(', ')||'Biriktirilmagan'])
  if(wc.workCenter)rows.push(['Ish markazi',wc.workCenter])
  if(wc.assignmentRule)rows.push(['Sizga biriktirilgan ochiq maintenance',wc.assigned.map(m=>m.code).join(', ')||'Yo‘q'])
  return rows
}

function Availability({ok,reason}:{ok:boolean;reason?:string}){
  return <span className={cls('help-avail',ok?'is-ok':'is-no')}><Icon name={ok?'check':'lock'} size={13}/><b>{ok?'Mumkin':'Mumkin emas'}</b>{!ok&&reason?<small>{reason}</small>:null}</span>
}
const PROBE_LABEL:Record<Probe['state'],string>={ready:'Hozir bajarish mumkin',blocked:'Hozir bajarib bo‘lmaydi',idle:'Hozircha ish yo‘q'}
function ProbeNote({probe}:{probe:Probe}){
  return <div className={cls('help-probe',`is-${probe.state}`)} role="note" aria-label="Sizning holatingiz"><Icon name={probe.state==='ready'?'check':probe.state==='blocked'?'lock':'info'} size={16}/><div><b>{PROBE_LABEL[probe.state]}</b><p>{probe.text}</p></div></div>
}

function GuideSteps({guide}:{guide:HelpGuide}){
  const [step,setStep]=useState(0)
  const ctx=useHelpCtx()
  const probe=guideProbe(ctx,guide)
  const required=guide.requirements.map(r=>requirementRules(r).map(([m,a])=>`${PERMISSION_MODULES.find(x=>x.key===m)?.label||m}: ${PERMISSION_ACTIONS.find(x=>x.key===a)?.label||a}`).join(' yoki ')).join(' va ')
  const topic=HELP_TOPICS.find(t=>t.id===guide.topic)
  return <div className="help-guide" aria-label={guide.title}>
    <div className="help-guide-intro"><h2>{guide.title}</h2><p>{guide.purpose}</p><small>Kerakli huquq: {required||'Sahifani ko‘rish'}</small></div>
    {probe&&<ProbeNote probe={probe}/>}
    <div className="help-two-cols">
      <Card title="Boshlashdan oldin"><ul>{guide.prerequisites.map(x=><li key={x}>{x}</li>)}</ul></Card>
      <Card title="Kiritiladigan ma’lumotlar"><ul>{guide.fields.map(x=><li key={x}>{x}</li>)}</ul></Card>
    </div>
    <Card title={`Qadam ${step+1} / ${guide.steps.length}`}>
      <ol className="help-step-list">{guide.steps.map((text,i)=><li key={text} className={i===step?'current':i<step?'finished':''} aria-current={i===step?'step':undefined}>
        <span aria-hidden="true">{i<step?<Icon name="check" size={12}/>:i+1}</span>{text}{i<step&&<span className="sr-only"> (o‘tilgan)</span>}</li>)}</ol>
      <p className="sr-only" role="status" aria-live="polite">{`Qadam ${step+1} dan ${guide.steps.length}: ${guide.steps[step]}`}</p>
      <div className="help-step-actions">
        <button type="button" className="secondary-glass-btn compact" disabled={step===0} onClick={()=>setStep(x=>x-1)}>Oldingi</button>
        <button type="button" className="secondary-glass-btn compact" disabled={step===guide.steps.length-1} onClick={()=>setStep(x=>x+1)}>Keyingi qadam</button>
        {topic&&<Link className="primary-glass-btn compact" to={topic.path}>Sahifani ochish <Icon name="arrow-right" size={14}/></Link>}
      </div>
    </Card>
    <div className="help-two-cols">
      <Card title="Kutilayotgan natija"><p>{guide.result}</p><p><b>Keyingi ish:</b> {guide.next}</p></Card>
      <Card title="Agar amal bajarilmasa"><ul>{guide.errors.map(x=><li key={x}>{x}</li>)}</ul></Card>
    </div>
    <p className="soft-meta">Qadamlar faqat tushuntirish uchun. “Sahifani ochish” haqiqiy amalni avtomatik bajarmaydi; biznes ma’lumoti faqat o‘sha sahifada tasdiqlasangiz o‘zgaradi.</p>
  </div>
}

function RoleProfile(){
  const app=useApp(),role=app.currentRole,ctx=useHelpCtx()
  const can=app.can
  const modules=moduleNav.filter(n=>(n.anyOf||[n.module]).some(m=>can(m))).map(n=>n.label)
  const actions=(action:PermissionAction)=>roleActions(role,can,action)
  const allowedGuides=visibleGuides(can)
  const operations=allowedGuides.filter(g=>['transfer','maintenance','goods-receipt','delivery','shop-floor','quality-check'].includes(g.id)).map(g=>g.title)
  const denied=unavailableModules(can)
  const partners=workflowPartners(role,app.state.roles,can)
  const rows=[
    ['Mas’uliyat',role.description||'Vazifalar joriy ruxsat matritsasiga ko‘ra belgilanadi.'],
    ...scopeRows(workContext(ctx),ctx),
    ['Ko‘rish',modules.join(' · ')||'Boshqaruv paneli'],
    ['Yaratish',actions('create').join(' · ')||'Yaratish ruxsati yo‘q'],
    ['Tahrirlash',actions('edit').join(' · ')||'Tahrirlash ruxsati yo‘q'],
    ['Tasdiqlash / rad etish',actions('approve').join(' · ')||'Tasdiqlash ruxsati yo‘q'],
    ['Bajarish / chiqim / transfer',operations.join(' · ')||actions('execute').join(' · ')||'Bunday amal uchun ruxsat yo‘q'],
    ['Ruxsat yo‘q',denied.join(' · ')||'Joriy tarif va rol doirasidagi boshqa modullar ochiq; alohida amallar cheklanishi mumkin.'],
    ['Kunlik ish',dailyGuides(role,can).map(g=>g.title).join(' → ')||'Ochiq sahifalardagi holatlarni tekshiring.'],
    ['Hamkorlik',partners.join(' · ')||'Keyingi bosqich mas’uli joriy ishga qarab belgilanadi.'],
  ]
  return <section aria-label="Mening rolim" className="help-role">
    <Card title={role.name} subtitle="Joriy rol, ish doirasi va tarifga mos yo‘riqnoma">
      <dl className="help-role-grid">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="soft-meta">Amal huquqi bilan birga filial, ombor, ish markazi, yozuv holati va obuna limiti ham tekshiriladi. Bu brauzerdagi ruxsatlar server xavfsizligi o‘rnini bosmaydi.</p>
    </Card>
  </section>
}

export function HelpOnboardingBanner(){
  const app=useApp(),location=useLocation(),navigate=useNavigate()
  const {status,save}=useOnboarding()
  if(status||location.pathname==='/help')return null
  const first=dailyGuides(app.currentRole,app.can)[0]
  return <aside className="help-onboarding-banner" aria-label="Birinchi kirish yo‘riqnomasi">
    <Icon name="info" size={20}/>
    <div><b>Xush kelibsiz, {app.currentEmployee.name.split(' ')[0]}!</b><p>Sizning rolingiz: {app.currentRole.name}. {first?`Birinchi tavsiya: ${first.title}.`:'Ochiq bo‘limlar bilan tanishing.'}</p></div>
    <button type="button" className="primary-glass-btn compact" onClick={()=>navigate('/help?onboarding=1')}>Yo‘riqnomani boshlash</button>
    <button type="button" className="ghost-btn compact" onClick={()=>{if(save('skipped'))focusMain()}}>Keyinroq</button>
  </aside>
}

function OnboardingView({onDone,onSkip}:{onDone:()=>void;onSkip:()=>void}){
  const app=useApp(),ctx=useHelpCtx()
  const modules=moduleNav.filter(n=>(n.anyOf||[n.module]).some(m=>app.can(m))).map(n=>({title:n.label,path:n.path}))
  const tasks=dailyGuides(app.currentRole,app.can)
  const rows=scopeRows(workContext(ctx),ctx)
  return <div className="help-onboarding-view" aria-label="Boshlang‘ich yo‘riqnoma">
    <Card title={`Sizning rolingiz — ${app.currentRole.name}`} subtitle={app.currentRole.description}>
      <p>Chap menyu modullarga, modul ichidagi yuqori qator esa sahifalarga olib boradi. Yuqoridagi “Yordam” tugmasi turgan sahifangizni va ochilgan yozuvni tushuntiradi. Qidiruv va bildirishnomalar faqat sizga ochiq yozuvlarni ko‘rsatadi.</p>
      <dl className="help-scope-list" aria-label="Ish doirangiz">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p>Avval rolingizga tegishli sahifani tanlang. Yo‘riqnoma amallarni o‘zi bajarmaydi.</p>
    </Card>
    <div className="help-two-cols">
      <Card title="Sizga ochiq bo‘limlar"><ul>{modules.map(t=><li key={t.path}><Link to={t.path}>{t.title}</Link></li>)}</ul></Card>
      <Card title="Birinchi amaliy ishlar"><ol>{tasks.map(g=><li key={g.id}><Link to={`/help?guide=${g.id}`}>{g.title}</Link></li>)}</ol>{!tasks.length&&<p>Ochiq bo‘limlarning holatini ko‘rishdan boshlang.</p>}</Card>
    </div>
    <div className="help-step-actions"><button type="button" className="primary-glass-btn" onClick={onDone}>Tushundim</button><button type="button" className="secondary-glass-btn" onClick={onSkip}>Keyinroq</button></div>
    <p className="soft-meta">Tanlov shu brauzerda ushbu akkaunt va kompaniya uchun saqlanadi; serverga yuborilmaydi. Yordam markazidan istalgan payt qayta ochishingiz mumkin.</p>
  </div>
}

function RecordSection({record,onNavigate}:{record:RecordHelp;onNavigate:()=>void}){
  return <section className="help-panel-section" aria-labelledby="help-record-title">
    <h4 id="help-record-title">Ochilgan yozuv: {record.title} <StatusBadge>{record.status}</StatusBadge></h4>
    <ul className="help-facts">{record.facts.map(f=><li key={f}>{f}</li>)}</ul>
    <ul className="help-actions-list" aria-label="Shu yozuvdagi amallar">{record.actions.map(a=><li key={a.label}><span>{a.label}</span><Availability ok={a.ok} reason={a.reason}/></li>)}</ul>
    <p className="help-next"><b>Keyingi qadam.</b> {record.next}</p>
    {record.links.length>0&&<div className="help-panel-links">{record.links.map(l=><Link key={l.to} to={l.to} onClick={onNavigate}>{l.label}<Icon name="chevron" size={14}/></Link>)}</div>}
  </section>
}

export function HelpPanel({open,onClose}:{open:boolean;onClose:()=>void}){
  if(!open)return null
  return <HelpPanelBody onClose={onClose}/>
}
function HelpPanelBody({onClose}:{onClose:()=>void}){
  const app=useApp(),location=useLocation(),ctx=useHelpCtx()
  const topic=topicAt(location.pathname,location.search,app.can)
  const related=topic?visibleGuides(app.can).filter(g=>g.topic===topic.id):dailyGuides(app.currentRole,app.can)
  const closed=topic?unavailableGuides(ctx,topic.id):[]
  const record=topic?recordContext(ctx,location.pathname,location.search):undefined
  const notes=topic?contextNotes(ctx,moduleOfPath(location.pathname)):[]
  const wc=workContext(ctx)
  return <Drawer open onClose={onClose} title="Sahifa bo‘yicha yordam" eyebrow="ZENIX yo‘riqnoma" icon="info" size="md"
    actions={<Link className="primary-glass-btn" to={topic?`/help?topic=${encodeURIComponent(topic.id)}`:'/help'} onClick={onClose}>Yordam markazi <Icon name="arrow-right" size={15}/></Link>}>
    {topic?<>
      <h3>{topic.title}</h3><p>{topic.detail}</p>
      {record==='missing'?<div className="inline-note warning" role="note"><Icon name="warning"/>Ochilgan yozuv topilmadi yoki sizning doirangizdan tashqarida — u bo‘yicha amal ko‘rsatilmaydi.</div>
        :record?<RecordSection record={record} onNavigate={onClose}/>:null}
      <section className="help-panel-guides" aria-labelledby="help-panel-actions"><h4 id="help-panel-actions">Shu yerdagi amallar</h4>
        {related.length?related.map(g=>{const probe=guideProbe(ctx,g);return <div key={g.id} className="help-panel-guide">
          <Link to={`/help?guide=${g.id}`} onClick={onClose}>{g.title}<Icon name="chevron" size={14}/></Link>
          {probe&&<small className={cls('help-probe-inline',`is-${probe.state}`)}><b>{PROBE_LABEL[probe.state]}.</b> {probe.text}</small>}
        </div>}):<p>Bu sahifada sizga ochiq amaliy yo‘riqnoma yo‘q. Yordam markazida boshqa mavzularni qidiring.</p>}
      </section>
      {closed.length>0&&<section className="help-panel-section" aria-labelledby="help-panel-closed"><h4 id="help-panel-closed">Sizga yopiq amallar</h4>
        <ul className="help-actions-list">{closed.map(({guide,reason})=><li key={guide.id}><span>{guide.title}</span><Availability ok={false} reason={reason}/></li>)}</ul>
        <p className="soft-meta">Bu amallar uchun ko‘rsatma berilmaydi. Kerak bo‘lsa administratordan rol huquqini so‘rang.</p></section>}
      {notes.length>0&&<section className="help-panel-section" aria-labelledby="help-panel-context"><h4 id="help-panel-context">Sizning ish kontekstingiz</h4>
        <ul className="help-notes">{notes.map(n=><li key={n.id}><div><b>{n.title}</b>{n.ok!==undefined&&<Availability ok={n.ok} reason={n.reason}/>}</div><p>{n.text}</p></li>)}</ul>
        {wc.assignmentRule&&wc.assigned.length>0&&<div className="help-panel-links">{wc.assigned.map(m=>app.can('equipment')?<Link key={m.id} to={`/equipment?view=maintenance&id=${m.id}`} onClick={onClose}>{m.code} · {m.status}<Icon name="chevron" size={14}/></Link>:app.can('warehouse')?<Link key={m.id} to={`/warehouse?view=maintenance&mo=${m.id}`} onClick={onClose}>{m.code} · {m.status}<Icon name="chevron" size={14}/></Link>:null)}</div>}
      </section>}
      <p className="soft-meta help-limit">{record==='missing'?'':record?'Yozuv bo‘yicha holat joriy ma’lumotdan hisoblangan.':'Aniq yozuv tanlanmagan: holat maintenance ishi, sifat tekshiruvi yoki ishlab chiqarish buyurtmasi ochilganda ko‘rsatiladi, boshqa joylarda umumiy yo‘riqnoma beriladi.'} Amal yuborilganda tizim ruxsat, doira va holatni yana tekshiradi. Bu brauzerdagi tekshiruv — server xavfsizligi emas.</p>
    </>:<Empty compact icon="info" title="Sahifa qo‘llanmasi topilmadi" text="Yordam markazida rol va ish jarayonlari bo‘yicha qo‘llanmalar mavjud."/>}
  </Drawer>
}

function TopicDetail({topic}:{topic:HelpTopic}){
  const app=useApp(),ctx=useHelpCtx()
  const guides=visibleGuides(app.can).filter(g=>g.topic===topic.id)
  const closed=unavailableGuides(ctx,topic.id)
  return <Card title={topic.title} subtitle={topic.category}><p>{topic.detail}</p>
    <div className="help-step-actions"><Link className="secondary-glass-btn compact" to={topic.path}>Sahifani ochish <Icon name="arrow-right" size={14}/></Link>{guides.map(g=><Link key={g.id} className="ghost-btn compact" to={`/help?guide=${g.id}`}>{g.title}</Link>)}</div>
    {closed.length>0&&<ul className="help-actions-list" aria-label="Sizga yopiq amallar">{closed.map(({guide,reason})=><li key={guide.id}><span>{guide.title}</span><Availability ok={false} reason={reason}/></li>)}</ul>}
  </Card>
}

export default function HelpPage(){
  const app=useApp(),[params,setParams]=useSearchParams(),navigate=useNavigate()
  const {status,save}=useOnboarding()
  const [query,setQuery]=useState(params.get('q')||'')
  const [category,setCategory]=useState('')
  const detailRef=useRef<HTMLDivElement>(null),[focusFor,setFocusFor]=useState<[string,string]|null>(null)
  const guide=visibleGuides(app.can).find(g=>g.id===params.get('guide'))
  const topic=visibleTopics(app.can).find(t=>t.id===params.get('topic'))
  const faq=visibleFaq(app.can).find(f=>f.id===params.get('faq'))
  const showOnboarding=params.get('onboarding')==='1'||(!status&&!params.get('guide')&&!params.get('topic')&&!params.get('faq')&&!params.get('q'))
  const categories=[...new Set(visibleTopics(app.can).map(t=>t.category))]
  const hits=useMemo(()=>searchHelp(query,app.can),[query,app.can])
  const topics=visibleTopics(app.can).filter(t=>!category||t.category===category)
  const guides=visibleGuides(app.can)
  // A chosen result replaces the content under the search box: once the URL carries it (the router applies it in a
  // transition) and it is rendered, move keyboard and screen-reader focus to it.
  useEffect(()=>{if(focusFor&&params.get(focusFor[0])===focusFor[1]){detailRef.current?.focus();setFocusFor(null)}},[focusFor,params])
  const done=(value:'done'|'skipped')=>{if(save(value)){navigate('/help',{replace:true});focusMain()}}
  const select=(key:string,value:string)=>{const next=new URLSearchParams();next.set(key,value);setParams(next);window.scrollTo({top:0});setFocusFor(key==='onboarding'?null:[key,value])}
  const announce=query.trim()?(hits.length?`${hits.length} ta natija topildi`:'Natija topilmadi'):''
  return <div className="page-stack help-page">
    <PageHeader title="Yordam markazi" subtitle="O‘z rolingizga mos sahifa va amaliy yo‘riqnomalar"
      actions={<button type="button" className="secondary-glass-btn" onClick={()=>select('onboarding','1')}>Boshlang‘ich yo‘riqnomani qayta ko‘rish</button>}/>
    {showOnboarding?<OnboardingView onDone={()=>done('done')} onSkip={()=>done('skipped')}/>:<>
      <div className="help-search"><Icon name="search" size={18}/><input type="search" aria-label="Yordam qidirish" aria-describedby="help-search-status" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Masalan: LOT, transfer, MO, qabul, parol..."/></div>
      <p id="help-search-status" className="sr-only" role="status" aria-live="polite">{announce}</p>
      {query.trim()?<section className="help-section" aria-label="Qidiruv natijalari"><h2>Qidiruv natijalari</h2>{hits.length?<div className="help-list">{hits.map(h=><button key={`${h.kind}:${h.id}`} type="button" className="help-list-item" onClick={()=>select(h.kind,h.id)}><span><b>{h.title}</b><small>{h.summary}</small></span><StatusBadge>{h.kind==='guide'?'Yo‘riqnoma':h.kind==='topic'?'Sahifa':'Savol'}</StatusBadge></button>)}</div>:<Empty icon="search" title="Natija topilmadi" text="Boshqa atama bilan qidiring yoki modulni tanlang."/>}</section>:null}
      <div ref={detailRef} tabIndex={-1} className="help-detail" aria-label="Tanlangan yordam mavzusi">
        {guide?<GuideSteps key={guide.id} guide={guide}/>:params.get('guide')?<Empty icon="lock" title="Yo‘riqnoma ochilmadi" text="Bu yo‘riqnoma sizga ruxsat etilmagan yoki mavjud emas."/>:null}
        {topic?<TopicDetail topic={topic}/>:params.get('topic')?<Empty icon="lock" title="Sahifa qo‘llanmasi ochilmadi" text="Sahifa sizga ruxsat etilmagan yoki mavjud emas."/>:null}
        {faq?<Card title={faq.question}><p>{faq.answer}</p></Card>:params.get('faq')?<Empty icon="lock" title="Savol ochilmadi" text="Bu savol sizga ruxsat etilmagan yoki mavjud emas."/>:null}
      </div>
      {!guide&&!topic&&!faq&&!params.get('guide')&&!params.get('topic')&&!params.get('faq')&&<>
        <RoleProfile/>
        <section className="help-section" aria-label="Amaliy yo‘riqnomalar"><h2>Amaliy yo‘riqnomalar</h2><div className="help-list">{guides.map(g=><button key={g.id} type="button" className="help-list-item" onClick={()=>select('guide',g.id)}><span><b>{g.title}</b><small>{g.purpose}</small></span><Icon name="chevron" size={15}/></button>)}</div></section>
        <section className="help-section" aria-label="Sahifalar"><div className="help-section-head"><h2>Sahifalar</h2><Select ariaLabel="Modul bo‘yicha tanlash" value={category} onChange={setCategory}><option value="">Barcha modullar</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</Select></div><div className="help-topic-grid">{topics.map(t=><button key={t.id} type="button" className="card help-topic" onClick={()=>select('topic',t.id)}><b>{t.title}</b><small>{t.summary}</small></button>)}</div></section>
        <section className="help-section" aria-label="Ko‘p so‘raladigan savollar"><h2>Ko‘p so‘raladigan savollar</h2>{visibleFaq(app.can).map(f=><details key={f.id} id={`faq-${f.id}`} className="card help-faq"><summary>{f.question}</summary><p>{f.answer}</p></details>)}</section>
      </>}
    </>}
  </div>
}
