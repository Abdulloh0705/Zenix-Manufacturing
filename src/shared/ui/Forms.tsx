import {Children,cloneElement,isValidElement,useEffect,useId,useMemo,useRef,useState} from 'react'
import type {ChangeEvent,InputHTMLAttributes,KeyboardEvent as ReactKeyboardEvent,ReactElement,ReactNode,TextareaHTMLAttributes} from 'react'
import {Icon} from './Icon'
import {Popover} from './Overlays'
import {CURRENCIES,fromDisplay,getDisplayCurrency,toDisplay} from '../../utils/format'

export function Field({label,children,hint,error,required,className=''}:{label:string;children:ReactElement;hint?:string;error?:string;required?:boolean;className?:string}){
  const uid=useId()
  const props=children.props as Record<string,unknown>
  const controlId=(props.id as string)||`${uid}-control`
  const hintId=hint?`${uid}-hint`:undefined,errorId=error?`${uid}-error`:undefined
  const described=[hintId,errorId].filter(Boolean).join(' ')||undefined
  const control=cloneElement(children as ReactElement<Record<string,unknown>>,{id:controlId,...(described?{'aria-describedby':described}:{}),...(error?{'aria-invalid':true}:{}),...(required?{'aria-required':true}:{})})
  return <div className={`field ${error?'has-error':''} ${className}`}>
    <label htmlFor={controlId}>{label}{required&&<span className="required-mark" aria-hidden="true">*</span>}</label>
    {control}
    {error?<small id={errorId} className="field-error" role="alert">{error}</small>:hint?<small id={hintId} className="field-hint">{hint}</small>:null}
  </div>
}

export function Input(props:InputHTMLAttributes<HTMLInputElement>){return <input {...props} className={`ui-input ${props.className||''}`}/>}

/**
 * Money field. `value` / `onValue` are always base-currency (UZS) strings, so forms and domain
 * actions never see converted numbers; the person types in the selected display currency.
 */
export function MoneyInput({value,onValue,onBlur,disabled,...rest}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'>&{value:string;onValue:(base:string)=>void}){
  const code=getDisplayCurrency(),meta=CURRENCIES[code]
  const toText=(base:string)=>base===''||base==null?'':String(Math.round(toDisplay(Number(base),code)*10**meta.digits)/10**meta.digits)
  const [text,setText]=useState(()=>toText(value))
  const last=useRef({base:value,code})
  useEffect(()=>{if(value!==last.current.base||code!==last.current.code){last.current={base:value,code};setText(toText(value))}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[value,code])
  const change=(t:string)=>{setText(t);const base=t.trim()===''?'':String(fromDisplay(Number(t),code));last.current={base,code};onValue(base)}
  return <div className={`input-affix ${disabled?'is-disabled':''}`}><input {...rest} type="number" inputMode="decimal" step={meta.digits?'0.01':'1'} disabled={disabled} className="ui-input" value={text} onChange={e=>change(e.target.value)} onBlur={onBlur}/><span aria-hidden="true">{meta.prefix?meta.symbol:code==='UZS'?'so‘m':meta.symbol}</span></div>
}
export function Textarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){return <textarea rows={3} {...props} className={`ui-textarea ${props.className||''}`}/>}

export function SearchBox({value,onChange,placeholder='Qidirish...',ariaLabel,autoFocus}:{value:string;onChange:(v:string)=>void;placeholder?:string;ariaLabel?:string;autoFocus?:boolean}){
  return <div className="search-inline"><Icon name="search" size={15}/><input type="search" value={value} autoFocus={autoFocus} onChange={e=>onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel||placeholder}/>{value&&<button type="button" className="search-clear" onClick={()=>onChange('')} aria-label="Qidiruvni tozalash"><Icon name="x" size={13}/></button>}</div>
}

export function Toolbar({query,onQuery,placeholder='Qidirish...',children}:{query:string;onQuery:(v:string)=>void;placeholder?:string;children?:ReactNode}){
  return <div className="toolbar"><SearchBox value={query} onChange={onQuery} placeholder={placeholder}/>{children&&<div className="toolbar-actions">{children}</div>}</div>
}

export function Toggle({checked,onChange,label,description,disabled=false,disabledReason}:{checked:boolean;onChange:(v:boolean)=>void;label:string;description?:string;disabled?:boolean;disabledReason?:string}){
  const id=useId()
  return <div className={`toggle-row ${disabled?'disabled':''}`} title={disabled?disabledReason:undefined}>
    <span><b id={`${id}-l`}>{label}</b>{description&&<small id={`${id}-d`}>{description}</small>}</span>
    <button type="button" role="switch" className={`switch ${checked?'on':''}`} onClick={()=>!disabled&&onChange(!checked)} aria-checked={checked} aria-labelledby={`${id}-l`} aria-describedby={description?`${id}-d`:undefined} disabled={disabled}><i/></button>
  </div>
}

