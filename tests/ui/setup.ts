// Browser environment for UI tests. Imported first by every UI test, before React loads.
import {JSDOM} from 'jsdom'

// React (dev) queues act() work through a new MessageChannel each time; open ports keep the process alive,
// so they are tracked and closed once a file's tests are done.
const NativeChannel=globalThis.MessageChannel
const channels:MessageChannel[]=[]
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this)}} as typeof MessageChannel
export function closeChannels(){for(const c of channels.splice(0)){c.port1.close();c.port2.close()}}

const dom=new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#fff"></head><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true})
const w=dom.window as unknown as Window&typeof globalThis

type Listener=(e:{matches:boolean;media:string})=>void
/** Controllable media queries: tests flip `prefers-color-scheme` like the OS would. */
export const media={dark:false,listeners:new Set<{query:string;fn:Listener}>()}
export function setSystemDark(dark:boolean){
  media.dark=dark
  for(const l of media.listeners)if(l.query.includes('prefers-color-scheme'))l.fn({matches:dark,media:l.query})
}
w.matchMedia=((query:string)=>({
  get matches(){return query.includes('prefers-color-scheme: dark')?media.dark:query.includes('min-width')?true:false},
  media:query,onchange:null,
  addEventListener:(_:string,fn:Listener)=>media.listeners.add({query,fn}),
  removeEventListener:(_:string,fn:Listener)=>{for(const l of media.listeners)if(l.fn===fn)media.listeners.delete(l)},
  addListener(){},removeListener(){},dispatchEvent:()=>false,
})) as unknown as typeof w.matchMedia
if(!('PointerEvent' in w))(w as unknown as Record<string,unknown>).PointerEvent=class extends w.MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1}}
w.HTMLElement.prototype.scrollIntoView=function(){}
w.scrollTo=(()=>undefined) as typeof w.scrollTo
w.HTMLElement.prototype.setPointerCapture=function(){}

const g=globalThis as unknown as Record<string,unknown>
for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','Text','Event','KeyboardEvent','MouseEvent','PointerEvent','FocusEvent','InputEvent','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','matchMedia','DocumentFragment','MutationObserver','location','history','PopStateEvent','DOMParser','SVGElement']){
  if(key in w)Object.defineProperty(g,key,{configurable:true,writable:true,value:(w as unknown as Record<string,unknown>)[key]})
}
g.IS_REACT_ACT_ENVIRONMENT=true
export {dom}
