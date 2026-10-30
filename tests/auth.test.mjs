// Frontend demo login (src/domain/auth.ts + shared/lib/crypto.ts): set-up, sign-in, lockout, sessions,
// account administration and the "always one Super Admin who can sign in" rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import * as Auth from '../.test-dist/auth.mjs'
import {makeCredential,newRecoveryKey,normalizeRecoveryKey,verifyPassword,verifyRecoveryTicket,hashPassword,sameDigest} from '../.test-dist/crypto.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

let n=0
const id=p=>`${p}-u${++n}`
const at=(iso)=>new Date(iso)
const T0='2026-10-20T08:00:00.000Z'
const ctx=(s,actorId,now=at(T0))=>({now,actor:actorId?s.employees.find(e=>e.id===actorId):undefined,id})
const cred={hash:'h',salt:'s',iterations:1}
const ok=(out)=>{assert.equal(out.error,undefined,out.error);return out}

/** Store after set-up: em1 is Super Admin with account "boss". */
function setUp(){
  const s=createSeedState(at(T0))
  const out=ok(Auth.setupFirstAdmin(Auth.emptyAuthStore(),s,ctx(s),{employeeId:'em1',username:'boss',credential:cred}))
  return {store:out.store,s:out.state}
}

test('passwords are salted PBKDF2 hashes, never plain text, and verify only with the right password',async()=>{
  const c=await makeCredential('Zenix2026')
  assert.notEqual(c.hash,'Zenix2026')
  assert.equal(c.hash.length,64)
  assert.ok(c.iterations>=100000)
  assert.ok(await verifyPassword('Zenix2026',c))
  assert.equal(await verifyPassword('zenix2026',c),false)
  const again=await makeCredential('Zenix2026')
  assert.notEqual(again.hash,c.hash,'a new salt gives a new hash')
  assert.equal(await hashPassword('x',c.salt,1000),await hashPassword('x',c.salt,1000))
  assert.ok(sameDigest('ab','ab')&&!sameDigest('ab','ac')&&!sameDigest('ab','abc'))
})

test('password policy: length and letter + digit',()=>{
  const p=Auth.DEFAULT_POLICY
  assert.match(Auth.validatePassword(p,'Ab1'),/kamida 8/)
  assert.match(Auth.validatePassword(p,'abcdefgh'),/harf va bitta raqam/)
  assert.equal(Auth.validatePassword(p,'abcdefg1'),null)
})

test('first run: no default account; set-up makes the chosen employee Super Admin, only once',()=>{
  const empty=Auth.emptyAuthStore()
  assert.equal(empty.accounts.length,0,'no built-in admin password exists')
  const {store,s}=setUp()
  assert.equal(store.accounts.length,1)
  assert.equal(s.roles.find(r=>r.id===s.employees.find(e=>e.id==='em1').roleId).key,'super_admin')
  assert.equal(JSON.stringify(store).includes('Zenix'),false)
  assert.match(Auth.setupFirstAdmin(store,s,ctx(s),{employeeId:'em2',username:'x2',credential:cred}).error,/allaqachon/)
  assert.equal(store.events[0].type,'setup')
})

test('sign-in by username or e-mail; wrong attempts lock the login for a while, also for unknown logins',()=>{
  let {store,s}=setUp()
  store={...store,accounts:store.accounts.map(a=>({...a,email:'boss@zenix.uz'}))}
  assert.equal(Auth.findAccount(store,'BOSS')?.username,'boss')
  assert.equal(Auth.findAccount(store,'boss@zenix.uz')?.username,'boss')
  const acc=store.accounts[0]
  for(let i=0;i<4;i++)store=Auth.recordFailure(store,ctx(s),'boss',acc)
  assert.equal(Auth.lockState(store,'boss',at(T0)),undefined,'four mistakes: not locked yet')
  store=Auth.recordFailure(store,ctx(s),'boss',acc)
  const until=Auth.lockState(store,'boss',at(T0))
  assert.ok(until,'fifth mistake locks')
  assert.equal(Auth.lockState(store,'boss',at('2026-10-20T08:16:00.000Z')),undefined,'lock ends after 15 minutes')
  assert.ok(store.events.some(e=>e.type==='lockout'))
  let ghost=Auth.emptyAuthStore()
  for(let i=0;i<5;i++)ghost=Auth.recordFailure(ghost,ctx(s),'nobody')
  assert.ok(Auth.lockState(ghost,'nobody',at(T0)),'an unknown login is locked the same way')
})

