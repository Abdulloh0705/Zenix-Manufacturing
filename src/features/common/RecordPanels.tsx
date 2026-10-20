import {useRef,useState} from 'react'
import type {DragEvent} from 'react'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {Confirm,Empty,Icon,Timeline} from '../../shared/ui'
import type {Attachment} from '../../types'
import {fileSize,relativeTime} from '../../utils/format'

const MAX_INLINE=256*1024

function readAsDataUrl(file:File){
  return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(file)})
}

async function downloadAttachment(a:Attachment){
  if(!a.dataUrl)return
  const blob=await (await fetch(a.dataUrl)).blob()
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=a.name;document.body.appendChild(link);link.click();link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function AttachmentsPanel({entityType,entityId,canEdit=true}:{entityType:string;entityId:string;canEdit?:boolean}){
  const app=useApp()
  const files=app.state.attachments.filter(a=>a.entityType===entityType&&a.entityId===entityId)
  const inputRef=useRef<HTMLInputElement>(null)
  const [dragging,setDragging]=useState(false),[remove,setRemove]=useState<Attachment|null>(null)
  const add=async(list:FileList|null)=>{
    if(!list)return
    for(const file of Array.from(list)){
      let dataUrl:string|undefined
      if(file.size<=MAX_INLINE){try{dataUrl=await readAsDataUrl(file)}catch{dataUrl=undefined}}
      const r=app.addAttachment({entityType,entityId,name:file.name,size:file.size,mime:file.type||'application/octet-stream',dataUrl})
      if(r.ok&&!dataUrl)app.toast(`${file.name} (${fileSize(file.size)}): demo’da faqat metadata saqlandi — 256 KB dan katta fayl brauzer xotirasiga sig‘maydi`,'info')
    }
    if(inputRef.current)inputRef.current.value=''
  }
  const drop=(e:DragEvent)=>{e.preventDefault();setDragging(false);if(canEdit)void add(e.dataTransfer.files)}
  return <div className="attachments">
    {canEdit&&<div className={`dropzone ${dragging?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={drop}>
      <Icon name="upload" size={18}/><div><b>Faylni tashlang</b><small>PDF, rasm, chizma · 256 KB gacha</small></div>
      <button type="button" className="secondary-glass-btn compact" onClick={()=>inputRef.current?.click()}><Icon name="paperclip" size={15}/>Fayl tanlash</button>
      <input ref={inputRef} type="file" multiple hidden onChange={e=>void add(e.target.files)}/>
    </div>}
    {files.length?<ul className="file-list">{files.map(f=><li key={f.id}>
      <span className="file-icon"><Icon name="file" size={16}/></span>
      <span className="file-copy"><b>{f.name}</b><small>{fileSize(f.size)} · {f.addedBy} · {relativeTime(f.addedAt)}{!f.dataUrl&&' · faqat metadata'}</small></span>
      <button type="button" className="icon-ghost" disabled={!f.dataUrl} title={f.dataUrl?'Yuklab olish':'Fayl mazmuni demo’da saqlanmagan'} aria-label={`${f.name} — yuklab olish`} onClick={()=>void downloadAttachment(f)}><Icon name="download" size={15}/></button>
      {canEdit&&<button type="button" className="icon-ghost danger" aria-label={`${f.name} — o‘chirish`} onClick={()=>setRemove(f)}><Icon name="trash" size={15}/></button>}
    </li>)}</ul>:<Empty compact icon="file" title="Hujjat biriktirilmagan" text={undefined}/>}
    <Confirm open={!!remove} onClose={()=>setRemove(null)} onConfirm={()=>remove&&app.removeAttachment(remove.id)} danger title="Hujjatni o‘chirasizmi?" text={`${remove?.name} yozuvdan olib tashlanadi.`} confirmText="O‘chirish"/>
  </div>
}

export function ActivityPanel({sources}:{sources:string[]}){
  const app=useApp()
  const keys=new Set(sources.filter(Boolean))
  const items=app.state.activity.filter(a=>a.source&&keys.has(a.source)).slice(0,40)
  return <Timeline items={items.map(a=>({title:a.action,meta:<>{a.user}{a.detail?` · ${a.detail}`:''}</>,time:a.date,tone:a.severity==='danger'?'danger':a.severity==='warning'?'warning':a.severity==='success'?'success':'info'}))}/>
}
