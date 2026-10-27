import {flush,render} from './helpers'
import {MemoryRouter,useLocation} from 'react-router-dom'
import App from '../../src/App'
import {AppProvider} from '../../src/app/providers/AppProvider/AppContext'
import {createInitialState} from '../../src/data/mockData'
import type {ManufacturingState} from '../../src/types'

export const STATE_KEY='zenix-manufacturing-v3-state'
const AUTH_KEY='zenix-auth-v1',SESSION_KEY='zenix-session-v1'

/** Where the router is now (pathname + search), for asserting deep links. */
export const location={current:''}
function LocationProbe(){const l=useLocation();location.current=l.pathname+l.search;return null}

/**
 * A signed-in session for an existing employee, written the way the app stores it. The password hash is a
 * placeholder: nothing in these tests signs in with a password, they only open pages as that person.
 */
export function signIn(employeeId='em1'){
  const now=new Date(),later=new Date(now.getTime()+864e5).toISOString()
  localStorage.setItem(AUTH_KEY,JSON.stringify({version:1,accounts:[{id:'acc-test',employeeId,username:'ui.test',hash:'x',salt:'x',iterations:1,status:'active',failedCount:0,mustChangePassword:false,createdAt:now.toISOString()}],policy:{},events:[],attempts:{}}))
  localStorage.setItem(SESSION_KEY,JSON.stringify({id:'s-test',accountId:'acc-test',employeeId,startedAt:now.toISOString(),lastActivity:now.toISOString(),expiresAt:later,remember:true}))
}

/** Seeds stored business data: the initial state plus test records, as if saved by an earlier visit. */
export function seedState(patch:(s:ManufacturingState)=>ManufacturingState){
  localStorage.setItem(STATE_KEY,JSON.stringify(patch(createInitialState())))
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))
}

export async function mountApp(path='/',employeeId='em1'){
  if(!localStorage.getItem(SESSION_KEY))signIn(employeeId)
  // Like the first-run setup: the default test user is the Super Admin (the app blocks actions without one).
  const stored=localStorage.getItem(STATE_KEY)
  const state:ManufacturingState=stored?JSON.parse(stored):createInitialState()
  if(employeeId==='em1'){state.employees=state.employees.map(e=>e.id==='em1'?{...e,roleId:'role0'}:e);localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))}
  const view=await render(<MemoryRouter initialEntries={[path]}><AppProvider><App/><LocationProbe/></AppProvider></MemoryRouter>)
  await flush(60)
  return view
}

export const storedSettings=()=>JSON.parse(localStorage.getItem(STATE_KEY)||'{}').settings
