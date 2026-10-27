/** Geometry of the edge-docked AI launcher: X is fixed by CSS, only Y moves, within the usable height. */
export const DOCK_H=44,TOP_SAFE=118,BOTTOM_SAFE=20
export const DOCK_POSITION_KEY='zenix-ai-dock-position'
export const DEFAULT_RATIO=.82

export const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))

/** Usable vertical band: below the topbar/subnav, above the bottom edge and the device's safe area. */
export function dockBounds(viewport:number,safeBottom=0){
  const min=TOP_SAFE,max=Math.max(min,viewport-DOCK_H-BOTTOM_SAFE-Math.max(0,safeBottom))
  return {min,max}
}

/** The stored position is a 0–1 ratio of the band, so it stays valid when the window is resized. */
export const topFromRatio=(ratio:number,viewport:number,safeBottom=0)=>{const {min,max}=dockBounds(viewport,safeBottom);return min+clamp(ratio,0,1)*(max-min)}
export const ratioFromTop=(top:number,viewport:number,safeBottom=0)=>{const {min,max}=dockBounds(viewport,safeBottom);return max>min?(clamp(top,min,max)-min)/(max-min):0}

/** A missing, corrupt or out-of-range saved value falls back to the default spot. */
export function readRatio(saved:unknown){const n=Number(saved);return Number.isFinite(n)&&saved!==null&&saved!==''?clamp(n,0,1):DEFAULT_RATIO}
