import {closeChannels,dom} from './setup'
import {after} from 'node:test'
import {act} from 'react'
import type {ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import type {Root} from 'react-dom/client'

const mounted=new Set<Root>()
// The jsdom visual timer and React's channels would keep the test process alive.
after(()=>{dom.window.close();closeChannels()})

export type Mounted={container:HTMLElement;root:Root;rerender:(ui:ReactNode)=>Promise<void>;unmount:()=>Promise<void>}

export async function render(ui:ReactNode):Promise<Mounted>{
  const container=document.createElement('div')
  document.body.appendChild(container)
  const root=createRoot(container)
  mounted.add(root)
  await act(async()=>{root.render(ui)})
  return {
    container,root,
    rerender:async next=>{await act(async()=>{root.render(next)})},
    unmount:async()=>{mounted.delete(root);await act(async()=>{root.unmount()});container.remove()},
  }
}

/** Lets effects, rAF callbacks and timers scheduled by them run. */
export async function flush(ms=20){await act(async()=>{await new Promise(r=>setTimeout(r,ms))})}

export async function click(el:Element|null){
  if(!el)throw new Error('click: element not found')
  await act(async()=>{
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}))
    ;(el as HTMLElement).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))
  })
}

export async function key(target:Element|Document,k:string,init:KeyboardEventInit={}){
  await act(async()=>{target.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...init}))})
}

/** Types into a React-controlled input (sets the native value, then fires input). */
export async function type(el:Element|null,value:string){
  if(!el)throw new Error('type: element not found')
  const input=el as HTMLInputElement
  const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!
  await act(async()=>{setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})
}

export const byText=(text:string,selector='button',root:ParentNode=document)=>[...root.querySelectorAll<HTMLElement>(selector)].find(e=>e.textContent?.trim()===text)??null

/** Unmounts everything (so overlay layers and scroll locks unwind) and clears the page and storage. */
export async function cleanup(){
  for(const root of mounted)await act(async()=>{root.unmount()})
  mounted.clear()
  document.body.innerHTML='';document.documentElement.className='';localStorage.clear()
}
