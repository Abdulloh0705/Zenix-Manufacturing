import './setup'
import {byText,cleanup,click,flush,render,type} from './helpers'
import {STATE_KEY} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react'
import {MemoryRouter,useLocation} from 'react-router-dom'
import App from '../../src/App'
import {AppProvider} from '../../src/app/providers/AppProvider/AppContext'
import {createInitialState} from '../../src/data/mockData'
import {recoveryTicketMessage} from '../../src/domain/auth'
import type {AuthStore} from '../../src/domain/auth'
import {makeCredential} from '../../src/shared/lib/crypto'

// Sign-in, registration and password recovery as a person meets them, with real hashing and the real router.
const AUTH_KEY='zenix-auth-v1',SESSION_KEY='zenix-session-v1',PASSWORD='Egasi2026x',NEW_PASSWORD='Yangi2026x'
const stored=()=>JSON.parse(localStorage.getItem(AUTH_KEY)||'{}') as AuthStore
const text=()=>document.body.textContent||''
const input=(id:string)=>document.getElementById(id)
let path=''
function Probe(){path=useLocation().pathname;return null}
afterEach(cleanup)

async function open(at='/',recoveryPublicKey=''){
  const view=await render(<MemoryRouter initialEntries={[at]}><AppProvider recoveryPublicKey={recoveryPublicKey}><App/><Probe/></AppProvider></MemoryRouter>)
  await flush(60)
  return view
}
/** Waits for hashing, which takes real time, until `done` holds. */
async function until(done:()=>boolean){
  for(let i=0;i<300&&!done();i++)await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  assert.ok(done(),`still waiting; page says: ${text().slice(0,200)}`)
}

/** An owner key pair made per run, signing the way scripts/auth-recovery.mjs does. */
async function signingKey(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const url=(bytes:ArrayBuffer)=>Buffer.from(bytes).toString('base64url')
  return {
    publicKey:url(await crypto.subtle.exportKey('raw',pair.publicKey)),
    ticket:async(login:string,code:string,inMs=60000)=>{
      const expiresAt=Date.now()+inMs
      return `ZXR1.${expiresAt}.${url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(recoveryTicketMessage(login,code,expiresAt))))}`
    },
  }
}

/** A browser that already holds a company: em1 is the Super Admin, em3 an employee. `withKey` is the old-account switch. */
async function existingCompany({withKey=false}={}){
  const state=createInitialState()
  state.employees=state.employees.map(e=>e.id==='em1'?{...e,roleId:'role0'}:e)
  localStorage.setItem(STATE_KEY,JSON.stringify(state))
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))
  const account=async(id:string,employeeId:string,username:string,password:string)=>({id,employeeId,username,...await makeCredential(password),status:'active',failedCount:0,mustChangePassword:false,createdAt:'2026-01-01T00:00:00.000Z'})
  const owner={...await account('acc-owner','em1','boss',PASSWORD),...(withKey?{recovery:await makeCredential('KEYAAKEYBBKEYCCKEYDD')}:{})}
  localStorage.setItem(AUTH_KEY,JSON.stringify({version:1,accounts:[owner,await account('acc-op','em3','dilshod.op','Sexop2026x')],policy:{},events:[],attempts:{}}))
  return state
}

async function signIn(login:string,password:string){
  await type(input('login-name'),login)
  await type(input('login-password'),password)
  await click(byText('Kirish'))
}

test('fresh browser: the app opens registration, and old addresses lead there',async()=>{
  await open('/production')
  assert.equal(path,'/register')
  assert.ok(text().includes('Ro‘yxatdan o‘tish'))
  await cleanup()
  await open('/setup')
  assert.equal(path,'/register')
  await cleanup()
  await open('/signup')
  assert.equal(path,'/register')
})

