import {useMemo,useRef,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {APPEARANCE_PAIRS,pairFor} from '../../../app/theme/themeRegistry'
import type {CurrencyCode,ThemeMode} from '../../../types'
import {CURRENCIES} from '../../../utils/format'
import {Card,Confirm,Field,Icon,InfoGrid,Input,Modal,MoneyInput,PageHeader,Segmented,Select,StatusBadge,Toggle,required,useForm} from '../../../shared/ui'
import {downloadText} from '../../../utils/exportData'
import {fileSize} from '../../../utils/format'
import {todayISO} from '../../../utils/dates'

export default function Settings(){
  const [sp]=useSearchParams(),view=sp.get('view')||'business'
  if(view==='appearance')return <Appearance/>
  if(view==='notifications')return <Notifications/>
  if(view==='locations')return <Locations/>
  if(view==='employees')return <Roles/>
  if(view==='ai')return <AISettings/>
  if(view==='system')return <System/>
  if(view==='manufacturing'||view==='quality')return <Policies focus={view}/>
  if(view==='inventory')return <InventorySettings/>
  return <Business/>
}

const readOnlyNote=(can:boolean)=>!can&&<div className="inline-note warning"><Icon name="lock"/>Faqat ko‘rish: sozlamalarni o‘zgartirish uchun settings.edit ruxsati kerak.</div>

function Business(){
  const app=useApp(),c=app.state.settings.company,canEdit=app.can('settings','edit')
  const form=useForm({name:c.name,currency:c.currency,timezone:c.timezone,taxId:c.taxId},v=>({name:required(v.name,'Kompaniya nomi')}))
  return <div className="page-stack">
    <PageHeader title="Biznes" subtitle="Hujjat, label va hisobotlardagi rekvizitlar"/>
    {readOnlyNote(canEdit)}
    <Card title="Kompaniya">
      <div className="form-grid">
        <Field label="Kompaniya nomi" required error={form.error('name')}><Input disabled={!canEdit} {...form.input('name')}/></Field>
        <Field label="STIR / Tax ID"><Input disabled={!canEdit} {...form.input('taxId')}/></Field>
        <Field label="Asosiy valyuta" hint="Ko‘rsatish valyutasi — topbar’dagi Valyuta"><Input readOnly value="UZS · so‘m"/></Field>
        <Field label="Vaqt zonasi"><Select value={form.values.timezone} disabled={!canEdit} onChange={v=>form.set('timezone',v)}>{['Asia/Tashkent','Asia/Almaty','Europe/Moscow','UTC'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      </div>
      {canEdit&&<div className="form-actions"><button type="button" className="ghost-btn" disabled={!form.dirty} onClick={()=>form.reset()}>Qaytarish</button><button type="button" className="primary-glass-btn" disabled={!form.dirty} onClick={()=>form.submit(v=>{app.saveSettings({company:{...v,name:v.name.trim()}});form.reset(v)})}><Icon name="check" size={16}/>Saqlash</button></div>}
    </Card>
  </div>
}

function Policies({focus}:{focus:string}){
  const app=useApp(),s=app.state,p=s.settings.policies,canEdit=app.can('settings','edit')
  const form=useForm({overheadRate:String(p.overheadRate),machineRatePerHour:String(p.machineRatePerHour),shiftMinutes:String(p.shiftMinutes),poDualApprovalFrom:String(p.poDualApprovalFrom??50000000)},v=>({poDualApprovalFrom:Number(v.poDualApprovalFrom)>=0?undefined:'Manfiy bo‘lmasin',overheadRate:Number(v.overheadRate)>=0&&Number(v.overheadRate)<=200?undefined:'0–200%',machineRatePerHour:Number(v.machineRatePerHour)>=0?undefined:'Manfiy bo‘lmasin',shiftMinutes:Number(v.shiftMinutes)>=60&&Number(v.shiftMinutes)<=1440?undefined:'60–1440 min'}))
  const setPolicy=(patch:Partial<typeof p>)=>app.saveSettings({policies:{...p,...patch}})
  return <div className="page-stack">
    <PageHeader title={focus==='quality'?'Sifat sozlamalari':'Ishlab chiqarish sozlamalari'} subtitle="Engine bevosita qo‘llaydi"/>
    {readOnlyNote(canEdit)}
    <div className="two-col">
      <Card title="Sifat va tasdiq siyosati">
        <Toggle checked={p.requireFinalQc} disabled={!canEdit} onChange={v=>setPolicy({requireFinalQc:v})} label="Final QC majburiy" description="Final Passed bo‘lmaguncha MO yakunlanmaydi"/>
        <Toggle checked={p.autoQualityChecks} disabled={!canEdit} onChange={v=>setPolicy({autoQualityChecks:v})} label="QCP bo‘yicha avtomatik tekshiruv" description="Qabul, QC operatsiya va sifatga yuborishda"/>
        <Toggle checked={p.poDualApproval===true} disabled={!canEdit} onChange={v=>setPolicy({poDualApproval:v})} label="Xaridda ikki kishilik tasdiq" description="Chegaradan yuqori PO’ni uni yaratgan xodim tasdiqlay olmaydi"/>
        <InfoGrid columns={2} items={[{label:'Faol control pointlar',value:s.qualityControlPoints.filter(c=>c.active).length},{label:'Kutilayotgan tekshiruv',value:s.qualityChecks.filter(q=>q.status==='Pending').length}]}/>
      </Card>
      <Card title="Tannarx va capacity">
        <div className="form-grid">
          <Field label="Overhead stavkasi %" error={form.error('overheadRate')}><Input type="number" min="0" disabled={!canEdit} {...form.input('overheadRate')}/></Field>
          <Field label="Default uskuna stavkasi / soat" error={form.error('machineRatePerHour')} hint="WC stavkasi bo‘lmasa"><MoneyInput min="0" disabled={!canEdit} {...form.money('machineRatePerHour')}/></Field>
          <Field label="Ikki kishilik tasdiq chegarasi" error={form.error('poDualApprovalFrom')} hint="PO summasi shundan boshlab"><MoneyInput min="0" disabled={!canEdit||p.poDualApproval!==true} {...form.money('poDualApprovalFrom')}/></Field>
          <Field label="Smena davomiyligi (min)" error={form.error('shiftMinutes')}><Input type="number" min="60" disabled={!canEdit} {...form.input('shiftMinutes')}/></Field>
          <Field label="Default liniya"><Select value={s.settings.defaultLineId} disabled={!canEdit} onChange={v=>app.saveSettings({defaultLineId:v})}>{s.productionLines.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        </div>
        {canEdit&&<div className="form-actions"><button type="button" className="primary-glass-btn" disabled={!form.dirty} onClick={()=>form.submit(v=>{setPolicy({overheadRate:Number(v.overheadRate),machineRatePerHour:Number(v.machineRatePerHour),shiftMinutes:Number(v.shiftMinutes),poDualApprovalFrom:Number(v.poDualApprovalFrom)});form.reset(v)})}>Saqlash</button></div>}
      </Card>
    </div>
  </div>
}

function InventorySettings(){
  const app=useApp(),s=app.state,canEdit=app.can('settings','edit')
  return <div className="page-stack">
    <PageHeader title="Ombor va materiallar" subtitle="Default ombor va zaxira qoidalari"/>
    {readOnlyNote(canEdit)}
    <Card title="Defaultlar">
      <div className="form-grid">
        <Field label="Default ombor (xarid qabuli)"><Select value={s.settings.defaultWarehouseId} disabled={!canEdit} onChange={v=>app.saveSettings({defaultWarehouseId:v})}>{s.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Default filial"><Select value={s.settings.defaultBranchId} disabled={!canEdit} onChange={v=>app.saveSettings({defaultBranchId:v})}>{s.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      </div>
      <InfoGrid columns={3} items={[{label:'Lot kuzatiladigan materiallar',value:s.rawMaterials.filter(m=>m.lotTracking).length},{label:'Expiry kuzatiladigan',value:s.rawMaterials.filter(m=>m.expiryTracking).length},{label:'Manfiy qoldiq',value:<StatusBadge tone="success">Bloklangan</StatusBadge>}]}/>
      <p className="soft-meta">Manfiy qoldiq engine darajasida bloklanadi</p>
    </Card>
  </div>
}

function Appearance(){
  const app=useApp(),s=app.state
  return <div className="page-stack">
    <PageHeader title="Ko‘rinish" subtitle="Topbar bilan bir xil sozlamalar — darhol qo‘llanadi va saqlanadi"/>
    <div className="two-col">
      <Card title="Theme" subtitle={`Hozir: ${app.resolvedTheme==='dark'?'Dark':'Light'}`}><Segmented ariaLabel="Theme" items={[{value:'light',label:'Light'},{value:'dark',label:'Dark'},{value:'system',label:'System'}]} value={s.settings.theme} onChange={v=>app.setTheme(v as ThemeMode)}/></Card>
      <Card title="Valyuta" subtitle="Faqat ko‘rinish — ma’lumotlar so‘mda saqlanadi"><Segmented ariaLabel="Valyuta" items={(['UZS','USD','RUB'] as CurrencyCode[]).map(c=>({value:c,label:`${c} · ${CURRENCIES[c].symbol}`}))} value={s.settings.currency||'UZS'} onChange={v=>app.setCurrency(v as CurrencyCode)}/></Card>
    </div>
    <Card title="Fon">
      <div className="swatch-grid wide">{APPEARANCE_PAIRS.map(p=>{const item=pairFor(p.id,app.resolvedTheme),active=s.settings.appearance===p.id;return <button type="button" key={p.id} role="radio" aria-checked={active} className={`swatch ${active?'active':''}`} onClick={()=>app.setAppearance(p.id)}><span className={`swatch-preview bg-${item.id}`}><i style={{background:item.accent}}/></span><span>{item.name}</span>{active&&<Icon name="check" size={13}/>}</button>})}</div>
    </Card>
    <Card title="O‘qilishi">
      <div className="form-grid">
        <Field label="Shrift o‘lchami"><Select value={s.settings.fontSize} onChange={v=>app.setPreferences({fontSize:v as 'small'|'standard'|'large'})}><option value="small">Kichik</option><option value="standard">Standart</option><option value="large">Katta</option></Select></Field>
      </div>
      <Toggle checked={s.settings.reducedMotion} onChange={v=>app.setPreferences({reducedMotion:v})} label="Animatsiyalarni kamaytirish" description="OS sozlamasi ham hisobga olinadi"/>
    </Card>
  </div>
}

function Notifications(){
  const app=useApp(),n=app.state.settings.notifications,canEdit=app.can('settings','edit')
  const set=(k:keyof typeof n,v:boolean)=>app.saveSettings({notifications:{...n,[k]:v}})
  return <div className="page-stack">
    <PageHeader title="Bildirishnomalar" subtitle="O‘chirilgan tur uchun yangi xabar yaratilmaydi"/>
    {readOnlyNote(canEdit)}
    <Card>
      <Toggle checked={n.lowStock} disabled={!canEdit} onChange={v=>set('lowStock',v)} label="Xomashyo kamayishi" description="Reorder’dan past yoki MO material kutsa"/>
      <Toggle checked={n.quality} disabled={!canEdit} onChange={v=>set('quality',v)} label="Sifat muammolari" description="Failed / Scrap, qaytarishlar"/>
      <Toggle checked={n.maintenance} disabled={!canEdit} onChange={v=>set('maintenance',v)} label="Uskuna va maintenance" description="Downtime, servis"/>
      <Toggle checked={n.delay} disabled={!canEdit} onChange={v=>set('delay',v)} label="Muddat kechikishi"/>
      <Toggle checked={n.ai} disabled={!canEdit} onChange={v=>set('ai',v)} label="AI tavsiyalari"/>
    </Card>
  </div>
}

function Locations(){
  const app=useApp(),s=app.state,navigate=useNavigate(),canEdit=app.can('settings','edit')
  const [branch,setBranch]=useState(false),[line,setLine]=useState(false)
  return <div className="page-stack">
    <PageHeader title="Filial / ombor / liniya" subtitle="Ishlab chiqarish ierarxiyasi"/>
    <div className="three-col">
      <Card title="Filiallar" actions={canEdit&&<button type="button" className="ghost-btn" onClick={()=>setBranch(true)}><Icon name="plus" size={14}/>Qo‘shish</button>}>{s.branches.map(b=><div className="list-row" key={b.id}><span className="list-row-copy"><b>{b.name}</b><small>{b.code}</small></span><StatusBadge>{b.status}</StatusBadge></div>)}</Card>
      <Card title="Omborlar" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/warehouse?view=warehouses')}>Boshqarish <Icon name="chevron" size={13}/></button>}>{s.warehouses.map(w=><div className="list-row" key={w.id}><span className="list-row-copy"><b>{w.name}</b><small>{w.code} · {w.type} · {s.branches.find(b=>b.id===w.branchId)?.name}</small></span><StatusBadge>{w.status}</StatusBadge></div>)}</Card>
      <Card title="Ishlab chiqarish liniyalari" actions={canEdit&&<button type="button" className="ghost-btn" onClick={()=>setLine(true)}><Icon name="plus" size={14}/>Qo‘shish</button>}>{s.productionLines.map(l=><div className="list-row" key={l.id}><span className="list-row-copy"><b>{l.name}</b><small>{l.code} · {l.shift} · {s.workCenters.filter(w=>w.lineId===l.id).length} WC</small></span></div>)}</Card>
    </div>
    {branch&&<SimpleCreate title="Yangi filial" onClose={()=>setBranch(false)} onSave={(name,code)=>app.createEntity('branches',{name,code,status:'Faol'}).ok}/>}
    {line&&<SimpleCreate title="Yangi liniya" withBranch onClose={()=>setLine(false)} onSave={(name,code,branchId)=>app.createEntity('productionLines',{name,code,branchId,shift:'08:00–20:00',capacity:0,utilization:0,status:'Ishlamoqda'}).ok}/>}
  </div>
}

function SimpleCreate({title,withBranch,onClose,onSave}:{title:string;withBranch?:boolean;onClose:()=>void;onSave:(name:string,code:string,branchId:string)=>boolean}){
  const s=useApp().state
  const form=useForm({name:'',code:'',branchId:s.branches[0]?.id||''},v=>({name:required(v.name,'Nomi'),code:required(v.code,'Kod')}))
  return <Modal open onClose={onClose} title={title} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const ok=onSave(v.name.trim(),v.code.trim().toUpperCase(),v.branchId);if(ok)onClose();return ok})}>Saqlash</button></>}>
    <div className="form-stack"><Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field><Field label="Kod" required error={form.error('code')}><Input {...form.input('code')}/></Field>{withBranch&&<Field label="Filial"><Select value={form.values.branchId} onChange={v=>form.set('branchId',v)}>{s.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}</div>
  </Modal>
}

function Roles(){
  const s=useApp().state,navigate=useNavigate()
  return <div className="page-stack">
    <PageHeader title="Xodimlar va rollar" subtitle="Ruxsatlar matritsada tahrirlanadi" actions={<button type="button" className="primary-glass-btn" onClick={()=>navigate('/admin?view=roles')}><Icon name="lock"/>Ruxsat matritsasi</button>}/>
    <div className="card-grid">{s.roles.map(r=><Card key={r.id} title={r.name} subtitle={`Scope: ${r.scope} · ${s.employees.filter(e=>e.roleId===r.id).length} xodim`}><div className="badge-row">{Object.entries(r.permissions).filter(([,p])=>p.view).map(([m,p])=><StatusBadge key={m} tone={p.edit?'success':'info'}>{m}{p.edit?'':' (ko‘rish)'}</StatusBadge>)}</div></Card>)}</div>
  </div>
}

function AISettings(){
  const app=useApp(),ai=app.state.settings.ai,canEdit=app.can('settings','edit')
  return <div className="page-stack">
    <PageHeader title="ZENIX AI" subtitle="Qoidaga asoslangan · ma’lumot tashqariga yuborilmaydi"/>
    {readOnlyNote(canEdit)}
    <Card><Toggle checked={ai.enabled} disabled={!canEdit} onChange={v=>app.saveSettings({ai:{...ai,enabled:v}})} label="ZENIX AI yoqilgan" description="O‘chirilsa AI tugmasi va paneli yashiriladi"/></Card>
  </div>
}

const BACKUP_REASON:Record<string,string>={'manual-reset':'tranzaksiyalarni tozalashdan oldin','demo-history-cleanup':'demo tarixni tozalashdan oldin','before-import':'backup importdan oldin','before-restore':'zaxirani tiklashdan oldin'}

function System(){
  const app=useApp(),s=app.state
  const [reset,setReset]=useState(false),[importData,setImportData]=useState<unknown>(null),[importName,setImportName]=useState(''),[restore,setRestore]=useState(false)
  // Parsed only when the data changes (a restore or reset writes a new copy), not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const backup=useMemo(()=>app.lastBackup(),[s])
  const fileRef=useRef<HTMLInputElement>(null)
  const size=new Blob([JSON.stringify(s)]).size
  const canEdit=app.can('settings','edit')
  const exportBackup=()=>{if(!app.can('settings','export')){app.toast('Backup eksport uchun ruxsat yo‘q','danger');return}downloadText(`zenix-backup-${todayISO()}.json`,JSON.stringify(s,null,2),'application/json');app.toast('Backup fayli yuklab olindi')}
  const onFile=async(file?:File)=>{if(!file)return;try{setImportData(JSON.parse(await file.text()));setImportName(file.name)}catch{app.toast('Fayl JSON formatida emas','danger')}finally{if(fileRef.current)fileRef.current.value=''}}
  return <div className="page-stack">
    <PageHeader title="Tizim" subtitle="Holat, backup va ma’lumotlarni tozalash"/>
    <div className="two-col">
      <Card title="Holat">
        <div className="stack-list">
          <div className="list-row"><span className="list-row-copy"><b>Frontend</b><small>React 19 · client rendering</small></span><StatusBadge tone="success">Ishlamoqda</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Brauzer xotirasi (localStorage)</b><small>{fileSize(size)} / ~5 MB</small></span><StatusBadge tone={size>4e6?'danger':size>2.5e6?'warning':'success'}>{Math.round(size/5e6*100)}%</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Backend API</b><small>Integratsiya nuqtasi: domain/actions.ts → REST</small></span><StatusBadge tone="neutral">Ulanmagan</StatusBadge></div>
        </div>
        <InfoGrid columns={3} items={[{label:'MO',value:s.productionOrders.length},{label:'Harakatlar',value:s.stockMovements.length},{label:'Audit yozuvlari',value:s.activity.length}]}/>
      </Card>
      <Card title="Backup va ma’lumotlar">
        <p className="soft-meta">JSON backup · import joriy ma’lumotni almashtiradi</p>
        <div className="row-actions">
          <button type="button" className="secondary-glass-btn" disabled={!app.can('settings','export')} title={app.can('settings','export')?undefined:'Backup eksport uchun settings.export ruxsati kerak'} onClick={exportBackup}><Icon name="download"/>Backup eksport</button>
          <button type="button" className="secondary-glass-btn" disabled={!canEdit} onClick={()=>fileRef.current?.click()}><Icon name="upload"/>Backup import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e=>void onFile(e.target.files?.[0])}/>
          <button type="button" className="danger-glass-btn" disabled={!canEdit} onClick={()=>setReset(true)}><Icon name="refresh"/>Tranzaksiyalarni tozalash</button>
        </div>
        {backup?.savedAt&&<div className="list-row"><span className="list-row-copy"><b>Oxirgi avtomatik zaxira</b><small>{backup.savedAt} · {BACKUP_REASON[backup.reason||'']||backup.reason}</small></span><button type="button" className="secondary-glass-btn compact" disabled={!canEdit} onClick={()=>setRestore(true)}><Icon name="undo" size={14}/>Tiklash</button></div>}
      </Card>
    </div>
    <Confirm open={reset} onClose={()=>setReset(false)} onConfirm={app.resetTransactions} danger title="Tranzaksiyalar tozalansinmi?" text="Buyurtmalar, qoldiq va harakatlar, xaridlar, savdo, sifat, servis, xarajatlar, bildirishnomalar va audit tarixi o‘chiriladi. Mahsulot, BOM, xomashyo, supplier, ombor, uskuna, xodim, rol va sozlamalar saqlanadi. Avval Backup eksport qiling." confirmText="Tozalash"/>
    <Confirm open={restore} onClose={()=>setRestore(false)} onConfirm={app.restoreLastBackup} danger title="Oxirgi zaxira tiklansinmi?" text="Joriy ma’lumot zaxira bilan almashtiriladi; hozirgi holat esa yangi zaxira sifatida saqlanadi (qaytarish mumkin)." confirmText="Tiklash"/>
    <Confirm open={importData!==null} onClose={()=>setImportData(null)} onConfirm={()=>app.importState(importData)} danger title="Backup import qilinsinmi?" text={`${importName} fayli joriy ma’lumotlarni to‘liq almashtiradi.`} confirmText="Import qilish"/>
  </div>
}
