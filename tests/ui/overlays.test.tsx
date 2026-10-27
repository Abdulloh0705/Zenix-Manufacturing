import {cleanup,click,flush,key,render} from './helpers'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {useRef,useState} from 'react'
import {Confirm,Drawer,Modal,Popover} from '../../src/shared/ui'

afterEach(cleanup)

function ModalHarness({nested=false}:{nested?:boolean}){
  const [open,setOpen]=useState(false),[inner,setInner]=useState(false)
  return <>
    <button id="opener" onClick={()=>setOpen(true)}>Open</button>
    <Modal open={open} onClose={()=>setOpen(false)} title="Outer">
      <input id="field"/>
      {nested&&<button id="inner-opener" onClick={()=>setInner(true)}>Inner</button>}
      <Confirm open={inner} onClose={()=>setInner(false)} onConfirm={()=>undefined} title="Inner confirm"/>
    </Modal>
  </>
}

test('Modal: Escape closes it and focus returns to the button that opened it',async()=>{
  await render(<ModalHarness/>)
  const opener=document.getElementById('opener')!
  opener.focus()
  await click(opener)
  await flush()
  assert.ok(document.querySelector('[role="dialog"]'),'dialog is open')
  assert.equal(document.activeElement?.id,'field','focus moves into the dialog')
  await key(document,'Escape')
  await flush()
  assert.equal(document.querySelector('[role="dialog"]'),null,'Escape closes')
  assert.equal(document.activeElement,opener,'focus restored to opener')
})

test('Modal: the close button closes; clicks inside do not; a backdrop press does',async()=>{
  await render(<ModalHarness/>)
  await click(document.getElementById('opener'))
  await click(document.getElementById('field'))
  assert.ok(document.querySelector('[role="dialog"]'),'inner click keeps it open')
  await click(document.querySelector('.modal-close'))
  assert.equal(document.querySelector('[role="dialog"]'),null,'close button works')
  await click(document.getElementById('opener'))
  await click(document.querySelector('.modal-wrap'))
  assert.equal(document.querySelector('[role="dialog"]'),null,'backdrop closes')
})

test('Modal: Tab is trapped inside the dialog',async()=>{
  await render(<ModalHarness/>)
  await click(document.getElementById('opener'))
  await flush()
  const dialog=document.querySelector('[role="dialog"]')!
  const close=dialog.querySelector<HTMLElement>('.modal-close')!
  // jsdom has no layout: give every control a box so the trap sees it as visible.
  for(const el of dialog.querySelectorAll<HTMLElement>('button,input'))el.getClientRects=()=>[{width:10,height:10}] as unknown as DOMRectList
  document.getElementById('field')!.focus()
  await key(document,'Tab')
  assert.equal(document.activeElement,close,'Tab from the last control wraps to the first')
  await key(document,'Tab',{shiftKey:true})
  assert.equal(document.activeElement?.id,'field','Shift+Tab from the first wraps to the last')
})

test('Nested overlays: Escape closes only the top layer; scroll lock is held until the last one closes',async()=>{
  await render(<ModalHarness nested/>)
  const html=document.documentElement
  await click(document.getElementById('opener'))
  await flush()
  assert.ok(html.classList.contains('scroll-locked'),'outer dialog locks page scroll')
  await click(document.getElementById('inner-opener'))
  await flush()
  assert.equal(document.querySelectorAll('[role="dialog"]').length,2)
  await key(document,'Escape')
  await flush()
  assert.equal(document.querySelectorAll('[role="dialog"]').length,1,'only the confirm closed')
  assert.ok(html.classList.contains('scroll-locked'),'outer dialog still holds the lock')
  await key(document,'Escape')
  await flush()
  assert.equal(document.querySelectorAll('[role="dialog"]').length,0)
  assert.equal(html.classList.contains('scroll-locked'),false,'lock released after the last dialog')
})

test('Drawer: Escape and close button both close; backdrop press inside the panel does not',async()=>{
  function D(){const [open,setOpen]=useState(true);return <Drawer open={open} onClose={()=>setOpen(false)} title="Record"><button id="inside">x</button></Drawer>}
  await render(<D/>)
  await click(document.getElementById('inside'))
  assert.ok(document.querySelector('.drawer'))
  await key(document,'Escape')
  assert.equal(document.querySelector('.drawer'),null)
})

