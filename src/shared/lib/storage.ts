export const storage = {
  get<T>(key:string, fallback:T):T {
    try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw) as T:fallback } catch { return fallback }
  },
  /** The stored text as is (null when absent or storage is unavailable) — lets callers tell "missing" from "unreadable". */
  getRaw(key:string):string|null{ try{ return localStorage.getItem(key) }catch{ return null } },
  /** Returns false when the write failed (quota exceeded, storage disabled, private mode). */
  set<T>(key:string,value:T):boolean{ try{ localStorage.setItem(key,JSON.stringify(value)); return true }catch{ return false } },
  /** Writes already serialised text. Returns false when the write failed. */
  setRaw(key:string,text:string):boolean{ try{ localStorage.setItem(key,text); return true }catch{ return false } },
  remove(key:string){ try{ localStorage.removeItem(key) }catch{} }
}
