import {createContext,isValidElement,useContext,useEffect,useMemo,useRef,useState} from 'react'
import type {MouseEvent,ReactNode} from 'react'
import {useSearchParams} from 'react-router-dom'
import {Icon} from './Icon'
import {Empty} from './DataDisplay'
import {SearchBox,Select} from './Forms'
import {Popover} from './Overlays'
import {downloadCsv} from '../../utils/exportData'
import {paginate,sortRows} from './tableSort'
import type {SortValue} from './tableSort'

/**
 * Whether the current page may export its tables (the module's "export" permission). Provided by the app
 * layout per route; outside a provider export stays available (A-H4 / N-18).
 */
export const ExportPermission=createContext(true)

export type Column<T>={
  key:string;label:string;
  render?:(row:T)=>ReactNode;
  /** Plain value used for sorting, searching and export. Defaults to the rendered text. */
  value?:(row:T)=>string|number|undefined|null;
  /** @deprecated use `value` */
  sort?:(row:T)=>string|number;
  className?:string;align?:'left'|'right'|'center';
  searchable?:boolean;sortable?:boolean;
  /** Hide on narrow screens (table view only). */
  priority?:'low';
}

/** Extracts the visible text of a rendered cell so search/sort match what the user sees. */
export function nodeText(node:ReactNode):string{
  if(node===null||node===undefined||typeof node==='boolean')return ''
  if(typeof node==='string'||typeof node==='number')return String(node)
  if(Array.isArray(node))return node.map(nodeText).join(' ')
  if(isValidElement(node))return nodeText((node.props as {children?:ReactNode}).children)
  return ''
}

const INTERACTIVE='button,a,input,select,textarea,label,[role="button"],[role="switch"],[role="checkbox"],[role="option"]'

/** What the user sees in the cell — used for search and export. */
function cellValue<T>(row:T,c:Column<T>){
  if(c.value)return c.value(row)
  if(c.sort)return c.sort(row)
  const raw=(row as Record<string,unknown>)[c.key]
  if(c.render)return nodeText(c.render(row))
  return typeof raw==='number'||typeof raw==='string'?raw:raw==null?'':String(raw)
}

/** What the column sorts by: the explicit value, else the raw number / ISO date behind a formatted cell. */
export function sortValueOf<T>(row:T,c:Column<T>):SortValue{
  if(c.value)return c.value(row)
  if(c.sort)return c.sort(row)
  const raw=(row as Record<string,unknown>)[c.key]
  if(typeof raw==='number')return raw
  if(typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}/.test(raw))return raw
  return cellValue(row,c)
}

