// Units of measure (audit #24): the one conversion service every module uses. Stock, the ledger, reservations and
// MRP always work in an item's stock unit; documents may be entered in another unit of the same dimension (kg ↔ g,
// l ↔ ml, m ↔ cm) or in a pack unit the item itself defines (quti = 24 dona). Nothing is ever guessed: a unit of
// another dimension, or a pack without its factor, is refused with a message.
import type {PackUnit} from '../types'

export type Dimension='mass'|'volume'|'length'|'count'
/** `factor` = base units (g, ml, mm, piece) in one unit — integers, so conversions do not accumulate float drift. */
export type UnitDef={code:string;label:string;dimension:Dimension;factor:number;decimals:number;aliases:string[]}

export const UNITS:UnitDef[]=[
  {code:'g',label:'gramm',dimension:'mass',factor:1,decimals:3,aliases:['gr']},
  {code:'kg',label:'kilogramm',dimension:'mass',factor:1000,decimals:3,aliases:[]},
  {code:'t',label:'tonna',dimension:'mass',factor:1_000_000,decimals:3,aliases:['tonna']},
  {code:'ml',label:'millilitr',dimension:'volume',factor:1,decimals:3,aliases:[]},
  {code:'l',label:'litr',dimension:'volume',factor:1000,decimals:3,aliases:['litr','L']},
  {code:'mm',label:'millimetr',dimension:'length',factor:1,decimals:3,aliases:[]},
  {code:'cm',label:'santimetr',dimension:'length',factor:10,decimals:3,aliases:[]},
  {code:'m',label:'metr',dimension:'length',factor:1000,decimals:3,aliases:['metr']},
  {code:'dona',label:'dona',dimension:'count',factor:1,decimals:0,aliases:['pcs','piece','ta']},
]

const norm=(u?:string)=>String(u??'').trim()
/** The registered unit for a code or alias; pack units (quti, paket …) are not registered — they need an item factor. */
export function unitDef(code?:string):UnitDef|undefined{
  const c=norm(code)
  if(!c)return undefined
  const lower=c.toLowerCase()
  return UNITS.find(u=>u.code===lower||u.aliases.some(a=>a.toLowerCase()===lower))
}

export type UomItem={name?:string;unit:string;packs?:PackUnit[]}
export type Converted={value:number;factor:number}|{error:string}

/** Rounds to `decimals` places half-up, through an integer so 0.1 + 0.2 style noise never reaches stored data. */
export function roundQty(n:number,decimals=3){
  const p=10**decimals
  return Math.round((n+Math.sign(n)*Number.EPSILON)*p)/p
}

/**
 * Stock units in one `fromUnit` of an item: 1 for its own unit, the registry ratio for a unit of the same dimension,
 * the item's own pack factor for a pack unit. Anything else is an error — a box is never assumed to hold N pieces.
 */
export function unitFactor(item:UomItem,fromUnit?:string):{factor:number}|{error:string}{
  const from=norm(fromUnit)||item.unit
  const label=item.name?`${item.name}: `:''
  if(from===item.unit)return {factor:1}
  const pack=(item.packs||[]).find(p=>norm(p.unit)===from)
  if(pack){
    if(!Number.isFinite(pack.factor)||pack.factor<=0)return {error:`${label}“${from}” uchun konversiya koeffitsiyenti noto‘g‘ri`}
    return {factor:pack.factor}
  }
  const a=unitDef(from),b=unitDef(item.unit)
  if(!a)return {error:`${label}“${from}” birligi uchun konversiya koeffitsiyenti yo‘q — mahsulot/material kartasida qadoq birligini kiriting`}
  if(!b)return {error:`${label}ombor birligi “${item.unit}” ro‘yxatda yo‘q — faqat o‘z birligida yoki qadoq koeffitsiyenti bilan kiritiladi`}
  if(a.dimension!==b.dimension)return {error:`${label}${from} → ${item.unit} konversiyasi mumkin emas (${a.label} va ${b.label} turli o‘lchov)`}
  return {factor:a.factor/b.factor}
}

