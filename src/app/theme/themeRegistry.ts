export type ThemeMode='light'|'dark'|'system'
export type AppearanceFamily='blue'|'cyan'|'mint'|'purple'|'orange'|'pink'|'neutral'|'minimal'
export type ResolvedTheme='light'|'dark'
export type AppearanceItem={id:string;name:string;family:AppearanceFamily;theme:ResolvedTheme;accent:string;preview?:string|null}

// Muted accents in the ZENIX POS family. WCAG AA: light accents carry white text at ≥ 5:1,
// dark accents reach ≥ 6.6:1 on the graphite surface and carry dark text. Sapphire is the
// shared ZENIX steel blue (POS default). Order follows the product's "Fon" menu:
// Emerald, Amber, Sapphire, Violet, Crimson, Neutral, Ocean, Minimal.
// A family is a colour identity (page tint, surface tint, accent) in both light and dark mode;
// it never forces dark mode.
export const APPEARANCE_PAIRS:{id:AppearanceFamily;label:string;light:AppearanceItem;dark:AppearanceItem}[]=[
  {id:'mint',label:'Emerald',light:{id:'emerald-mist',name:'Emerald',family:'mint',theme:'light',accent:'#3D7A5E'},dark:{id:'emerald-night',name:'Emerald',family:'mint',theme:'dark',accent:'#7FB89A'}},
  {id:'orange',label:'Amber',light:{id:'amber-mist',name:'Amber',family:'orange',theme:'light',accent:'#86602D'},dark:{id:'amber-night',name:'Amber',family:'orange',theme:'dark',accent:'#D4AA73'}},
  {id:'blue',label:'Sapphire',light:{id:'sapphire-mist',name:'Sapphire',family:'blue',theme:'light',accent:'#4D6E9F'},dark:{id:'sapphire-night',name:'Sapphire',family:'blue',theme:'dark',accent:'#8FA8CC'}},
  {id:'purple',label:'Violet',light:{id:'violet-mist',name:'Violet',family:'purple',theme:'light',accent:'#66588F'},dark:{id:'violet-night',name:'Violet',family:'purple',theme:'dark',accent:'#AB9CD0'}},
  {id:'pink',label:'Crimson',light:{id:'crimson-mist',name:'Crimson',family:'pink',theme:'light',accent:'#9A4859'},dark:{id:'crimson-night',name:'Crimson',family:'pink',theme:'dark',accent:'#D58C9A'}},
  {id:'neutral',label:'Neutral',light:{id:'neutral-mist',name:'Neutral',family:'neutral',theme:'light',accent:'#4F5862'},dark:{id:'neutral-night',name:'Neutral',family:'neutral',theme:'dark',accent:'#B0B7BF'}},
  {id:'cyan',label:'Ocean',light:{id:'ocean-mist',name:'Ocean',family:'cyan',theme:'light',accent:'#3A6F80'},dark:{id:'ocean-night',name:'Ocean',family:'cyan',theme:'dark',accent:'#7FB4C4'}},
  {id:'minimal',label:'Minimal',light:{id:'minimal-light',name:'Minimal',family:'minimal',theme:'light',accent:'#3F63A0'},dark:{id:'minimal-dark',name:'Minimal',family:'minimal',theme:'dark',accent:'#8AA6D6'}},
]
export const backgroundsForTheme=(theme:ResolvedTheme)=>APPEARANCE_PAIRS.map(p=>p[theme])
export const pairFor=(family:AppearanceFamily,theme:ResolvedTheme)=>APPEARANCE_PAIRS.find(p=>p.id===family)?.[theme]??APPEARANCE_PAIRS[2][theme]