export function ResourceTable<T extends {id:string}>({rows,columns,query,onQuery,placeholder='Qidirish...',actions,filters,onRow,rowLabel,emptyTitle='Ma’lumot yo‘q',emptyText,emptyAction,pageSize:initialPageSize=10,filtersActive=false,onResetFilters,exportName,initialSort,rowClassName,resetKey}:{
  rows:T[];columns:Column<T>[];query:string;onQuery:(v:string)=>void;placeholder?:string;actions?:ReactNode;filters?:ReactNode;
  onRow?:(r:T)=>void;rowLabel?:(r:T)=>string;emptyTitle?:string;emptyText?:ReactNode;emptyAction?:ReactNode;pageSize?:number;
  filtersActive?:boolean;onResetFilters?:()=>void;exportName?:string;initialSort?:{key:string;dir:1|-1};rowClassName?:(r:T)=>string|undefined;resetKey?:string;
}){
  const exportAllowed=useContext(ExportPermission)
  const [sortKey,setSortKey]=useState(initialSort?.key||''),[dir,setDir]=useState<1|-1>(initialSort?.dir||1)
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(initialPageSize)
  const q=query.trim().toLowerCase()
  // Searchable text per row is built only while a query is typed, from the searchable columns (what the user sees).
  const filtered=useMemo(()=>{
    const terms=q.split(/\s+/).filter(Boolean)
    const list=terms.length?rows.filter(r=>{const text=columns.filter(c=>c.searchable!==false).map(c=>String(cellValue(r,c)??'')).join(' ').toLowerCase();return terms.every(t=>text.includes(t))}):rows
    const c=columns.find(x=>x.key===sortKey)
    return c?sortRows(list,r=>sortValueOf(r,c),dir):list
  },[rows,columns,q,sortKey,dir])
  useEffect(()=>{setPage(1)},[q,sortKey,dir,pageSize,resetKey,rows.length])
  const {pages,page:safe,from,slice}=paginate(filtered,page,pageSize)
  const toggleSort=(key:string)=>{
    if(sortKey!==key){setSortKey(key);setDir(1);return}
    if(dir===1){setDir(-1);return}
    setSortKey('');setDir(1)
  }
  const openRow=(e:MouseEvent<HTMLTableRowElement>,r:T)=>{
    if(!onRow)return
    const target=e.target as HTMLElement
    const interactive=target.closest(INTERACTIVE)
    if(interactive&&e.currentTarget.contains(interactive))return
    onRow(r)
  }
  const exportRows=()=>downloadCsv(exportName||'zenix-export',filtered.map(r=>Object.fromEntries(columns.map(c=>[c.label,cellValue(r,c)??'']))))
  const searching=Boolean(q)||filtersActive
  const activeCount=(q?1:0)+Math.max(filtersActive?1:0,countActive(filters))
  const reset=()=>{onQuery('');onResetFilters?.()}
  return <div className="data-view">
    <div className="toolbar">
      <SearchBox value={query} onChange={onQuery} placeholder={placeholder}/>
      {filters&&<div className="toolbar-filters">{filters}</div>}
      {searching&&<button type="button" className="filter-reset" onClick={reset} aria-label={`Filtrlarni tozalash (${activeCount})`}><Icon name="x" size={13}/>Tozalash<span className="seg-count">{activeCount}</span></button>}
      <div className="toolbar-actions">
        {exportName&&exportAllowed&&<button type="button" className="ghost-btn compact" onClick={exportRows} disabled={!filtered.length} title={filtered.length?`${filtered.length} ta yozuvni CSV ga eksport qilish`:'Eksport uchun yozuv yo‘q'}><Icon name="download" size={14}/>CSV</button>}
        {actions}
      </div>
    </div>
    <div className="table-card">
      {slice.length?<div className="table-scroll"><table className={onRow?'is-interactive':''}>
        <thead><tr>{columns.map(c=>{
          const active=sortKey===c.key
          const sortable=c.sortable!==false
          return <th key={c.key} className={`${c.className||''} ${c.align?`align-${c.align}`:''} ${c.priority==='low'?'priority-low':''}`} aria-sort={active?(dir===1?'ascending':'descending'):undefined} scope="col">
            {sortable?<button type="button" className={`th-sort ${active?'active':''}`} onClick={()=>toggleSort(c.key)}>{c.label}<Icon name={active?(dir===1?'sort-asc':'sort-desc'):'sort'} size={12}/></button>:c.label}
          </th>})}
          {onRow&&<th className="action-col" aria-hidden="true"/>}
        </tr></thead>
        <tbody>{slice.map(r=>{
          const label=rowLabel?rowLabel(r):String(cellValue(r,columns[0])??r.id)
          return <tr key={r.id} className={rowClassName?.(r)} tabIndex={onRow?0:undefined} aria-label={onRow?`${label} — ochish`:undefined} onClick={e=>openRow(e,r)} onKeyDown={e=>{if(onRow&&e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onRow(r)}}}>
            {columns.map(c=><td key={c.key} data-label={c.label} className={`${c.className||''} ${c.align?`align-${c.align}`:''} ${c.priority==='low'?'priority-low':''}`}>{c.render?c.render(r):c.value?String(c.value(r)??'—'):String((r as Record<string,unknown>)[c.key]??'—')}</td>)}
            {onRow&&<td className="action-col" aria-hidden="true"><Icon name="chevron" size={14}/></td>}
          </tr>})}
        </tbody>
      </table></div>:<Empty icon={searching?'search':'box'} title={searching?'Natija topilmadi':emptyTitle} text={searching?'Qidiruv yoki filtr bo‘yicha mos yozuv yo‘q.':emptyText??'Hozircha yozuv mavjud emas.'} action={searching?<button type="button" className="secondary-glass-btn compact" onClick={reset}>Filtrlarni tozalash</button>:emptyAction}/>}
      {filtered.length>0&&<div className="pagination">
        <span>{from+1}–{Math.min(from+pageSize,filtered.length)} / {filtered.length}{filtered.length!==rows.length&&<em> (jami {rows.length})</em>}</span>
        <div className="pagination-controls">
          <Select value={String(pageSize)} onChange={v=>setPageSize(Number(v))} ariaLabel="Sahifadagi yozuvlar soni" size="sm">{[10,25,50].map(n=><option key={n} value={String(n)}>{n} / sahifa</option>)}</Select>
          <button type="button" className="icon-ghost" disabled={safe<=1} onClick={()=>setPage(p=>p-1)} aria-label="Oldingi sahifa"><Icon name="chevron" style={{transform:'rotate(180deg)'}}/></button>
          <b aria-live="polite">{safe} / {pages}</b>
          <button type="button" className="icon-ghost" disabled={safe>=pages} onClick={()=>setPage(p=>p+1)} aria-label="Keyingi sahifa"><Icon name="chevron"/></button>
        </div>
      </div>}
    </div>
  </div>
}

