import {APPEARANCE_PAIRS,pairFor} from './themeRegistry'
import type {AppearanceFamily,ResolvedTheme,ThemeMode} from './themeRegistry'

export type Density='compact'|'standard'|'comfortable'
export type FontSize='small'|'standard'|'large'
/** Appearance preferences that change how the whole app looks (not business data). */
export type AppearancePrefs={theme:ThemeMode;appearance:AppearanceFamily;fontSize:FontSize;uiDensity:Density;tableDensity:Density;reducedMotion:boolean}

export const DENSITIES:Density[]=['compact','standard','comfortable']
export const DENSITY_LABEL:Record<Density,string>={compact:'Ixcham',standard:'Standart',comfortable:'Keng'}
export const DEFAULT_PREFS:AppearancePrefs={theme:'system',appearance:'blue',fontSize:'standard',uiDensity:'standard',tableDensity:'standard',reducedMotion:false}

const THEMES:ThemeMode[]=['light','dark','system']
const FONT_SIZES:FontSize[]=['small','standard','large']

/**
 * Older builds stored a family id, a light/dark item id (`emerald-night`) or a display name (`Graphite`).
 * Every one of them maps to a supported family; anything unknown falls back to the default.
 */
export function normalizeFamily(value:unknown):AppearanceFamily{
  const v=String(value??'').trim().toLowerCase()
  for(const p of APPEARANCE_PAIRS){
    if(v===p.id||v===p.light.id||v===p.dark.id||v===p.label.toLowerCase()||v===p.light.name.toLowerCase())return p.id
  }
  if(v==='graphite'||v==='slate'||v==='night')return 'neutral'
  if(v==='emerald'||v==='green')return 'mint'
  if(v==='steel'||v==='zenix'||v==='sapphire')return 'blue'
  return DEFAULT_PREFS.appearance
}

/** Fills missing values and replaces unsupported ones, so a stale or hand-edited save can never break the shell. */
export function normalizePrefs(input:Partial<Record<keyof AppearancePrefs,unknown>>|undefined):AppearancePrefs{
  const s=input||{}
  const pick=<T extends string>(value:unknown,allowed:T[],fallback:T)=>allowed.includes(value as T)?value as T:fallback
  return {
    theme:pick(s.theme,THEMES,DEFAULT_PREFS.theme),
    appearance:normalizeFamily(s.appearance??DEFAULT_PREFS.appearance),
    fontSize:pick(s.fontSize,FONT_SIZES,DEFAULT_PREFS.fontSize),
    uiDensity:pick(s.uiDensity,DENSITIES,DEFAULT_PREFS.uiDensity),
    tableDensity:pick(s.tableDensity,DENSITIES,DEFAULT_PREFS.tableDensity),
    reducedMotion:s.reducedMotion===true,
  }
}

export const resolveTheme=(mode:ThemeMode,systemDark:boolean):ResolvedTheme=>mode==='system'?(systemDark?'dark':'light'):mode

/**
 * Writes the preferences onto <html>. Everything — the page, portals (dialogs, menus), charts — reads its
 * colours and sizes from tokens keyed on these attributes, so one place changes the whole app.
 */
export function applyAppearance(root:HTMLElement,prefs:AppearancePrefs,resolved:ResolvedTheme){
  const item=pairFor(prefs.appearance,resolved)
  root.dataset.theme=resolved
  root.dataset.bg=item.id
  root.dataset.family=prefs.appearance
  root.dataset.fontSize=prefs.fontSize
  root.dataset.density=prefs.uiDensity
  root.dataset.tableDensity=prefs.tableDensity
  root.style.setProperty('--accent',item.accent)
  root.style.colorScheme=resolved
  root.classList.toggle('reduced-motion',prefs.reducedMotion)
  return item
}