test('a correct password still does not let in a blocked account or an archived employee',()=>{
  let {store,s}=setUp()
  const acc=store.accounts[0]
  assert.equal(Auth.signInBlocker(s,acc),null)
  assert.match(Auth.signInBlocker(s,{...acc,status:'blocked'}),/bloklangan/)
  assert.match(Auth.signInBlocker({...s,employees:s.employees.map(e=>e.id==='em1'?{...e,status:'Arxiv'}:e)},acc),/arxivlangan/)
})

test('sessions: expire, end after inactivity unless remembered, and end when the account is blocked',()=>{
  let {store,s}=setUp()
  const acc=store.accounts[0]
  const plain=Auth.recordSuccess(store,ctx(s,'em1'),acc,false)
  assert.equal(Auth.sessionProblem(plain.session,plain.store,s,at(T0)),null)
  assert.equal(Auth.sessionProblem(plain.session,plain.store,s,at('2026-10-20T08:31:00.000Z')),'idle')
  assert.equal(Auth.sessionProblem({...plain.session,lastActivity:'2026-10-20T19:59:00.000Z'},plain.store,s,at('2026-10-20T20:01:00.000Z')),'expired','12 hours at most')
  const kept=Auth.recordSuccess(store,ctx(s,'em1'),acc,true)
  assert.equal(Auth.sessionProblem(kept.session,kept.store,s,at('2026-10-25T08:00:00.000Z')),null,'remember me: no idle timeout')
  assert.equal(Auth.sessionProblem(kept.session,kept.store,s,at('2026-11-20T08:00:01.000Z')),'expired','remember me ends after 30 days')
  const blocked={...kept.store,accounts:kept.store.accounts.map(a=>({...a,status:'blocked'}))}
  assert.equal(Auth.sessionProblem(kept.session,blocked,s,at(T0)),'blocked')
  assert.equal(Auth.sessionProblem(null,kept.store,s,at(T0)),'missing')
  assert.equal(plain.store.events[0].type,'login')
})

