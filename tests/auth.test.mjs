// Frontend demo login (src/domain/auth.ts + shared/lib/crypto.ts): set-up, sign-in, lockout, sessions,
// account administration and the "always one Super Admin who can sign in" rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Auth from '../.test-dist/auth.mjs'
import {makeCredential,verifyPassword,hashPassword,sameDigest} from '../.test-dist/crypto.mjs'
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
