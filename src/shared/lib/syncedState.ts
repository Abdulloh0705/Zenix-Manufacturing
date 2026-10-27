// Read-before-write for one state blob shared by every tab of the browser through a single storage key (BUG-14).
// A tab continues from whatever another tab saved since it last read or wrote, instead of overwriting it with
// its own older copy. Browser storage has no locks: two tabs writing in the same few milliseconds can still race,
// so this narrows the window to one synchronous read-modify-write; it is not a transaction.

export type RawStore={getRaw(key:string):string|null;setRaw(key:string,text:string):boolean}
export type WriteResult='same'|'saved'|'failed'|'conflict'

export type SyncedSlot<T>={
  /** The newest state: what another tab saved since this tab last read or wrote, otherwise `current`. */
  latest(current:T):{state:T;changed:boolean};
  /**
   * Saves now. 'same' when the text equals the last one read or written, 'failed' when storage refused it,
   * 'conflict' (nothing written) when another tab saved readable data this tab has not read yet — the caller
   * continues from `latest()` instead of overwriting it.
   */
  write(state:T):WriteResult;
  /** Accepts text that arrived from another tab (storage event); false when it is this tab's own or unreadable. */
  receive(raw:string|null):T|null;
}

export function createSyncedSlot<T>(store:RawStore,key:string,parse:(raw:string)=>T|null,initialText:string|null):SyncedSlot<T>{
  let lastText=initialText
  const read=(raw:string|null):T|null=>{
    if(raw===null||raw===lastText)return null
    let parsed:T|null=null
    // A half-written or foreign value is ignored; the next save of the other tab arrives again.
    try{parsed=parse(raw)}catch{parsed=null}
    if(parsed===null)return null
    lastText=raw
    return parsed
  }
  return {
    latest(current){const next=read(store.getRaw(key));return next===null?{state:current,changed:false}:{state:next,changed:true}},
    write(state){
      const text=JSON.stringify(state)
      if(text===lastText)return 'same'
      const stored=store.getRaw(key)
      if(stored!==null&&stored!==lastText&&stored!==text){
        // Unreadable text (a half-written value) is not worth keeping over this tab's state; readable data is.
        let readable=false
        try{readable=parse(stored)!==null}catch{readable=false}
        if(readable)return 'conflict'
      }
      if(!store.setRaw(key,text))return 'failed'
      lastText=text
      return 'saved'
    },
    receive:read,
  }
}
