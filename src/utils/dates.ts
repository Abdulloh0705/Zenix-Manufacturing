// The one date layer (audit #20). Two kinds of values, never mixed up:
//   - date-only `YYYY-MM-DD`: a calendar day (due date, delivery date, MPS week). Arithmetic on it is pure calendar
//     math, so it never shifts by a day whatever the browser or company timezone is.
//   - timestamp `YYYY-MM-DD HH:mm`: wall-clock time in the company timezone (settings.company.timezone, IANA). It is
//     turned into an absolute instant only through that timezone (parseDate), so durations across a daylight-saving
//     change are real elapsed minutes. Instants of the auth layer stay ISO UTC strings.
// "Now" and "today" are read in the company timezone, never in the browser's. The app sets it with setTimeZone
// when the settings load or change; until then the runtime's own zone is used (tests, first render).
// Phase 5 (timezone gap): a third kind, the absolute instant (ISO with `T` and `Z` / an offset), is read as is. When
// the company zone changes, the change is recorded (settings.company.zoneHistory) and every wall-clock timestamp is
// read in the zone that was in force when it was written — stored values are never rewritten. Unavoidable ambiguity:
// a wall-clock value written within |old offset − new offset| of the change reads valid in both zones; the newer
// zone wins. Values written before the first recorded change are read in the zone configured before it (the history
// starts with that zone and an unknown start), never silently as UTC.

const DAY_MS=864e5
const pad=(n:number)=>String(n).padStart(2,'0')

const runtimeZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch{return 'UTC'}}
// Kept on globalThis so every bundle of this module (domain test bundles, app chunks) shares one company zone.
type ZoneChange={zone:string;since:string}
const holder=globalThis as typeof globalThis&{__zenixTimeZone?:string;__zenixZoneHistory?:{zone:string;since:number}[]}
const zone0=()=>holder.__zenixTimeZone||(holder.__zenixTimeZone=runtimeZone())
const zoneHistory=()=>holder.__zenixZoneHistory||[]
const formatters=new Map<string,Intl.DateTimeFormat>()
function formatterOf(tz:string){
  let f=formatters.get(tz)
  if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});formatters.set(tz,f)}
  return f
}

/** A timezone name the runtime knows (IANA, e.g. Asia/Tashkent, America/New_York, UTC). */
export function isValidTimeZone(tz:unknown):tz is string{
  if(typeof tz!=='string'||!tz.trim())return false
  try{formatterOf(tz);return true}catch{return false}
}

/** Sets the company timezone every date helper uses; an unknown name is refused and the current one kept. */
export function setTimeZone(tz:string|undefined){
  if(!tz||!isValidTimeZone(tz))return false
  holder.__zenixTimeZone=tz
  return true
}
export const timeZone=()=>zone0()

/** Sets the recorded zone changes (oldest first); entries with an unknown zone or start instant are ignored. */
export function setZoneHistory(history:ZoneChange[]|undefined){
  const rows=(Array.isArray(history)?history:[]).filter(h=>h&&isValidTimeZone(h.zone)&&(h.since===''||Number.isFinite(Date.parse(h.since))))
    .map(h=>({zone:h.zone,since:h.since?Date.parse(h.since):-Infinity})).sort((a,b)=>a.since-b.since)
  holder.__zenixZoneHistory=rows.length>1?rows:[]
}

/**
 * Company settings after the clock moves to `next.timezone` at `now`: the zone history gains the change (starting
 * with the zone used so far, whose start is unknown). Stored timestamps are not touched.
 */
export function recordZoneChange<T extends {timezone:string;zoneHistory?:ZoneChange[]}>(current:T,next:Partial<T>&{timezone?:string},now:Date):T{
  const zone=next.timezone
  if(!zone||zone===current.timezone||!isValidTimeZone(zone))return {...current,...next}
  const history=current.zoneHistory?.length?current.zoneHistory:[{zone:current.timezone,since:''}]
  return {...current,...next,zoneHistory:[...history,{zone,since:now.toISOString()}]}
}