/**
 * `qty` given in `fromUnit`, in the item's stock unit (or in `toUnit` of the same item). Strict by default: a result
 * that needs more decimals than the target unit allows is refused, never rounded away; 'half-up' rounds (display).
 */
export function convertQty(item:UomItem,qty:number,fromUnit?:string,toUnit?:string,rounding:'strict'|'half-up'='strict'):Converted{
  if(typeof qty!=='number'||!Number.isFinite(qty))return {error:'Miqdor son bo‘lishi kerak'}
  const f=unitFactor(item,fromUnit)
  if('error' in f)return f
  const t=unitFactor(item,toUnit)
  if('error' in t)return t
  const factor=f.factor/t.factor
  const target=norm(toUnit)||item.unit
  const decimals=unitDecimalsOf(target,item)
  // The product is formed on integers of the source precision, so 1.234 kg → 1234 g exactly.
  const raw=Math.round(qty*1e6)*factor/1e6
  const value=roundQty(raw,decimals)
  if(rounding==='strict'&&Math.abs(value-raw)>1e-9)return {error:`${roundQty(raw,6)} ${target} — ${target} birligida ${decimals} xonadan ortiq kasr bo‘lmaydi`}
  return {value,factor}
}

/** Decimal places of a unit: registered units their own, a pack of a counted item whole, everything else 3. */
export function unitDecimalsOf(unit:string,item?:UomItem){
  const def=unitDef(unit)
  if(def)return def.decimals
  if(item&&(item.packs||[]).some(p=>norm(p.unit)===norm(unit)))return 0
  return 3
}

/** UZS per `toUnit` from a price per `fromUnit` (a price follows the quantity conversion the other way). */
export function convertUnitCost(item:UomItem,price:number,fromUnit?:string,toUnit?:string):{value:number}|{error:string}{
  const f=unitFactor(item,fromUnit)
  if('error' in f)return f
  const t=unitFactor(item,toUnit)
  if('error' in t)return t
  return {value:Math.round(price/f.factor*t.factor*1e6)/1e6}
}

/** Units an item can be entered in: its stock unit, the registered units of the same dimension and its pack units. */
export function unitOptions(item:UomItem):string[]{
  const own=unitDef(item.unit)
  const same=own?UNITS.filter(u=>u.dimension===own.dimension&&u.code!==own.code).map(u=>u.code):[]
  return [...new Set([item.unit,...same,...(item.packs||[]).map(p=>p.unit)])]
}

/** Why an item's pack definitions cannot be saved, or null. Factors are stock units per pack; counted items need whole factors. */
export function packsProblem(item:UomItem):string|null{
  const seen=new Set<string>()
  for(const p of item.packs||[]){
    const unit=norm(p.unit)
    if(!unit)return 'Qadoq birligi nomini kiriting'
    if(unit===item.unit)return `Qadoq birligi (${unit}) ombor birligi bilan bir xil bo‘lmasin`
    if(unitDef(unit))return `${unit} standart birlik — uning konversiyasi avtomatik, qadoq sifatida kiritilmaydi`
    if(seen.has(unit))return `${unit} qadoq birligi ikki marta kiritilgan`
    seen.add(unit)
    if(typeof p.factor!=='number'||!Number.isFinite(p.factor)||p.factor<=0)return `${unit}: koeffitsiyent musbat son bo‘lishi kerak`
    if(p.factor>1e6)return `${unit}: koeffitsiyent juda katta`
    if(unitDecimalsOf(item.unit)===0&&!Number.isInteger(p.factor))return `${unit}: ${item.unit} butun sanaladi — koeffitsiyent butun son bo‘lishi kerak`
  }
  return null
}

/** A quantity with its unit for display, e.g. "2 quti (48 dona)". */
export function describeQty(item:UomItem,qty:number,unit?:string){
  const u=norm(unit)||item.unit
  if(u===item.unit)return `${qty} ${u}`
  const c=convertQty(item,qty,u,item.unit,'half-up')
  return 'error' in c?`${qty} ${u}`:`${qty} ${u} (${c.value} ${item.unit})`
}
