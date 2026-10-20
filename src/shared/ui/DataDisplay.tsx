import type {ReactNode} from 'react'
import {Icon} from './Icon'

export type Tone='success'|'warning'|'danger'|'info'|'neutral'|'purple'|'mfg'

// Explicit mapping for every workflow status used in the product; substring rules are only a fallback.
const TONES:Record<string,Tone>={
  'Qoralama':'neutral','Tasdiqlangan':'info','Material kutilmoqda':'warning','Jarayonda':'mfg','Pauzada':'warning','Sifat nazoratida':'purple','Yakunlangan':'success','Bekor qilingan':'danger',
  'Kutilmoqda':'neutral','Tayyor':'success','Yo‘lda':'info','Qisman qabul':'warning','Qabul qilindi':'success','Bekor':'danger','Yangi':'info','Ishlab chiqarishda':'mfg','Yetkazildi':'success',
  'Pending':'warning','Passed':'success','Failed':'danger','Rework':'warning','Scrap':'danger',
  'Ochiq':'danger','Yopilgan':'success','Past':'neutral','Normal':'neutral','O‘rta':'warning','Yuqori':'warning','Kritik':'danger',
  'Faol':'success','Arxiv':'neutral','Draft':'neutral','Review':'info','Approved':'purple','Applied':'success','Rejected':'danger',
  'Ishlamoqda':'success','Servis yaqin':'warning','To‘xtagan':'danger','Rejada':'info','Diagnostika':'info','Ta’mirda':'warning','Sinov':'purple',
  'Inspection':'warning','Omborga qaytarildi':'success','Material yuborildi':'info','Make-to-stock':'info','Make-to-order':'purple',
  'To‘langan':'success','To‘lanmagan':'danger','Qisman':'warning','Smenada':'success','Ready':'success','Shortage':'danger','Covered':'success','Overloaded':'danger',
}
export function toneOf(value:string):Tone{
  if(TONES[value])return TONES[value]
  const v=value.toLowerCase()
  if(['yakun','passed','faol','tayyor','ready','ok','matched','covered','done'].some(x=>v.includes(x)))return 'success'
  if(['fail','bekor','scrap','short','kritik','overload','to‘xtagan','danger'].some(x=>v.includes(x)))return 'danger'
  if(['kutil','kam','rework','risk','pauza','low','yaqin','warning','kech'].some(x=>v.includes(x)))return 'warning'
  if(['jarayon','tasdiq','yangi','plan','info'].some(x=>v.includes(x)))return 'info'
  return 'neutral'
}

export function StatusBadge({children,tone}:{children:ReactNode;tone?:Tone}){
  const text=String(children??'')
  return <span className={`status-badge ${tone||toneOf(text)}`}>{children}</span>
}

export function Empty({title='Ma’lumot yo‘q',text='Hozircha yozuv mavjud emas.',action,icon='box',compact}:{title?:string;text?:ReactNode;action?:ReactNode;icon?:string;compact?:boolean}){
  return <div className={`empty ${compact?'compact':''}`} role="status"><span className="empty-icon"><Icon name={icon} size={compact?18:22}/></span><b>{title}</b>{text&&<span>{text}</span>}{action&&<div className="empty-action">{action}</div>}</div>
}

export function Progress({value,toneName='mfg',label}:{value:number;toneName?:string;label?:string}){
  const v=Math.max(0,Math.min(100,Number.isFinite(value)?value:0))
  return <div className={`progress-bar ${toneName}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}><span style={{width:`${v}%`}}/></div>
}

export function MetricBar({label,value,max=100,caption,tone}:{label:ReactNode;value:number;max?:number;caption?:ReactNode;tone?:string}){
  const pct=max?value/max*100:0
  return <div className="metric-line"><div><span>{label}</span><b>{caption??`${Math.round(value)}%`}</b></div><Progress value={pct} toneName={tone||(pct>100?'danger':'accent')} label={typeof label==='string'?label:undefined}/></div>
}

export function Timeline({items}:{items:Array<{title:ReactNode;time?:string;meta?:ReactNode;tone?:Tone}>}){
  if(!items.length)return <Empty compact title="Tarix bo‘sh" text="Bu yozuv bo‘yicha hali hodisa yo‘q."/>
  return <ol className="timeline">{items.map((x,i)=><li key={i} className={`tone-${x.tone||'info'}`}><i aria-hidden="true"/><div><b>{x.title}</b>{x.meta&&<span>{x.meta}</span>}</div>{x.time&&<time>{x.time}</time>}</li>)}</ol>
}

export function ListRow({title,subtitle,children,onClick,leading}:{title:ReactNode;subtitle?:ReactNode;children?:ReactNode;onClick?:()=>void;leading?:ReactNode}){
  const body=<>{leading}<span className="list-row-copy"><b>{title}</b>{subtitle&&<small>{subtitle}</small>}</span>{children&&<span className="list-row-meta">{children}</span>}</>
  if(onClick)return <button type="button" className="list-row is-clickable" onClick={onClick}>{body}<Icon name="chevron" size={13} className="list-row-chevron"/></button>
  return <div className="list-row">{body}</div>
}
