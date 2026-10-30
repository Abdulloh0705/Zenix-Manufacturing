// Password hashing for the frontend demo login: PBKDF2-SHA-256 via WebCrypto with a random salt per password.
// Hashes live in browser storage, so this only keeps passwords out of plain sight — it is not a substitute
// for server-side authentication (see docs/AUTH.md).

export const PBKDF2_ITERATIONS=210_000

const toHex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const fromHex=(hex:string)=>new Uint8Array((hex.match(/.{2}/g)||[]).map(h=>parseInt(h,16)))
const fromBase64Url=(text:string)=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))

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

// 32 symbols without look-alikes (0/O, 1/I): 20 of them carry 100 random bits and survive being written down.
const KEY_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A recovery key as shown to the owner, once. Only its hash is stored. */
export function newRecoveryKey(){
  const bytes=new Uint8Array(20)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes,b=>KEY_ALPHABET[b&31]).join('').replace(/(.{5})(?=.)/g,'$1-')
}

/** The form that is hashed: a key typed in lower case or with other separators is still the same key. */
export const normalizeRecoveryKey=(key:string)=>key.toUpperCase().replace(/[^A-Z0-9]/g,'')

/**
 * Checks an owner's recovery ticket against the public key in the build. Signing needs the private key, which is
 * never in the app or the repository, so nothing in the browser can make a valid ticket (scripts/auth-recovery.mjs).
 */
export async function verifyRecoveryTicket(publicKey:string,ticket:string,message:(expiresAt:string)=>string,now:number){
  const parts=/^ZXR1\.(\d{10,16})\.([A-Za-z0-9_-]+)$/.exec(ticket.trim())
  if(!publicKey||!parts||Number(parts[1])<=now)return false
  try{
    const key=await globalThis.crypto.subtle.importKey('raw',fromBase64Url(publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
    return await globalThis.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromBase64Url(parts[2]),new TextEncoder().encode(message(parts[1])))
  }catch{return false}
}

export async function makeCredential(password:string){
  const salt=randomSalt()
  return {salt,iterations:PBKDF2_ITERATIONS,hash:await hashPassword(password,salt,PBKDF2_ITERATIONS)}
}

export async function verifyPassword(password:string,credential:{hash:string;salt:string;iterations:number}){
  return sameDigest(await hashPassword(password,credential.salt,credential.iterations),credential.hash)
}
