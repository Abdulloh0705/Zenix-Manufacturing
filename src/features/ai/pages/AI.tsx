import {useEffect,useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Icon,KPI,PageHeader} from '../../../shared/ui'
import {answerQuestion,buildInsights,SUGGESTED_QUESTIONS} from '../../../domain/insights'
import {deliveryRisk,productionOee} from '../../../domain/manufacturingEngine'
import {branchPurchaseNeeds} from '../../../domain/planning'

export default function AI(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useState('')
  const [messages,setMessages]=useState<Array<{who:'user'|'ai';text:string}>>([{who:'ai',text:'Buyurtma, zaxira, capacity, sifat, maintenance yoki tannarx haqida so‘rang.'}])
  const bodyRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{bodyRef.current?.scrollTo({top:bodyRef.current.scrollHeight})},[messages])
  const insights=buildInsights(s,m=>app.can(m))
  const plan=branchPurchaseNeeds(s)
  const oee=productionOee(s)
  const send=(text:string)=>{const t=text.trim();if(!t)return;setMessages(m=>[...m,{who:'user',text:t},{who:'ai',text:answerQuestion(s,t,m=>app.can(m))}]);setQ('')}
  if(!s.settings.ai.enabled)return <div className="page-stack"><PageHeader title="ZENIX AI"/><Card><Empty icon="spark" title="ZENIX AI o‘chirilgan" text="Sozlamalar → ZENIX AI" action={app.can('settings','edit')?<button type="button" className="primary-glass-btn compact" onClick={()=>navigate('/settings?view=ai')}>Sozlamalarga o‘tish</button>:undefined}/></Card></div>
  return <div className="page-stack">
    <PageHeader title="ZENIX AI" subtitle="Jonli ma’lumotlardan tahlil va tavsiyalar"/>
    <div className="kpi-grid">
      <KPI label="Xarid talabi" value={plan.filter(p=>p.suggested>0).length} sub="filial bo‘yicha MRP" tone="orange" icon={<Icon name="layers"/>} onClick={()=>navigate('/materials?view=shortages')}/>
      <KPI label="Muddat riski" value={s.productionOrders.filter(o=>deliveryRisk(s,o)).length} tone="pink" icon={<Icon name="clock"/>} onClick={()=>navigate('/production?view=orders&risk=1')}/>
      <KPI label="Ochiq NCR" value={s.qualityAlerts.filter(a=>a.status!=='Yopilgan').length} tone="purple" icon={<Icon name="shield"/>} onClick={()=>navigate('/quality?view=alerts&status=Ochiq')}/>
      <KPI label="OEE (7 kun)" value={`${oee.oee}%`} tone="mint" icon={<Icon name="gauge"/>} onClick={()=>navigate('/reports?view=oee')}/>
    </div>
    <div className="split-main">
      <Card className="ai-conversation" title="Suhbat">
        <div className="ai-messages tall" ref={bodyRef} aria-live="polite">{messages.map((m,i)=><div className={`msg ${m.who}`} key={i}>{m.text}</div>)}</div>
        <div className="ai-suggestions" role="group" aria-label="Tayyor savollar">{SUGGESTED_QUESTIONS.map(x=><button type="button" key={x} onClick={()=>send(x)}>{x}</button>)}</div>
        <form className="ai-input" onSubmit={e=>{e.preventDefault();send(q)}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Manufacturing bo‘yicha savol yozing..." aria-label="Savol"/><button type="submit" className="primary-glass-btn compact" disabled={!q.trim()} aria-label="Yuborish"><Icon name="arrow" size={16}/></button></form>
      </Card>
      <Card title="Signallar" subtitle={String(insights.length)}>
        {insights.length?<div className="ai-insight-strip">{insights.map(i=><button type="button" key={i.id} className={`insight-card ${i.tone}`} onClick={()=>navigate(i.path)}><i aria-hidden="true"/><span><b>{i.title}</b><small>{i.text}</small></span><span className="chip">{i.action}</span></button>)}</div>:<Empty compact icon="check" title="Muhim signal yo‘q"/>}
      </Card>
    </div>
  </div>
}
