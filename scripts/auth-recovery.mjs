// Owner password recovery, run on the owner's machine (docs/AUTH.md). The private key stays outside the repository
// and the app: the build holds only the public key, so a person at the browser cannot make a ticket.
//   node scripts/auth-recovery.mjs keygen
//   node scripts/auth-recovery.mjs ticket --login "<login>" --code <code>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'

const ALGORITHM={name:'ECDSA',namedCurve:'P-256'},SIGN={name:'ECDSA',hash:'SHA-256'}
const DEFAULT_KEY_FILE=path.join(os.homedir(),'.zenix','recovery-private.jwk')
const fail=message=>{console.error(message);process.exit(1)}

const {values,positionals}=parseArgs({allowPositionals:true,options:{login:{type:'string'},code:{type:'string'},minutes:{type:'string',default:'15'},'key-file':{type:'string',default:DEFAULT_KEY_FILE}}})
const [command]=positionals,keyFile=path.resolve(values['key-file'])
const base64url=bytes=>Buffer.from(bytes).toString('base64url')

async function keygen(){
  const inRepo=!path.relative(process.cwd(),keyFile).startsWith('..')&&!path.isAbsolute(path.relative(process.cwd(),keyFile))
  if(inRepo)fail('The private key must stay outside the repository: choose another --key-file.')
  if(fs.existsSync(keyFile))fail(`${keyFile} already exists: replacing it would invalidate the public key in your builds.`)
  const pair=await crypto.subtle.generateKey(ALGORITHM,true,['sign','verify'])
  fs.mkdirSync(path.dirname(keyFile),{recursive:true})
  fs.writeFileSync(keyFile,JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey)),{mode:0o600})
  console.log(`Private key saved: ${keyFile}\nAdd this line to .env.local (or the deployment's build settings), then restart or rebuild:\n`)
  console.log(`VITE_RECOVERY_PUBLIC_KEY=${base64url(await crypto.subtle.exportKey('raw',pair.publicKey))}`)
}

async function ticket(){
  const minutes=Number(values.minutes)
  if(!values.login||!values.code)fail('Both --login and --code are required: copy the command from the recovery page.')
  if(!Number.isInteger(minutes)||minutes<1||minutes>60)fail('--minutes must be 1–60.')
  if(!fs.existsSync(keyFile))fail(`${keyFile} not found: run keygen first, or pass --key-file.`)
  const key=await crypto.subtle.importKey('jwk',JSON.parse(fs.readFileSync(keyFile,'utf8')),ALGORITHM,false,['sign'])
  const expiresAt=Date.now()+minutes*60000
  // Same text as recoveryTicketMessage in src/domain/auth.ts.
  const message=new TextEncoder().encode(`zenix-recovery-v1|${values.login}|${values.code}|${expiresAt}`)
  console.log(`ZXR1.${expiresAt}.${base64url(await crypto.subtle.sign(SIGN,key,message))}`)
}

if(command==='keygen')await keygen()
else if(command==='ticket')await ticket()
else fail('Usage: node scripts/auth-recovery.mjs keygen | ticket --login "<login>" --code <code>')