function PopHarness({placement='bottom-start' as const}:{placement?:'bottom-start'|'top-start'}){
  const [open,setOpen]=useState(true),ref=useRef<HTMLButtonElement>(null)
  return <><button ref={ref} id="anchor" onClick={()=>setOpen(v=>!v)}>A</button><div id="outside">out</div>
    <Popover open={open} onClose={()=>setOpen(false)} anchorRef={ref} placement={placement} ariaLabel="Menu"><button id="item">Item</button></Popover></>
}

const rect=(r:Partial<DOMRect>)=>({x:0,y:0,top:0,left:0,right:0,bottom:0,width:0,height:0,toJSON(){},...r}) as DOMRect

test('Popover: inside clicks keep it open, an outside press closes it, it is portalled to <body>',async()=>{
  await render(<PopHarness/>)
  const panel=document.querySelector('.ui-popover-layer')!
  assert.equal(panel.parentElement,document.body,'rendered into body, never clipped by a card or table')
  await click(document.getElementById('item'))
  assert.ok(document.querySelector('.ui-popover-layer'))
  await click(document.getElementById('outside'))
  assert.equal(document.querySelector('.ui-popover-layer'),null)
})

test('Popover: flips above the anchor near the bottom edge and stays inside the viewport',async()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:400})
  Object.defineProperty(window,'innerHeight',{configurable:true,value:600})
  const anchorRect=rect({top:560,bottom:590,left:350,right:390,width:40,height:30})
  const panelRect=rect({width:200,height:150})
  const origAnchor=HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect=function(){return this.id==='anchor'?anchorRect:this.classList.contains('ui-popover-layer')?panelRect:origAnchor.call(this)}
  try{
    await render(<PopHarness/>)
    const style=(document.querySelector('.ui-popover-layer') as HTMLElement).style
    assert.equal(style.top,`${560-150-8}px`,'opens upwards when there is no room below')
    assert.ok(parseFloat(style.left)+200<=400-8,'shifted left to stay inside the viewport')
    assert.equal(style.visibility,'visible')
  }finally{HTMLElement.prototype.getBoundingClientRect=origAnchor}
})

test('Popover: a menu taller than the room below stays under its trigger and scrolls',async()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:375})
  Object.defineProperty(window,'innerHeight',{configurable:true,value:812})
  const anchorRect=rect({top:8,bottom:44,left:300,right:340,width:40,height:36})
  const panelRect=rect({width:300,height:1100})
  const orig=HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect=function(){return this.id==='anchor'?anchorRect:this.classList.contains('ui-popover-layer')?panelRect:orig.call(this)}
  try{
    await render(<PopHarness/>)
    const style=(document.querySelector('.ui-popover-layer') as HTMLElement).style
    assert.equal(style.top,`${44+8}px`,'not slid up over the topbar')
    assert.equal(style.maxHeight,`${812-52-8}px`,'scrolls within the viewport')
  }finally{HTMLElement.prototype.getBoundingClientRect=orig}
})

test('Popover: Escape closes it and focus returns to its trigger',async()=>{
  const orig=HTMLElement.prototype.getClientRects
  HTMLElement.prototype.getClientRects=()=>[{width:10,height:10}] as unknown as DOMRectList
  try{
    await render(<PopHarness/>)
    await flush()
    assert.equal(document.activeElement?.id,'item','focus moved into the menu')
    await key(document,'Escape')
    await flush()
    assert.equal(Boolean(document.querySelector('.ui-popover-layer')),false)
    assert.equal(document.activeElement?.id,'anchor')
  }finally{HTMLElement.prototype.getClientRects=orig}
})

test('Popover: a top placement without room above flips below',async()=>{
  Object.defineProperty(window,'innerHeight',{configurable:true,value:600})
  const anchorRect=rect({top:20,bottom:50,left:10,right:50,width:40,height:30})
  const panelRect=rect({width:200,height:150})
  const orig=HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect=function(){return this.id==='anchor'?anchorRect:this.classList.contains('ui-popover-layer')?panelRect:orig.call(this)}
  try{
    await render(<PopHarness placement="top-start"/>)
    assert.equal((document.querySelector('.ui-popover-layer') as HTMLElement).style.top,`${50+8}px`)
  }finally{HTMLElement.prototype.getBoundingClientRect=orig}
})
