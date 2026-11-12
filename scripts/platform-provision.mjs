// Offline demo provisioning. Keep the private key outside this repository and browser profile.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'

const {values,positionals}=parseArgs({allowPositionals:true,options:{actor:{type:'string'},minutes:{type:'string',default:'30'},'key-file':{type:'string',default:path.join(os.homedir(),'.zenix','platform-private.jwk')}}})
const [command]=positionals,keyFile=path.resolve(values['key-file'])
const fail=message=>{console.error(message);process.exit(1)}
const b64=bytes=>Buffer.from(bytes).toString('base64url')
if(command==='keygen'){
  const relative=path.relative(process.cwd(),keyFile)
  if(!relative.startsWith('..')&&!path.isAbsolute(relative))fail('Private key must be outside the repository.')
  if(fs.existsSync(keyFile))fail('Key already exists; refusing to replace it.')
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  fs.mkdirSync(path.dirname(keyFile),{recursive:true})
  fs.writeFileSync(keyFile,JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey)),{mode:0o600})
  console.log(`Private key saved: ${keyFile}`)
  console.log(`VITE_PLATFORM_PUBLIC_KEY=${b64(await crypto.subtle.exportKey('raw',pair.publicKey))}`)
}else if(command==='ticket'){
  const actor=values.actor?.trim(),minutes=Number(values.minutes)
  if(!actor||!/^[a-zA-Z0-9._-]{3,48}$/.test(actor))fail('Use --actor with a 3–48 character operator ID.')
  if(!Number.isInteger(minutes)||minutes<1||minutes>60)fail('--minutes must be 1–60.')
  if(!fs.existsSync(keyFile))fail('Private key not found. Run keygen first.')
  const key=await crypto.subtle.importKey('jwk',JSON.parse(fs.readFileSync(keyFile,'utf8')),{name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const expiresAt=Date.now()+minutes*60000
  const message=new TextEncoder().encode(`zenix-platform-v1|${actor}|${expiresAt}`)
  console.log(`ZXR1.${expiresAt}.${b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,message))}`)
}else fail('Usage: node scripts/platform-provision.mjs keygen | ticket --actor <operator-id>')