test('registration validates each field, shows the key once, and creates the owner through the first-run bootstrap',async()=>{
  await open('/register')
  const submit=()=>click(byText('Kompaniyani ro‘yxatdan o‘tkazish'))
  await type(input('register-name'),'')
  await submit()
  assert.ok(text().includes('Ism-familiyani kiriting'))
  assert.equal(document.activeElement,input('register-name'),'the first bad field gets the focus')
  await type(input('register-name'),'Abdulloh Xoji')
  await type(input('register-company'),'Yangi Zavod')
  await submit()
  assert.ok(text().includes('Telefon yoki loginni kiriting'))
  await type(input('register-username'),'boss')
  await type(input('register-password'),'qisqa')
  await submit()
  assert.ok(text().includes('kamida 8'))
  await type(input('register-password'),PASSWORD)
  await type(input('register-confirm'),'boshqa2026')
  await submit()
  assert.ok(text().includes('Parollar mos emas'))
  assert.equal(stored().accounts,undefined,'nothing is created while the form is invalid')

  await type(input('register-confirm'),PASSWORD)
  await submit()
  await until(()=>text().includes('Tiklash kalitini saqlang'))
  const key=document.querySelector('.auth-key code')?.textContent||''
  assert.match(key,/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
  assert.equal(JSON.stringify(stored()).includes(key),false,'only a hash of the key is stored')
  assert.ok((byText('Davom etish') as HTMLButtonElement).disabled,'moving on needs the confirmation that it was saved')
  await click(byText('Kalitni xavfsiz joyga saqladim','label'))
  await click(byText('Davom etish'))
  await flush(60)
  assert.equal(path,'/')

  const {accounts}=stored(),state=JSON.parse(localStorage.getItem(STATE_KEY)||'{}')
  assert.equal(accounts.length,1)
  assert.equal(accounts[0].employeeId,'em1')
  assert.equal(state.settings.company.name,'Yangi Zavod')
  const owner=state.employees.find((e:{id:string})=>e.id==='em1')
  assert.equal(owner.name,'Abdulloh Xoji')
  assert.equal(state.roles.find((r:{id:string})=>r.id===owner.roleId).key,'super_admin')
})

test('an existing company opens Login; Register only explains that an administrator opens accounts',async()=>{
  await existingCompany()
  const before=localStorage.getItem(AUTH_KEY)
  await open('/')
  assert.equal(path,'/login')
  await click(byText('Ro‘yxatdan o‘tish','a'))
  assert.equal(path,'/register')
  assert.ok(text().includes('allaqachon ro‘yxatdan o‘tgan'))
  assert.equal(input('register-username'),null,'there is no form to register into a company')
  assert.equal(localStorage.getItem(AUTH_KEY),before)
  await click(byText('Kirish','a'))
  assert.equal(path,'/login')
  assert.ok(input('login-password'))
})

test('login: empty fields and a wrong password say so; an employee signs in; the session survives a reload',async()=>{
  const state=await existingCompany()
  const view=await open('/login')
  await click(byText('Kirish'))
  assert.ok(text().includes('Telefon, login yoki e-pochtani kiriting'))
  await signIn('dilshod.op','Notogri2026')
  await until(()=>text().includes('Login yoki parol noto‘g‘ri'))
  assert.equal(path,'/login')
  assert.equal(localStorage.getItem(SESSION_KEY),null)
  await signIn('dilshod.op','Sexop2026x')
  await until(()=>path==='/')
  assert.ok(localStorage.getItem(SESSION_KEY))
  await view.unmount()
  await open('/')
  assert.equal(path,'/','a new page load stays signed in')
  assert.deepEqual(JSON.parse(localStorage.getItem(STATE_KEY)||'{}').employees.map((e:{id:string})=>e.id),state.employees.map(e=>e.id))
})

test('password show/hide switches the field and is announced',async()=>{
  await existingCompany()
  await open('/login')
  const field=input('login-password') as HTMLInputElement
  assert.equal(field.type,'password')
  await click(document.querySelector('[aria-label="Parolni ko‘rsatish"]'))
  assert.equal(field.type,'text')
})

test('recovery key: a wrong key changes nothing; the right one sets the password, keeps the data and is replaced',async()=>{
  await existingCompany({withKey:true})
  const data=localStorage.getItem(STATE_KEY)
  const [before,employee]=stored().accounts
  await open('/login')
  await click(byText('Parolni unutdingizmi?','a'))
  assert.equal(path,'/forgot-password')
  await type(input('forgot-login'),'boss')
  await type(input('forgot-key'),'XATOKXATOKXATOKXATOK')
  await type(input('forgot-password'),NEW_PASSWORD)
  await type(input('forgot-confirm'),NEW_PASSWORD)
  await click(byText('Parolni tiklash'))
  await until(()=>text().includes('tiklash kaliti noto‘g‘ri'))
  assert.equal(stored().accounts[0].hash,before.hash)

  await type(input('forgot-key'),'keyaa-keybb-keycc-keydd')
  await click(byText('Parolni tiklash'))
  await until(()=>text().includes('Tiklash kalitini saqlang'))
  const after=stored()
  assert.notEqual(after.accounts[0].hash,before.hash)
  assert.notEqual(after.accounts[0].recovery?.hash,before.recovery?.hash,'a used key stops working')
  assert.equal(after.accounts[0].id,'acc-owner')
  assert.deepEqual(after.accounts[1],employee)
  assert.equal(after.events[0].type,'password_recovered')
  assert.equal(localStorage.getItem(STATE_KEY),data,'business data is untouched')

  await click(byText('Kalitni xavfsiz joyga saqladim','label'))
  await click(byText('Davom etish'))
  await flush(40)
  assert.equal(path,'/login')
  await signIn('boss',NEW_PASSWORD)
  await until(()=>path==='/')
})

test('“Kalitim yo‘q” without a configured public key cannot change anything, whatever is put in storage',async()=>{
  await existingCompany()
  const auth=localStorage.getItem(AUTH_KEY)
  localStorage.setItem('zenix-owner-recovery','46b9f8962d115de7')
  await open('/forgot-password')
  await click(byText('Kalitim yo‘q'))
  assert.ok(text().includes('egasi tiklashi sozlanmagan'))
  assert.equal(input('forgot-password'),null,'there is no form to set a password')
  assert.equal(input('forgot-ticket'),null)
  assert.equal(localStorage.getItem(AUTH_KEY),auth)
})

test('owner ticket: storage tricks and forged tickets fail; a real one restores the owner and leaves everything else',async()=>{
  const owner=await signingKey(),stranger=await signingKey()
  await existingCompany()
  const data=localStorage.getItem(STATE_KEY)
  const before=stored()
  await open('/forgot-password',owner.publicKey)
  await click(byText('Kalitim yo‘q'))
  await type(input('forgot-login'),'Boss')
  const command=document.querySelector('.auth-code code')?.textContent||''
  assert.ok(command.includes('--login "boss"'),'the page gives the command for the typed login')
  const code=command.match(/--code ([0-9a-f]+)/)?.[1]||''
  await type(input('forgot-password'),NEW_PASSWORD)
  await type(input('forgot-confirm'),NEW_PASSWORD)
  const attempt=async(ticket:string,expected:string)=>{
    await type(input('forgot-ticket'),ticket)
    await click(byText('Parolni tiklash'))
    await until(()=>text().includes(expected))
    assert.equal(stored().accounts[0].hash,before.accounts[0].hash,'the password is unchanged')
  }
  // The old route: writing the code to storage is no proof any more.
  localStorage.setItem('zenix-owner-recovery',code)
  await attempt('ZXR1.9999999999999.AAAA','Chipta noto‘g‘ri')
  await attempt(await owner.ticket('boss','eski-kod'),'Chipta noto‘g‘ri')
  await attempt(await owner.ticket('dilshod.op',code),'Chipta noto‘g‘ri')
  await attempt(await owner.ticket('boss',code,-1000),'Chipta noto‘g‘ri')
  await attempt(await stranger.ticket('boss',code),'Chipta noto‘g‘ri')

  await type(input('forgot-login'),'dilshod.op')
  await attempt(await owner.ticket('dilshod.op',code),'faqat faol Super Admin')
  assert.deepEqual(stored().accounts,before.accounts,'an employee is not recovered this way')

  await type(input('forgot-login'),'boss')
  await type(input('forgot-ticket'),await owner.ticket('boss',code))
  await click(byText('Parolni tiklash'))
  await until(()=>text().includes('Tiklash kalitini saqlang'))
  const after=stored()
  assert.notEqual(after.accounts[0].hash,before.accounts[0].hash)
  assert.ok(after.accounts[0].recovery,'the account now has a key')
  assert.equal(after.accounts[0].id,before.accounts[0].id)
  assert.equal(after.accounts[0].employeeId,before.accounts[0].employeeId)
  assert.deepEqual(after.accounts[1],before.accounts[1])
  assert.equal(after.events[0].type,'password_recovered')
  assert.equal(localStorage.getItem(STATE_KEY),data,'business data is untouched')
})

test('an existing Super Admin, employees and data survive every public page and a refused registration',async()=>{
  await existingCompany()
  const auth=localStorage.getItem(AUTH_KEY),data=localStorage.getItem(STATE_KEY)
  for(const at of ['/','/login','/register','/setup','/signup','/forgot-password']){
    const view=await open(at)
    assert.equal(input('register-username'),null,`${at} offers no registration`)
    await view.unmount()
  }
  assert.equal(localStorage.getItem(AUTH_KEY),auth,'accounts are byte for byte the same')
  assert.equal(localStorage.getItem(STATE_KEY),data,'business data is byte for byte the same')
})

test('lost accounts next to a company: registration stays closed, so no stranger takes the company over',async()=>{
  await existingCompany()
  localStorage.removeItem(AUTH_KEY)
  const data=localStorage.getItem(STATE_KEY)
  await open('/')
  assert.equal(path,'/register')
  assert.ok(text().includes('egasi allaqachon bo‘lgan'))
  assert.equal(input('register-username'),null)
  assert.equal(localStorage.getItem(AUTH_KEY),null)
  assert.equal(localStorage.getItem(STATE_KEY),data)
})

test('damaged account storage is never overwritten, not even by a failed sign-in',async()=>{
  localStorage.setItem(AUTH_KEY,'{"version":1,"accounts":[{"id":"acc-owner"')
  const raw=localStorage.getItem(AUTH_KEY)
  await open('/login')
  assert.ok(text().includes('o‘qib bo‘lmadi'))
  await signIn('boss',PASSWORD)
  await until(()=>text().includes('Login yoki parol noto‘g‘ri'))
  assert.equal(localStorage.getItem(AUTH_KEY),raw)
  await click(byText('Ro‘yxatdan o‘tish','a'))
  assert.equal(input('register-username'),null)
  assert.equal(localStorage.getItem(AUTH_KEY),raw)
})