/** Kind of a stored date value: calendar day, company wall-clock timestamp, absolute instant, or not a date. */
export function timestampKind(value:unknown):'date'|'local'|'instant'|'invalid'{
  if(typeof value!=='string')return 'invalid'
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return 'date'
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))return 'local'
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)))return 'instant'
  return 'invalid'
}

type Parts={y:number;m:number;d:number;h:number;min:number;sec:number}
/** Wall-clock parts of an instant in `tz`. */
export function zonedParts(d:Date,tz=zone0()):Parts{
  const p:Record<string,number>={}
  for(const x of formatterOf(tz).formatToParts(d))if(x.type!=='literal')p[x.type]=Number(x.value)
  return {y:p.year,m:p.month,d:p.day,h:p.hour===24?0:p.hour,min:p.minute,sec:p.second}
}
/** Offset of `tz` from UTC at an instant, in minutes. */
function offsetAt(ms:number,tz:string){
  const p=zonedParts(new Date(ms),tz)
  return Math.round((Date.UTC(p.y,p.m-1,p.d,p.h,p.min,p.sec)-Math.floor(ms/1000)*1000)/60000)
}
/**
 * Instant of a wall-clock time in `tz`. A time skipped by a spring-forward change (02:30 in New York) moves forward by
 * the gap, as a clock would; a repeated time at fall-back takes its first (earlier) occurrence.
 */
function zonedInstant(y:number,m:number,d:number,h:number,min:number,tz:string){
  const wall=Date.UTC(y,m-1,d,h,min)
  // The offsets a day before and after cover any single change; keep the earlier candidate that reads back as this
  // wall time; none does inside a spring-forward gap, then the offset in force before the change applies.
  const before=offsetAt(wall-DAY_MS,tz),after=offsetAt(wall+DAY_MS,tz)
  const reads=(ms:number)=>{const p=zonedParts(new Date(ms),tz);return p.y===y&&p.m===m&&p.d===d&&p.h===h&&p.min===min}
  const candidates=[wall-before*60000,wall-after*60000].sort((a,b)=>a-b)
  return candidates.find(reads)??wall-before*60000
}

