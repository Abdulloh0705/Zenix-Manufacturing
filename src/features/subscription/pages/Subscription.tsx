import {useState} from 'react'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import type {PlanId} from '../../../domain/saas'
import {Card,Confirm,PageHeader} from '../../../shared/ui'

export default function SubscriptionPage(){
  const app=useApp(),{tenant,subscription,plan,plans,usage}=app.saas
  const [pending,setPending]=useState<PlanId|null>(null)
  const owner=app.can('subscription','edit')
  const date=(value?:string)=>value?new Date(value).toLocaleDateString('uz-UZ'):'—'
  return <div className="page-stack">
    <PageHeader title="Obuna va limitlar" subtitle="Demo reja holati. To‘lov tizimi ulanmagan."/>
    <Card title={tenant?.name||'Kompaniya'}>
      <p>Joriy reja: <b>{plan?.name||'—'}</b> · Holat: <b>{subscription?.status||'—'}</b></p>
      <p>Boshlangan: {date(subscription?.startsAt)} · Tugash: {date(subscription?.endsAt)}</p>
      <p>Xodimlar: {usage.employees}/{plan?.maxEmployees??'—'} · Filiallar: {usage.branches}/{plan?.maxBranches??'—'} · Omborlar: {usage.warehouses}/{plan?.maxWarehouses??'—'}</p>
    </Card>
    <div className="form-grid">
      {Object.values(plans).map(p=><Card key={p.id} title={p.name}>
        <p>Xodimlar: {p.maxEmployees===Number.MAX_SAFE_INTEGER?'Cheklanmagan':p.maxEmployees}</p>
        <p>Filiallar: {p.maxBranches===Number.MAX_SAFE_INTEGER?'Cheklanmagan':p.maxBranches}</p>
        <p>Omborlar: {p.maxWarehouses===Number.MAX_SAFE_INTEGER?'Cheklanmagan':p.maxWarehouses}</p>
        <p>Modullar: {p.modules.length} · AI krediti: {p.aiCredits===Number.MAX_SAFE_INTEGER?'Cheklanmagan':p.aiCredits}</p>
        {owner&&<button type="button" className="secondary-glass-btn" disabled={p.id===plan?.id} onClick={()=>setPending(p.id)}>{p.id===plan?.id?'Joriy reja':'Demo rejaga o‘tish'}</button>}
      </Card>)}
    </div>
    <div className="inline-note warning" role="status">Reja pasaytirilsa mavjud yozuvlar saqlanadi. Limitdan ortiq yangi yozuv yaratish cheklanadi. Bu brauzerdagi demo holat; haqiqiy obuna va to‘lovni server tasdiqlashi kerak.</div>
    <Confirm open={pending!==null} onClose={()=>setPending(null)} onConfirm={()=>{if(pending){const result=app.changePlan(pending);app.toast(result.message,result.ok?'success':'danger')}setPending(null)}} title="Demo rejani o‘zgartirish" text={`Reja ${pending?plans[pending].name:''} ga o‘zgartirilsinmi? To‘lov olinmaydi.`} confirmText="Tasdiqlash"/>
  </div>
}
