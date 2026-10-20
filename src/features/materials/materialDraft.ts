// Raw-material form persistence outside the domain state: a saved draft (localStorage, survives reloads)
// and a one-trip handoff (sessionStorage) that carries unsaved values to supplier creation and back.
import {storage} from '../../shared/lib/storage'
import {stamp} from '../../utils/dates'

export type MaterialFormValues={name:string;sku:string;category:string;unit:string;standardCost:string;minStock:string;reorderPoint:string;leadTime:string;lotTracking:boolean;expiryTracking:boolean;status:string;supplierId:string}
export type MaterialDraft={values:MaterialFormValues;savedAt:string}
type Handoff={target:string;values:MaterialFormValues}

/** 'new' for the create form, otherwise the material id being edited. */
export const formTarget=(materialId?:string)=>materialId||'new'
const draftKey=(target:string)=>`zenix-draft:raw-material:${target}`
const HANDOFF_KEY='zenix-handoff:raw-material'

export const loadMaterialDraft=(target:string)=>storage.get<MaterialDraft|null>(draftKey(target),null)

/** Writes the draft and reads it back; null means nothing was persisted. */
export function saveMaterialDraft(target:string,values:MaterialFormValues):MaterialDraft|null{
  const draft:MaterialDraft={values,savedAt:stamp()}
  if(!storage.set(draftKey(target),draft))return null
  const back=loadMaterialDraft(target)
  return back&&JSON.stringify(back.values)===JSON.stringify(values)?back:null
}
export const clearMaterialDraft=(target:string)=>storage.remove(draftKey(target))

export function writeHandoff(target:string,values:MaterialFormValues):boolean{
  try{sessionStorage.setItem(HANDOFF_KEY,JSON.stringify({target,values} satisfies Handoff));return true}catch{return false}
}
export function readHandoff(target:string):MaterialFormValues|null{
  try{const raw=sessionStorage.getItem(HANDOFF_KEY);const h=raw?JSON.parse(raw) as Handoff:null;return h?.target===target?h.values:null}catch{return null}
}
export function clearHandoff(){try{sessionStorage.removeItem(HANDOFF_KEY)}catch{/* storage unavailable */}}
