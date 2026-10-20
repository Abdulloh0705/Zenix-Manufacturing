import {useEffect,useState} from 'react'

export function useMediaQuery(query:string){
  const [matches,setMatches]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.(query).matches)
  useEffect(()=>{
    const mq=window.matchMedia?.(query)
    if(!mq)return
    const update=()=>setMatches(mq.matches)
    update()
    mq.addEventListener('change',update)
    return()=>mq.removeEventListener('change',update)
  },[query])
  return Boolean(matches)
}