export function Checkbox({checked,onChange,label,description,disabled}:{checked:boolean;onChange:(v:boolean)=>void;label:ReactNode;description?:ReactNode;disabled?:boolean}){
  return <label className={`check-line ${disabled?'disabled':''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span><b>{label}</b>{description&&<small>{description}</small>}</span></label>
}

type Option={key:string|number;value:string;label:ReactNode;text:string;disabled:boolean}
const nodeToText=(node:ReactNode):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(nodeToText).join(''):isValidElement(node)?nodeToText((node.props as {children?:ReactNode}).children):''

export function Select({value,onChange,children,className='',placeholder='Tanlang',disabled=false,id,ariaLabel,size,triggerLabel}:{value:string;onChange:(v:string)=>void;children:ReactNode;className?:string;placeholder?:string;disabled?:boolean;id?:string;ariaLabel?:string;size?:'sm';triggerLabel?:ReactNode}){
  const uid=useId()
  const listId=`${uid}-list`
  const [open,setOpen]=useState(false),[active,setActive]=useState(0)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const typed=useRef({text:'',at:0})
  const options=useMemo<Option[]>(()=>Children.toArray(children).filter(isValidElement).map((child,i)=>{
    const props=child.props as {value?:string;children?:ReactNode;disabled?:boolean}
    const label=props.children
    return {key:child.key??i,value:String(props.value??nodeToText(label)),label,text:nodeToText(label).toLowerCase(),disabled:Boolean(props.disabled)}
  }),[children])
  const selectedIndex=options.findIndex(o=>o.value===String(value)),selected=options[selectedIndex]
  useEffect(()=>{if(open)setActive(Math.max(0,selectedIndex))},[open,selectedIndex])
  useEffect(()=>{if(open)document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({block:'nearest'})},[open,active,uid])
  const choose=(i:number)=>{const o=options[i];if(!o||o.disabled)return;if(o.value!==String(value))onChange(o.value);setOpen(false);requestAnimationFrame(()=>triggerRef.current?.focus())}
  const move=(from:number,dir:number)=>{if(!options.length)return;let i=from;for(let n=0;n<options.length;n++){i=Math.max(0,Math.min(options.length-1,i+dir));if(!options[i].disabled){setActive(i);return}if(i===0||i===options.length-1)return}}
  const key=(e:ReactKeyboardEvent)=>{
    if(disabled)return
    if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(active);else setOpen(true);return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open){setOpen(true);return}move(active,e.key==='ArrowDown'?1:-1);return}
    if(!open)return
    if(e.key==='Home'){e.preventDefault();move(-1,1)}
    else if(e.key==='End'){e.preventDefault();move(options.length,-1)}
    else if(e.key==='PageDown'){e.preventDefault();move(active,Math.min(8,options.length))}
    else if(e.key==='PageUp'){e.preventDefault();move(active,-Math.min(8,options.length))}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){
      const now=Date.now(),t=typed.current
      t.text=(now-t.at>700?'':t.text)+e.key.toLowerCase();t.at=now
      const start=t.text.length===1?active+1:active
      const found=[...options.slice(start),...options.slice(0,start)].find(o=>!o.disabled&&o.text.startsWith(t.text))
      if(found)setActive(options.indexOf(found))
    }
  }
  return <div className={`custom-select-wrap ${size==='sm'?'is-sm':''} ${className}`}>
    <button ref={triggerRef} id={id} type="button" role="combobox" className={`custom-select-trigger ${open?'open':''}`} disabled={disabled} onClick={()=>setOpen(v=>!v)} onKeyDown={key}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} aria-label={ariaLabel} aria-activedescendant={open?`${uid}-opt-${active}`:undefined}>
      <span className={!selected&&!triggerLabel?'placeholder':''}>{triggerLabel??selected?.label??placeholder}</span><Icon name="chevron" size={14} className="select-chevron"/>
    </button>
    <Popover open={open} onClose={()=>setOpen(false)} anchorRef={triggerRef} className="custom-select-menu" placement="bottom-start" matchWidth minWidth={160} role="presentation" autoFocus={false}>
      <div role="listbox" id={listId} aria-label={ariaLabel}>
        {/* Options are chosen with the trigger's keyboard handling (aria-activedescendant); only pointer users click them. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
        {options.length?options.map((o,i)=><div role="option" id={`${uid}-opt-${i}`} key={String(o.key)} aria-selected={o.value===String(value)} aria-disabled={o.disabled||undefined}
          className={`select-option ${o.value===String(value)?'selected':''} ${active===i?'active-option':''} ${o.disabled?'disabled':''}`}
          onPointerMove={()=>active!==i&&setActive(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(i)}>
          <span>{o.label}</span>{o.value===String(value)&&<Icon name="check" size={13}/>}
        </div>):<div className="select-empty">Variant yo‘q</div>}
      </div>
    </Popover>
  </div>
}

/* ------------------------------------------------------------------ forms -- */

type Errors<T>=Partial<Record<keyof T,string>>
/** Mounted forms with unsaved values; used to preserve drafts during a session change in another tab. */
const dirtyForms=new Set<symbol>()
export const hasDirtyForms=()=>dirtyForms.size>0
/** For editors with existing custom state that cannot use useForm. */
export function useDirtyMarker(dirty:boolean){
  const formId=useRef(Symbol('form'))
  useEffect(()=>{
    const id=formId.current
    if(dirty)dirtyForms.add(id)
    else dirtyForms.delete(id)
    return()=>{dirtyForms.delete(id)}
  },[dirty])
}
/** After a failed submit, move focus to the first field showing an error (in the top-most dialog, if any). */
export function focusFirstInvalid(){
  const schedule=typeof requestAnimationFrame==='function'?requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0)
  schedule(()=>{
    const dialogs=document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
    const root:ParentNode=dialogs[dialogs.length-1]??document
    root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  })
}

/** A second submit this soon after a successful one is a double click / repeated Enter, not a new intent. */
export const DUPLICATE_SUBMIT_MS=600

/**
 * Minimal form state: values, validation, touched/submitted error visibility and reset.
 * `submit(fn)` validates first; fn may return false to keep the form open (e.g. action failed).
 * `resetKey`: the record being edited. When it changes while the form stays mounted (a drawer switching
 * records), values, touched state and errors start over from the new record instead of keeping the old one.
 */
export function useForm<T extends Record<string,unknown>>(initial:T|(()=>T),validate:(values:T)=>Errors<T>=()=>({}),resetKey?:string|number|null){
  const resolve=()=>typeof initial==='function'?(initial as ()=>T)():initial
  const initialRef=useRef<T>(null as unknown as T)
  if(initialRef.current===null)initialRef.current=resolve()
  const [values,setValues]=useState<T>(initialRef.current)
  const [touched,setTouched]=useState<Partial<Record<keyof T,boolean>>>({})
  const [submitted,setSubmitted]=useState(false)
  const [key,setKey]=useState(resetKey)
  const lastSuccess=useRef(0)
  if(key!==resetKey){
    // Adjusting state during render (React's documented pattern for "reset when a prop changes").
    const next=resolve()
    initialRef.current=next
    setKey(resetKey);setValues(next);setTouched({});setSubmitted(false);lastSuccess.current=0
  }
  const errors=validate(values)
  const valid=!Object.values(errors).some(Boolean)
  const set=<K extends keyof T>(key:K,value:T[K])=>setValues(v=>({...v,[key]:value}))
  const touch=(key:keyof T)=>setTouched(t=>t[key]?t:{...t,[key]:true})
  const error=(key:keyof T)=>submitted||touched[key]?errors[key]:undefined
  const dirty=JSON.stringify(values)!==JSON.stringify(initialRef.current)
  useDirtyMarker(dirty)
  const reset=(next?:T)=>{if(next)initialRef.current=next;setValues(initialRef.current);setTouched({});setSubmitted(false)}
  const submit=(fn:(values:T)=>boolean|void)=>{
    setSubmitted(true)
    if(!valid){focusFirstInvalid();return false}
    if(Date.now()-lastSuccess.current<DUPLICATE_SUBMIT_MS)return false
    const ok=fn(values)!==false
    if(ok)lastSuccess.current=Date.now()
    return ok
  }
  const input=(key:keyof T)=>({value:String(values[key]??''),onChange:(e:ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>set(key,e.target.value as T[keyof T]),onBlur:()=>touch(key)})
  /** Props for <MoneyInput>: the stored value stays in base currency. */
  const money=(key:keyof T)=>({value:String(values[key]??''),onValue:(v:string)=>set(key,v as T[keyof T]),onBlur:()=>touch(key)})
  return {values,set,touch,errors,error,valid,dirty,reset,submit,input,money}
}

export const required=(value:unknown,label='Maydon')=>String(value??'').trim()?undefined:`${label} majburiy`
export const positive=(value:unknown,label='Qiymat')=>{const n=Number(value);return Number.isFinite(n)&&n>0?undefined:`${label} 0 dan katta bo‘lishi kerak`}
export const nonNegative=(value:unknown,label='Qiymat')=>{const n=Number(value);return value!==''&&Number.isFinite(n)&&n>=0?undefined:`${label} manfiy bo‘lmasligi kerak`}
