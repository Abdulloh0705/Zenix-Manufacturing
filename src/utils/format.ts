import {isAmbiguousStamp,parseDate} from './dates'


const decimalFormat=new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:1})

/* -------------------------------------------------------------------------------------------------
 * Currency — the single conversion + formatting layer.
 * Every stored amount is in the base currency (UZS). Only presentation converts, so switching the
 * display currency never touches data. Rates are fixed demo rates (UZS per 1 unit).
 * -----------------------------------------------------------------------------------------------*/
export type CurrencyCode='UZS'|'USD'|'RUB'
export const BASE_CURRENCY:CurrencyCode='UZS'
export const CURRENCIES:Record<CurrencyCode,{code:CurrencyCode;label:string;symbol:string;rate:number;digits:number;prefix:boolean}>={
  UZS:{code:'UZS',label:'O‘zbek so‘mi',symbol:'so‘m',rate:1,digits:0,prefix:false},
  USD:{code:'USD',label:'AQSh dollari',symbol:'$',rate:12650,digits:2,prefix:true},
  RUB:{code:'RUB',label:'Rossiya rubli',symbol:'₽',rate:155,digits:2,prefix:false},
}
let displayCurrency:CurrencyCode='UZS'
/** Set once per render by AppProvider from the persisted preference. */
export const setDisplayCurrency=(code:CurrencyCode)=>{displayCurrency=CURRENCIES[code]?code:'UZS'}
export const getDisplayCurrency=()=>displayCurrency
export const currencyMeta=(code:CurrencyCode=displayCurrency)=>CURRENCIES[code]
/** Base (UZS) → display currency. */
export const toDisplay=(base:number,code:CurrencyCode=displayCurrency)=>(Number(base)||0)/CURRENCIES[code].rate
/** Display currency → base (UZS), rounded to whole so‘m so stored values stay integers. */
export const fromDisplay=(value:number,code:CurrencyCode=displayCurrency)=>Math.round((Number(value)||0)*CURRENCIES[code].rate)
const withSymbol=(text:string,meta:typeof CURRENCIES[CurrencyCode])=>meta.prefix?`${meta.symbol}${text}`:`${text} ${meta.symbol}`

export const money=(value:number)=>{
  const meta=CURRENCIES[displayCurrency],v=toDisplay(value)
  const abs=Math.abs(v),digits=meta.digits&&abs<1000?meta.digits:0
  const text=new Intl.NumberFormat('uz-UZ',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(abs)
  return `${v<0?'−':''}${withSymbol(text,meta)}`
}
/** An amount already in `code` (e.g. a supplier quote) — formatted, never converted. */
export const quoteMoney=(value:number,code:CurrencyCode)=>{
  const meta=CURRENCIES[code]||CURRENCIES.UZS
  return withSymbol(new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:meta.digits}).format(Number(value)||0),meta)
}
/** Short money (“48,2 mln so‘m”); `symbol:false` drops the currency for side-by-side figures. */
export const compactMoney=(value:number,{symbol=true}:{symbol?:boolean}={})=>{
  const meta=CURRENCIES[displayCurrency]
  const raw=toDisplay(value),v=Math.abs(raw),sign=raw<0?'−':''
  const text=v>=1e9?`${decimalFormat.format(v/1e9)} mlrd`:v>=1e6?`${decimalFormat.format(v/1e6)} mln`:v>=1e3?`${decimalFormat.format(v/1e3)} ming`:new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:meta.digits&&v<100?meta.digits:0}).format(v)
  return `${sign}${symbol?withSymbol(text,meta):meta.prefix?`${meta.symbol}${text}`:text}`
}
export const num=(value:number,digits=0)=>new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:digits}).format(Number.isFinite(value)?value:0)
export const qty=(value:number,unit='',digits?:number)=>`${num(value,digits??(Math.abs(value)<10&&value%1?1:0))}${unit?` ${unit}`:''}`
/** Short duration for tight figures: “1,3 soat” from an hour up, “45 min” below. */
export const compactDuration=(minutes:number)=>minutes>=60?`${num(minutes/60,1)} soat`:`${Math.round(minutes)} min`
export const percent=(value:number)=>`${Math.round(Number.isFinite(value)?value:0)}%`
export const signed=(value:number,formatter:(v:number)=>string=v=>num(v))=>`${value>0?'+':value<0?'−':''}${formatter(Math.abs(value))}`
export const cls=(...parts:Array<string|false|undefined|null>)=>parts.filter(Boolean).join(' ')

export function relativeTime(value?:string,now=new Date()){
  if(!value)return '—'
  if(!/^\d{4}-\d{2}-\d{2}/.test(value))return value
  // Written around a company zone change: how long ago it was is not known to the hour — the stored text is shown.
  if(isAmbiguousStamp(value))return `${value} (vaqt noaniq)`
  const diff=Math.round((now.getTime()-parseDate(value).getTime())/60000)
  if(diff<1)return 'hozirgina'
  if(diff<60)return `${diff} daqiqa oldin`
  if(diff<24*60)return `${Math.floor(diff/60)} soat oldin`
  if(diff<48*60)return 'kecha'
  if(diff<7*24*60)return `${Math.floor(diff/1440)} kun oldin`
  return value.slice(0,10)
}

export function fileSize(bytes:number){
  if(bytes>=1024*1024)return `${decimalFormat.format(bytes/1024/1024)} MB`
  if(bytes>=1024)return `${Math.round(bytes/1024)} KB`
  return `${bytes} B`
}

export function initials(name:string){
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join('').toUpperCase()
}
