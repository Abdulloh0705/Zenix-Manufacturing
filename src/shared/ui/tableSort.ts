/**
 * Sorting rules for data tables. A rendered cell is text ("1 200 000 so‘m", "26.10.2026"), so sorting by
 * it would order numbers and dates as words; the raw field (or the column's `value`) is used instead,
 * and number-like / date-like text is compared by what it means. Empty values always go last.
 */
export type SortValue=string|number|undefined|null

const collator=new Intl.Collator('uz',{numeric:true,sensitivity:'base'})
const ISO_DATE=/^\d{4}-\d{2}-\d{2}/
const DMY_DATE=/^(\d{2})\.(\d{2})\.(\d{4})(.*)$/
// "1 200 000", "-12,5", "87%", "3.5" — digits with group spaces and one decimal mark, optional % sign.
const LOOSE_NUMBER=/^[-+−]?\d{1,3}(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?\s*%?$|^[-+−]?\d+(?:[.,]\d+)?\s*%?$/

export function isEmptyValue(v:SortValue){return v===null||v===undefined||v===''||v==='—'||(typeof v==='number'&&Number.isNaN(v))}

export function looseNumber(v:string):number|null{
  const t=v.trim()
  if(!LOOSE_NUMBER.test(t))return null
  const n=Number(t.replace(/[\s\u00a0\u202f%]/g,'').replace('−','-').replace(',','.'))
  return Number.isFinite(n)?n:null
}

/** dd.mm.yyyy → yyyy-mm-dd so displayed dates compare chronologically. */
export function dateKey(v:string):string|null{
  if(ISO_DATE.test(v))return v
  const m=DMY_DATE.exec(v.trim())
  return m?`${m[3]}-${m[2]}-${m[1]}${m[4]}`:null
}

/** Ascending comparison; callers flip the sign for descending but keep empty values last. */
export function compareValues(a:SortValue,b:SortValue):number{
  if(typeof a==='number'&&typeof b==='number')return a-b
  const sa=String(a),sb=String(b)
  const na=typeof a==='number'?a:looseNumber(sa),nb=typeof b==='number'?b:looseNumber(sb)
  if(na!==null&&nb!==null)return na-nb
  const da=dateKey(sa),db=dateKey(sb)
  if(da!==null&&db!==null)return da<db?-1:da>db?1:0
  return collator.compare(sa,sb)
}

export function sortRows<T>(rows:T[],value:(row:T)=>SortValue,dir:1|-1):T[]{
  return rows.map((row,i)=>({row,i,v:value(row)})).sort((x,y)=>{
    const ex=isEmptyValue(x.v),ey=isEmptyValue(y.v)
    if(ex||ey)return ex===ey?x.i-y.i:ex?1:-1
    return compareValues(x.v,y.v)*dir||x.i-y.i
  }).map(x=>x.row)
}

export function paginate<T>(rows:T[],page:number,pageSize:number){
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),safe=Math.min(Math.max(1,page),pages),from=(safe-1)*pageSize
  return {pages,page:safe,from,slice:rows.slice(from,from+pageSize)}
}