/** Calendar day of an instant in the company timezone. */
export function isoDate(d:Date=new Date(),tz=zone0()){
  const p=zonedParts(d,tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

/** Company wall-clock timestamp of an instant. */
export function stamp(d:Date=new Date(),tz=zone0()){
  const p=zonedParts(d,tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`
}

/**
 * Instant of a value: an absolute instant as is; a date (its midnight) in `tz` / the company zone; a wall-clock
 * timestamp in `tz` when given, else in the zone in force when it was written (zone history, newest first).
 */
export function parseDate(value:string,tz?:string){
  if(timestampKind(value)==='instant')return new Date(value)
  const [y,m,d]=value.slice(0,10).split('-').map(Number)
  const time=value.length>10?value.slice(11,16).split(':').map(Number):[0,0]
  const at=(zone:string)=>zonedInstant(y,m||1,d||1,time[0]||0,time[1]||0,zone)
  if(tz||value.length<=10)return new Date(at(tz||zone0()))
  const history=zoneHistory()
  for(let i=history.length-1;i>=0;i--){const ms=at(history[i].zone);if(ms>=history[i].since)return new Date(ms)}
  return new Date(at(history.length?history[0].zone:zone0()))
}

/**
 * Which recorded zone(s) a wall-clock timestamp can belong to: each zone whose period (its `since` up to the next
 * change) contains the instant the value means there. More than one = written around a change, ambiguous.
 */
export function stampZones(value:string):string[]{
  const history=zoneHistory()
  if(timestampKind(value)!=='local'||history.length<2)return [zone0()]
  const [y,m,d]=value.slice(0,10).split('-').map(Number),[h,min]=value.slice(11,16).split(':').map(Number)
  return history.filter((z,i)=>{const ms=zonedInstant(y,m,d,h,min,z.zone);return ms>=z.since&&(i===history.length-1||ms<history[i+1].since)}).map(z=>z.zone)
}
export const isAmbiguousStamp=(value:string)=>stampZones(value).length>1

/**
 * A stored timestamp for display in today's company zone: converted when it was written in an earlier zone that is
 * known for certain; shown as written and marked when it falls in a zone change's ambiguous window — never turned
 * into a precise-looking time the data cannot support. Dates and values of the current zone are unchanged.
 */
export function displayStamp(value:string):string{
  if(timestampKind(value)!=='local'||zoneHistory().length<2)return value
  const zones=stampZones(value)
  if(zones.length!==1)return `${value} (${zones.length?'zona o‘zgarishi — vaqt noaniq':'zona noma’lum'})`
  return zones[0]===zone0()?value:stamp(parseDate(value))
}

/** Calendar parts of a date-only value: pure arithmetic, no timezone. */
const civil=(value:string)=>{const [y,m,d]=value.slice(0,10).split('-').map(Number);return new Date(Date.UTC(y,(m||1)-1,d||1))}
const civilIso=(d:Date)=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`

export function addDays(value:string,days:number){
  const d=civil(value)
  d.setUTCDate(d.getUTCDate()+days)
  return civilIso(d)
}

/** Whole calendar days from one day to another (time of day is ignored). */
export function daysBetween(from:string,to:string){
  return Math.round((civil(to).getTime()-civil(from).getTime())/DAY_MS)
}

/** Elapsed minutes between two company timestamps — real minutes, a DST change included. */
export function minutesBetween(from:string,to:string){
  return Math.max(0,Math.round((parseDate(to).getTime()-parseDate(from).getTime())/60000))
}

/** Company timestamp `minutes` real minutes after another (across a DST change the wall clock jumps with it). */
export function addMinutes(value:string,minutes:number){
  return stamp(new Date(parseDate(value).getTime()+minutes*60000))
}

/** Day of the week of a calendar day (0 = Sunday … 6 = Saturday). */
export const dayOfWeek=(value:string)=>civil(value).getUTCDay()
/** Day of the month of a calendar day. */
export const dayOfMonth=(value:string)=>Number(value.slice(8,10))

/** Adds whole months, clamped to the last day of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(value:string,months:number){
  const d=civil(value),day=d.getUTCDate()
  const target=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1))
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
  target.setUTCDate(Math.min(day,last))
  return civilIso(target)
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
  return addDays(value,-((dayOfWeek(value)+6)%7))
}

export function compactCode(d:Date=new Date()){
  const p=zonedParts(d)
  return `${String(p.y).slice(2)}${pad(p.m)}${pad(p.d)}`
}

// Explicit Uzbek names: browsers ship incomplete 'uz-UZ' locale data (e.g. "M09 27, Sun").
const WEEKDAYS=['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']
const WEEKDAYS_SHORT=['Ya','Du','Se','Ch','Pa','Ju','Sh']
const MONTHS_LONG=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
export const weekdayShort=(value:string)=>WEEKDAYS_SHORT[dayOfWeek(value)]
export const longDate=(d:Date=new Date())=>{const day=isoDate(d);return `${WEEKDAYS[dayOfWeek(day)]}, ${dayOfMonth(day)}-${MONTHS_LONG[Number(day.slice(5,7))-1]} ${day.slice(0,4)}`}

const MONTHS=['yan','fev','mar','apr','may','iyn','iyl','avg','sen','okt','noy','dek']
export function shortDate(value?:string){
  if(!value)return '—'
  return `${dayOfMonth(value)}-${MONTHS[Number(value.slice(5,7))-1]}`
}

export function formatMinutes(total:number){
  const minutes=Math.max(0,Math.round(total))
  const h=Math.floor(minutes/60),m=minutes%60
  return h?`${h} soat ${pad(m)} min`:`${m} min`
}

/** Company timezones offered in settings (any valid IANA name already saved stays selectable). */
export const TIMEZONES=['Asia/Tashkent','Asia/Almaty','Asia/Dubai','Europe/Moscow','Europe/Istanbul','Europe/London','America/New_York','UTC']
export const timeZoneOptions=(current?:string)=>current&&!TIMEZONES.includes(current)&&isValidTimeZone(current)?[current,...TIMEZONES]:TIMEZONES
export const TIMEZONE_HINT='Bugun, sana filtrlari, rejalashtirish va xizmat muddatlari shu zona bo‘yicha. Saqlangan yozuvlar qayta yozilmaydi.'
