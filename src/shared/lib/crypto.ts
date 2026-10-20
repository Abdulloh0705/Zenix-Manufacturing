// Password hashing for the frontend demo login: PBKDF2-SHA-256 via WebCrypto with a random salt per password.
// Hashes live in browser storage, so this only keeps passwords out of plain sight — it is not a substitute
// for server-side authentication (see docs/AUTH.md).

export const PBKDF2_ITERATIONS=210_000

const toHex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const fromHex=(hex:string)=>new Uint8Array((hex.match(/.{2}/g)||[]).map(h=>parseInt(h,16)))

export function randomSalt(bytes=16){
  const salt=new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(salt)
  return toHex(salt)
}

export async function hashPassword(password:string,salt:string,iterations=PBKDF2_ITERATIONS){
  const key=await globalThis.crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits'])
  const bits=await globalThis.crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromHex(salt),iterations},key,256)
  return toHex(bits)
}

/** Compares two hex digests in time independent of where they first differ. */
export function sameDigest(a:string,b:string){
  if(a.length!==b.length)return false
  let diff=0
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
  return diff===0
}

export async function makeCredential(password:string){
  const salt=randomSalt()
  return {salt,iterations:PBKDF2_ITERATIONS,hash:await hashPassword(password,salt,PBKDF2_ITERATIONS)}
}

export async function verifyPassword(password:string,credential:{hash:string;salt:string;iterations:number}){
  return sameDigest(await hashPassword(password,credential.salt,credential.iterations),credential.hash)
}