/**
 * Several setters called in the same tick (e.g. "reset all filters") must compose instead of each
 * starting from the same stale URL and overwriting one another; they share this pending snapshot.
 */
let pendingParams:URLSearchParams|null=null

/** Query-string backed state so filters survive refresh, deep links and the back button. */
export function useSearchParamState(key:string,fallback=''){
  const [sp,setSp]=useSearchParams()
  const value=sp.get(key)??fallback
  const set=(next:string)=>{
    if(!pendingParams){pendingParams=new URLSearchParams(window.location.search);queueMicrotask(()=>{pendingParams=null})}
    if(!next||next===fallback)pendingParams.delete(key);else pendingParams.set(key,next)
    setSp(new URLSearchParams(pendingParams),{replace:true})
  }
  return [value,set] as const
}

/** `?id=` deep link for opening a record drawer directly (global search, notifications, direct URL). */
export function useRecordParam(key='id'){
  const [value,set]=useSearchParamState(key,'')
  return [value||null,(id:string|null)=>set(id||'')] as const
}

/** Compact filter chip: "Status ▾" when idle, "Status · Yuqori" (tinted) when a value is applied. */
export function FilterSelect({value,onChange,options,label,allLabel='Barchasi',defaultValue=''}:{value:string;onChange:(v:string)=>void;options:Array<string|{value:string;label:string}>;label:string;allLabel?:string;defaultValue?:string}){
  const list=options.map(o=>typeof o==='string'?{value:o,label:o}:o)
  const current=list.find(o=>o.value===value)
  const active=value!==defaultValue&&Boolean(current||value)
  return <Select value={value} onChange={onChange} ariaLabel={current?`${label}: ${current.label}`:label} size="sm" className={`filter-select ${active?'is-active':''}`}
    triggerLabel={<><span className="select-prefix">{label}</span>{current&&(active||defaultValue)?<span className="select-value">{current.label}</span>:null}</>}>
    {!defaultValue&&<option value="">{allLabel}</option>}
    {list.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
  </Select>
}

/**
 * "Ko‘proq" chip: secondary filters (line, flags…) live in a popover so the bar stays one row.
 * The chip shows how many of its filters are applied and is tinted while any is active.
 */
export function MoreFilters({children,label='Ko‘proq'}:{children:ReactNode;label?:string}){
  const [open,setOpen]=useState(false),ref=useRef<HTMLButtonElement>(null)
  const count=countActive(children)
  return <>
    <button ref={ref} type="button" className={`more-trigger ${count?'is-active':''} ${open?'open':''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={count?`${label}: ${count} ta filtr`:label} onClick={()=>setOpen(v=>!v)}><Icon name="filter" size={13}/>{label}{count>0&&<span className="seg-count">{count}</span>}</button>
    <Popover open={open} onClose={()=>setOpen(false)} anchorRef={ref} placement="bottom-start" minWidth={260} className="more-filters" ariaLabel="Qo‘shimcha filtrlar"><span className="eyebrow">Qo‘shimcha filtrlar</span><div className="more-filters-body">{children}</div></Popover>
  </>
}

/** Counts applied filters in a filter bar: non-empty FilterSelect values and checked Checkbox chips. */
function countActive(node:ReactNode):number{
  if(!node||typeof node!=='object')return 0
  if(Array.isArray(node))return node.reduce((a:number,n:ReactNode)=>a+countActive(n),0)
  if(!isValidElement(node))return 0
  const p=node.props as {value?:unknown;checked?:unknown;defaultValue?:unknown;children?:ReactNode}
  if(node.type===FilterSelect)return p.value&&p.value!==(p.defaultValue??'')?1:0
  if(typeof p.checked==='boolean')return p.checked?1:0
  return countActive(p.children)
}