test('account administration follows rank: the admin manages lower roles only, never itself',()=>{
  let {store,s}=setUp()
  // em2 production manager: no account rights over em1 (Super Admin) or peers.
  const made=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em3',username:'operator1',credential:cred}))
  store=made.store
  assert.equal(store.accounts.find(a=>a.username==='operator1').mustChangePassword,true,'a temporary password by default')
  assert.match(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em3',username:'other',credential:cred}).error,/allaqachon/)
  assert.match(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em4',username:'operator1',credential:cred}).error,/band/)
  assert.match(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em4',username:'a b',credential:cred}).error,/Login/)
  const mgr=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em2',username:'manager',credential:cred}));store=mgr.store
  const boss=store.accounts.find(a=>a.username==='boss'),op=store.accounts.find(a=>a.username==='operator1')
  assert.match(Auth.setAccountStatus(store,s,ctx(s,'em2'),boss.id,'blocked').error,/Super Admin|darajangizda/)
  assert.match(Auth.setAccountStatus(store,s,ctx(s,'em2'),op.id,'blocked').error,/darajangizda/,'same rank: no')
  assert.match(Auth.setAccountStatus(store,s,ctx(s,'em1'),boss.id,'blocked').error,/O‘z akkauntingiz/)
  const blocked=ok(Auth.setAccountStatus(store,s,ctx(s,'em1'),op.id,'blocked'))
  assert.equal(blocked.store.accounts.find(a=>a.id===op.id).status,'blocked')
  const reset=ok(Auth.resetPassword(blocked.store,s,ctx(s,'em1'),op.id,{hash:'n',salt:'n',iterations:1}))
  assert.equal(reset.store.accounts.find(a=>a.id===op.id).mustChangePassword,true)
  const changed=ok(Auth.changeOwnPassword(reset.store,ctx(s,'em3'),op.id,{hash:'m',salt:'m',iterations:1}))
  assert.equal(changed.store.accounts.find(a=>a.id===op.id).mustChangePassword,false)
})

test('the last active Super Admin account can never be blocked or deleted',()=>{
  let {store,s}=setUp()
  const boss=store.accounts[0]
  // A second Super Admin acts on the first.
  s={...s,employees:s.employees.map(e=>e.id==='em2'?{...e,roleId:'role0'}:e)}
  store=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em2',username:'deputy',credential:cred})).store
  const deputy=store.accounts.find(a=>a.username==='deputy')
  assert.equal(Auth.activeSuperAdmins(store,s).length,2)
  const one=ok(Auth.setAccountStatus(store,s,ctx(s,'em2'),boss.id,'blocked')).store
  assert.equal(Auth.activeSuperAdmins(one,s).length,1)
  assert.match(Auth.deleteAccount(one,s,ctx(s,'em1'),deputy.id).error,/Oxirgi faol Super Admin/,'even another Super Admin cannot remove the last active one')
  assert.match(Auth.setAccountStatus(one,s,ctx(s,'em1'),deputy.id,'blocked').error,/Oxirgi faol Super Admin/)
  assert.equal(Auth.superAdminInvariant(one,s),true)
  assert.equal(Auth.superAdminInvariant(one,{...s,employees:s.employees.map(e=>e.id==='em2'?{...e,status:'Arxiv'}:e)}),false,'archiving the deputy would leave nobody: the app refuses such a change')
})

test('security policy changes are validated and logged',()=>{
  const {store,s}=setUp()
  assert.match(Auth.updatePolicy(store,ctx(s,'em1'),{minPasswordLength:4}).error,/8–64/)
  const out=ok(Auth.updatePolicy(store,ctx(s,'em1'),{idleMinutes:15}))
  assert.equal(out.store.policy.idleMinutes,15)
  assert.equal(out.store.events[0].type,'policy_changed')
})

test('an older or damaged auth store is read with defaults instead of failing',()=>{
  const s=Auth.normalizeAuthStore({accounts:'x',policy:{idleMinutes:10}})
  assert.deepEqual(s.accounts,[])
  assert.equal(s.policy.idleMinutes,10)
  assert.equal(s.policy.maxFailedAttempts,Auth.DEFAULT_POLICY.maxFailedAttempts)
  assert.deepEqual(Auth.normalizeAuthStore(null).accounts,[])
})

test('registration: each field is checked in the order shown',()=>{
  const p=Auth.DEFAULT_POLICY,good={name:'Abdulloh',company:'Zavod',username:'boss',email:'',password:'Zenix2026',confirm:'Zenix2026'}
  assert.equal(Auth.registrationProblem(p,good),null)
  assert.equal(Auth.registrationProblem(p,{...good,name:' '}).field,'name')
  assert.equal(Auth.registrationProblem(p,{...good,company:''}).field,'company')
  assert.equal(Auth.registrationProblem(p,{...good,username:'a b'}).field,'username')
  assert.equal(Auth.registrationProblem(p,{...good,email:'x'}).field,'email')
  assert.equal(Auth.registrationProblem(p,{...good,password:'Ab1',confirm:'Ab1'}).field,'password')
  assert.equal(Auth.registrationProblem(p,{...good,confirm:'Zenix2027'}).field,'confirm')
})

test('registration: name and company go to the owner profile and settings; other employees and a second run are untouched',()=>{
  const s=createSeedState(at(T0))
  const out=ok(Auth.setupFirstAdmin(Auth.emptyAuthStore(),s,ctx(s),{employeeId:'em1',username:'boss',name:' Abdulloh Xoji ',company:' Yangi Zavod ',credential:cred,recovery:cred}))
  assert.equal(out.state.settings.company.name,'Yangi Zavod')
  assert.equal(out.state.settings.company.currency,s.settings.company.currency)
  assert.equal(out.state.employees.find(e=>e.id==='em1').name,'Abdulloh Xoji')
  assert.deepEqual(out.state.employees.filter(e=>e.id!=='em1'),s.employees.filter(e=>e.id!=='em1'))
  assert.deepEqual(out.store.accounts[0].recovery,cred)
  assert.match(Auth.setupFirstAdmin(out.store,out.state,ctx(s),{employeeId:'em2',username:'x2',name:'Boshqa',credential:cred}).error,/allaqachon/)
})

test('recovery key: 100 random bits, shown once, typed in any case; only its hash is kept',async()=>{
  const key=newRecoveryKey()
  assert.match(key,/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/)
  assert.notEqual(newRecoveryKey(),key)
  assert.equal(normalizeRecoveryKey(key.toLowerCase().replaceAll('-',' ')),key.replaceAll('-',''))
  const c=await makeCredential(normalizeRecoveryKey(key))
  assert.ok(await verifyPassword(normalizeRecoveryKey(key),c))
  assert.equal(JSON.stringify(c).includes(normalizeRecoveryKey(key)),false)
})

test('owner recovery: only an active Super Admin, whether or not a key exists',()=>{
  const {store,s}=setUp()
  const boss=store.accounts[0]
  assert.equal(Auth.ownerRecoveryBlocker(store,s,boss),null)
  const two=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em3',username:'dilshod',credential:cred})).store
  assert.match(Auth.ownerRecoveryBlocker(two,s,two.accounts[1]),/faqat faol Super Admin/,'an employee asks an administrator')
  assert.match(Auth.ownerRecoveryBlocker(store,s,undefined),/faqat faol Super Admin/)
  const blocked={...store,accounts:[{...boss,status:'blocked'}]}
  assert.match(Auth.ownerRecoveryBlocker(blocked,s,blocked.accounts[0]),/faqat faol Super Admin/)
  const keyed=ok(Auth.setRecoveryKey(store,s,ctx(s,'em1'),boss.id,cred)).store
  assert.equal(Auth.ownerRecoveryBlocker(keyed,s,keyed.accounts[0]),null,'a lost key does not lock the owner out')
})

test('owner ticket: the script signs, the app verifies; login, code, expiry, key and signature all bind it',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zenix-recovery-'))
  const run=(...args)=>spawnSync(process.execPath,['scripts/auth-recovery.mjs',...args],{encoding:'utf8'})
  try{
    const keyFile=path.join(dir,'owner.jwk'),otherFile=path.join(dir,'other.jwk')
    const made=run('keygen','--key-file',keyFile)
    assert.equal(made.status,0,made.stderr)
    const publicKey=made.stdout.match(/VITE_RECOVERY_PUBLIC_KEY=(\S+)/)[1]
    assert.equal(made.stdout.includes(JSON.parse(fs.readFileSync(keyFile,'utf8')).d),false,'the private part is never printed')
    assert.notEqual(run('keygen','--key-file',keyFile).status,0,'an existing key is not replaced')
    assert.notEqual(run('keygen','--key-file','inside-repo.jwk').status,0,'the private key cannot be written into the repository')
    assert.equal(fs.existsSync('inside-repo.jwk'),false)

    const ticket=run('ticket','--login','boss','--code','abc123','--key-file',keyFile).stdout.trim()
    const check=(t=ticket,login='boss',code='abc123',now=Date.now(),key=publicKey)=>verifyRecoveryTicket(key,t,e=>Auth.recoveryTicketMessage(login,code,e),now)
    assert.equal(await check(),true)
    assert.equal(await check(ticket,'dilshod'),false,'another login')
    assert.equal(await check(ticket,'boss','eski-kod'),false,'another visit of the page')
    assert.equal(await check(ticket,'boss','abc123',Date.now()+16*60000),false,'expired')
    assert.equal(await check(ticket,'boss','abc123',Date.now(),''),false,'no public key in the build')
    assert.equal(await check(''),false)
    assert.equal(await check('ZXR1.9999999999999.AAAA'),false,'no signature')
    const [,expires,signature]=ticket.split('.')
    assert.equal(await check(`ZXR1.${Number(expires)+1}.${signature}`),false,'a moved expiry breaks the signature')
    run('keygen','--key-file',otherFile)
    const forged=run('ticket','--login','boss','--code','abc123','--key-file',otherFile).stdout.trim()
    assert.equal(await check(forged),false,'signed with another private key')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('first setup runs only without a company owner: an existing, lost or damaged account store never opens it',()=>{
  const fresh=createSeedState(at(T0)),empty=Auth.emptyAuthStore()
  assert.equal(Auth.bootstrapBlocker(empty,fresh),null)
  assert.equal(Auth.bootstrapBlocker(empty,fresh,JSON.stringify(empty)),null,'a failed sign-in on a fresh browser stores an empty list')
  const {store,s}=setUp()
  assert.match(Auth.bootstrapBlocker(store,s),/allaqachon/)
  assert.match(Auth.bootstrapBlocker(empty,fresh,JSON.stringify(store)),/allaqachon/,'another tab has just registered')
  assert.match(Auth.bootstrapBlocker(empty,s),/egasi allaqachon bo‘lgan/,'accounts deleted, the company is still here')
  assert.match(Auth.bootstrapBlocker({...empty,events:store.events},fresh),/egasi allaqachon bo‘lgan/)
  assert.match(Auth.bootstrapBlocker(empty,fresh,'{bad json'),/o‘qib bo‘lmadi/)
  assert.match(Auth.bootstrapBlocker(empty,fresh,'null'),/o‘qib bo‘lmadi/)
  assert.match(Auth.bootstrapBlocker(empty,fresh,JSON.stringify({accounts:[null]})),/o‘qib bo‘lmadi/,'an entry that cannot be read is not an empty list')
  assert.match(Auth.setupFirstAdmin(empty,s,ctx(s),{employeeId:'em2',username:'stranger',name:'Begona',company:'Boshqa',credential:cred}).error,/egasi allaqachon bo‘lgan/)
  assert.equal(Auth.authStorageDamaged(null),false)
  assert.equal(Auth.authStorageDamaged(JSON.stringify(store)),false)
})

test('an account saved before recovery keys keeps working unchanged',()=>{
  const {store,s}=setUp()
  const {recovery:_,...legacy}=store.accounts[0]
  const raw=JSON.stringify({version:1,accounts:[legacy],policy:{},events:[],attempts:{}})
  assert.deepEqual(Auth.normalizeAuthStore(JSON.parse(raw)).accounts,JSON.parse(raw).accounts,'nothing is added or dropped on load')
  assert.equal(Auth.signInBlocker(s,legacy),null)
  assert.equal(Auth.authStorageDamaged(raw),false)
})

test('recoverPassword: replaces password and key of one account, clears its locks, ends old sessions, keeps data and role',()=>{
  const {store,s}=setUp()
  const boss=store.accounts[0]
  const other=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em3',username:'dilshod',credential:cred})).store
  const session={id:'s1',accountId:boss.id,employeeId:'em1',startedAt:T0,lastActivity:T0,expiresAt:'2026-10-21T00:00:00.000Z',remember:true}
  const locked={...other,attempts:{boss:{count:0,lockedUntil:'2026-10-20T09:00:00.000Z'},[Auth.recoveryAttemptKey('boss')]:{count:2},dilshod:{count:1}},accounts:other.accounts.map(a=>a.id===boss.id?{...a,lockedUntil:'2026-10-20T09:00:00.000Z',failedCount:3,mustChangePassword:true}:a)}
  const later=at('2026-10-20T08:30:00.000Z')
  const out=ok(Auth.recoverPassword(locked,{now:later,id},boss.id,{credential:{hash:'new',salt:'n',iterations:1},recovery:{hash:'key2',salt:'k',iterations:1},method:'ticket'}))
  assert.equal(out.state,undefined,'business data is not part of a recovery')
  const after=out.store.accounts[0]
  assert.equal(after.hash,'new')
  assert.equal(after.recovery.hash,'key2')
  assert.equal(after.id,boss.id)
  assert.equal(after.employeeId,'em1')
  assert.equal(after.mustChangePassword,false)
  assert.equal(after.lockedUntil,undefined)
  assert.equal(after.failedCount,0)
  assert.deepEqual(out.store.accounts[1],other.accounts[1])
  assert.deepEqual(Object.keys(out.store.attempts),['dilshod'])
  assert.equal(out.store.events[0].type,'password_recovered')
  assert.match(out.store.events[0].detail,/imzolangan chipta/)
  assert.equal(Auth.sessionProblem(session,out.store,s,later),'credentials')
  assert.equal(JSON.stringify(out.store.events).includes('key2'),false)
})

test('a recovery attempt counts apart from sign-ins and locks only recovery',()=>{
  const {store,s}=setUp()
  let next=store
  for(let i=0;i<Auth.DEFAULT_POLICY.maxFailedAttempts;i++)next=Auth.recordFailure(next,ctx(s),Auth.recoveryAttemptKey('boss'))
  assert.ok(Auth.lockState(next,Auth.recoveryAttemptKey('BOSS'),at(T0)))
  assert.equal(Auth.lockState(next,'boss',at(T0)),undefined,'the owner can still try to sign in')
})

test('a recovery key is made only by a Super Admin account',()=>{
  const {store,s}=setUp()
  const two=ok(Auth.createAccount(store,s,ctx(s,'em1'),{employeeId:'em3',username:'dilshod',credential:cred})).store
  assert.match(Auth.setRecoveryKey(two,s,ctx(s,'em3'),two.accounts[1].id,cred).error,/faqat Super Admin/)
  assert.equal(ok(Auth.setRecoveryKey(two,s,ctx(s,'em1'),two.accounts[0].id,cred)).store.events[0].type,'recovery_key_created')
})
