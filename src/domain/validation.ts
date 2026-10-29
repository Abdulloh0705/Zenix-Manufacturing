// Input checks every domain command applies before it touches state: numbers are finite, inside business
// bounds and in the precision their unit allows; dates are real calendar dates. Nothing is floored, clamped
// or rounded here — a value that does not fit is refused with a message, so stored data means what was typed.
import type {ManufacturingState} from '../types'

/** Largest quantity one document line, count or adjustment may carry (stock units). */
export const MAX_QUANTITY=1e9
/** Largest money amount (UZS) one price or cost may carry; keeps totals far inside Number.MAX_SAFE_INTEGER. */
export const MAX_MONEY=1e12
/** Decimal places a quantity in a divisible unit (kg, m, l …) may have — the precision the ledger keeps (q3). */
export const QTY_DECIMALS=3
/** Units counted in whole pieces: a fractional quantity in them is an entry error, never rounded. */
export const COUNT_UNITS=['dona','ta','pcs','komplekt','list','quti','paket','rulon']

export type Checked={value:number}|{error:string}

/** A number from user input: finite numbers and numeric text only. Blank, NaN, ±Infinity and anything else → null. */
export function readNumber(v:unknown):number|null{
  if(typeof v==='number')return Number.isFinite(v)?v:null
  if(typeof v!=='string'||!v.trim())return null
  const n=Number(v.trim())
  return Number.isFinite(n)?n:null
}

const blank=(v:unknown)=>v===undefined||v===null||(typeof v==='string'&&!v.trim())

/** Decimal places allowed for a unit: 0 for counted units, QTY_DECIMALS otherwise. */
export const unitDecimals=(unit?:string)=>COUNT_UNITS.includes(String(unit||'').trim().toLowerCase())?0:QTY_DECIMALS

/**
 * Decimal places allowed for an item's stock quantity: serial-tracked products are whole pieces whatever their
 * unit, everything else follows its unit. An unknown item gets the strict rule (whole units).
 */
export function itemDecimals(s:Pick<ManufacturingState,'products'|'rawMaterials'>,key:string){
  // A stock key of a variant (productId~variantId) counts like its product.
  const itemId=key.split('~')[0]
  const product=s.products.find(p=>p.id===itemId)
  if(product)return product.tracking==='serial'?0:unitDecimals(product.unit)
  const material=s.rawMaterials.find(m=>m.id===itemId)
  return material?(material.serialTracking?0:unitDecimals(material.unit)):0
}

const fitsDecimals=(n:number,decimals:number)=>{
  const scaled=n*10**decimals
  return Math.abs(scaled-Math.round(scaled))<=1e-6*Math.max(1,Math.abs(scaled))
}

export type QuantityRule={label?:string;unit?:string;decimals?:number;
  /** 0 is a valid value (e.g. scrap next to good output). */
  allowZero?:boolean;
  /** A blank entry means 0 (an optional field left empty); never for counts, where blank is not a count. */
  blankAsZero?:boolean;
  /** Negative values are allowed (signed corrections); 0 still needs allowZero. */
  signed?:boolean;max?:number}

/** A quantity: finite, positive (or ≥ 0 / signed when the rule says so), ≤ max, in the unit's precision. */
export function checkQuantity(v:unknown,rule:QuantityRule={}):Checked{
  const label=rule.label||'Miqdor',decimals=rule.decimals??QTY_DECIMALS,max=rule.max??MAX_QUANTITY
  if(rule.blankAsZero&&blank(v))return {value:0}
  const n=readNumber(v)
  if(n===null)return {error:`${label}: son kiriting (bo‘sh, NaN yoki cheksiz qiymat qabul qilinmaydi)`}
  if(n===0&&!rule.allowZero)return {error:rule.signed?`${label} 0 bo‘lmasligi kerak`:`${label} 0 dan katta bo‘lishi kerak`}
  if(n<0&&!rule.signed)return {error:rule.allowZero?`${label} manfiy bo‘lishi mumkin emas`:`${label} 0 dan katta bo‘lishi kerak`}
  if(Math.abs(n)>max)return {error:`${label} juda katta (${n}); ruxsat etilgan chegara ${max}`}
  if(!fitsDecimals(n,decimals))return {error:decimals===0?`${label}: ${rule.unit?`${rule.unit} — `:''}butun son bo‘lishi kerak (${n})`:`${label}: ko‘pi bilan ${decimals} ta kasr xona (${n})`}
  return {value:n}
}

/** A price or cost in UZS: finite, ≥ 0 (or > 0 when zero is not allowed), ≤ MAX_MONEY, at most 2 decimals. */
export function checkMoney(v:unknown,label='Narx',allowZero=true):Checked{
  const n=readNumber(v)
  if(n===null)return {error:`${label}: son kiriting (bo‘sh, NaN yoki cheksiz qiymat qabul qilinmaydi)`}
  if(n<0)return {error:`${label} manfiy bo‘lishi mumkin emas`}
  if(n===0&&!allowZero)return {error:`${label} 0 dan katta bo‘lishi kerak`}
  if(n>MAX_MONEY)return {error:`${label} juda katta (${n})`}
  if(!fitsDecimals(n,2))return {error:`${label}: ko‘pi bilan 2 ta kasr xona (${n})`}
  return {value:n}
}

const ISO_DAY=/^(\d{4})-(\d{2})-(\d{2})$/
const ISO_STAMP=/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/
const daysIn=(y:number,m:number)=>m===2?(y%4===0&&(y%100!==0||y%400===0)?29:28):[4,6,9,11].includes(m)?30:31

/** A real calendar day `YYYY-MM-DD` (2026-02-30, 2026-99-99 are refused); pure arithmetic, no timezone involved. */
export function isIsoDate(v:unknown):v is string{
  if(typeof v!=='string')return false
  const m=ISO_DAY.exec(v)
  if(!m)return false
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3])
  return y>=1900&&y<=9999&&mo>=1&&mo<=12&&d>=1&&d<=daysIn(y,mo)
}

/** A real local timestamp `YYYY-MM-DD HH:mm` (hours 00–23, minutes 00–59). */
export function isIsoStamp(v:unknown):v is string{
  if(typeof v!=='string')return false
  const m=ISO_STAMP.exec(v)
  return Boolean(m)&&isIsoDate(m![1])&&Number(m![2])<=23&&Number(m![3])<=59
}

/** Message for an optional date field: null when absent or valid. */
export const dateProblem=(v:unknown,label:string)=>blank(v)||isIsoDate(v)?null:`${label} noto‘g‘ri sana: ${String(v)} (YYYY-MM-DD, haqiqiy kalendar kuni)`

/** Master data that is archived stays readable in history but takes no new transactions. */
export const isArchived=(row:{status?:unknown}|undefined)=>row?.status==='Arxiv'
