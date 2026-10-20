// Local-calendar date helpers. Dates are stored as `YYYY-MM-DD` (local day) and
// timestamps as `YYYY-MM-DD HH:mm` so they sort lexically and never shift by timezone.

const DAY_MS=864e5
const pad=(n:number)=>String(n).padStart(2,'0')

export function isoDate(d:Date=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

export function stamp(d:Date=new Date()){
  return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseDate(value:string){
  const [y,m,d]=value.slice(0,10).split('-').map(Number)
  const time=value.length>10?value.slice(11,16).split(':').map(Number):[0,0]
  return new Date(y,(m||1)-1,d||1,time[0]||0,time[1]||0)
}

export function addDays(value:string,days:number){
  const d=parseDate(value)
  d.setDate(d.getDate()+days)
  return isoDate(d)
}

export function daysBetween(from:string,to:string){
  return Math.round((parseDate(to.slice(0,10)).getTime()-parseDate(from.slice(0,10)).getTime())/DAY_MS)
}

export function minutesBetween(from:string,to:string){
  return Math.max(0,Math.round((parseDate(to).getTime()-parseDate(from).getTime())/60000))
}

export function todayISO(){
  return isoDate(new Date())
}

/** First day of "the last N days" (N calendar days including today) — the one period rule for filters and KPIs. */
export function periodStart(days:number,today=todayISO()){
  return addDays(today,-(Math.max(1,Math.round(days))-1))
}

/** Monday of the week that contains `value`. */
export function weekStart(value:string){
  const d=parseDate(value)
  const shift=(d.getDay()+6)%7
  d.setDate(d.getDate()-shift)
  return isoDate(d)
}

export function compactCode(d:Date=new Date()){
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}`
}

// Explicit Uzbek names: browsers ship incomplete 'uz-UZ' locale data (e.g. "M09 27, Sun").
const WEEKDAYS=['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']
const WEEKDAYS_SHORT=['Ya','Du','Se','Ch','Pa','Ju','Sh']
const MONTHS_LONG=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
export const weekdayShort=(value:string)=>WEEKDAYS_SHORT[parseDate(value).getDay()]
export const longDate=(d:Date=new Date())=>`${WEEKDAYS[d.getDay()]}, ${d.getDate()}-${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`

const MONTHS=['yan','fev','mar','apr','may','iyn','iyl','avg','sen','okt','noy','dek']
export function shortDate(value?:string){
  if(!value)return '—'
  const d=parseDate(value)
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`
}

export function formatMinutes(total:number){
  const minutes=Math.max(0,Math.round(total))
  const h=Math.floor(minutes/60),m=minutes%60
  return h?`${h} soat ${pad(m)} min`:`${m} min`
}
