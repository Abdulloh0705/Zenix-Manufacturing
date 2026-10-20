import {Component,lazy,Suspense} from 'react'
import type {ErrorInfo,ReactNode} from 'react'
import {Link,Navigate,Route,Routes,useLocation} from 'react-router-dom'
import AppLayout from './layout/AppLayout/AppLayout'
import {useApp} from './app/providers/AppProvider/AppContext'
import {Icon} from './shared/ui'
import {legacyRedirects} from './routes/navigation'
import {ForcePasswordChange,LoginPage,SetupPage} from './features/auth/pages/AuthPages'

const Dashboard=lazy(()=>import('./features/dashboard/pages/Dashboard'))
const Production=lazy(()=>import('./features/production/pages/Production'))
const Products=lazy(()=>import('./features/products/pages/Products'))
const Materials=lazy(()=>import('./features/materials/pages/Materials'))
const Warehouse=lazy(()=>import('./features/warehouse/pages/Warehouse'))
const Purchases=lazy(()=>import('./features/purchases/pages/Purchases'))
const Sales=lazy(()=>import('./features/sales/pages/Sales'))
const Quality=lazy(()=>import('./features/quality/pages/Quality'))
const Equipment=lazy(()=>import('./features/equipment/pages/Equipment'))
const Employees=lazy(()=>import('./features/employees/pages/Employees'))
const Costs=lazy(()=>import('./features/costs/pages/Costs'))
const Reports=lazy(()=>import('./features/reports/pages/Reports'))
const Settings=lazy(()=>import('./features/settings/pages/Settings'))
const AI=lazy(()=>import('./features/ai/pages/AI'))
const Admin=lazy(()=>import('./features/admin/pages/Admin'))

function StateCard({icon,title,text,action}:{icon:string;title:string;text:string;action:ReactNode}){
  return <div className="permission-state card"><span className="state-icon"><Icon name={icon} size={26}/></span><h1>{title}</h1><p>{text}</p>{action}</div>
}

/**
 * Signed-in users only: first run goes to set-up, everyone else to the login page with the page they asked for
 * (so refresh and direct links come back to it). A temporary password must be replaced before anything else.
 */
function RequireAuth({children}:{children:ReactNode}){
  const app=useApp(),location=useLocation()
  if(app.auth.needsSetup)return <Navigate to="/setup" replace/>
  if(!app.auth.signedIn)return <Navigate to={`/login?next=${encodeURIComponent(location.pathname+location.search)}`} replace/>
  if(app.auth.account?.mustChangePassword)return <ForcePasswordChange/>
  return children
}

/** The admin panel opens for anyone holding one of its permissions. */
function Guard({module,children}:{module:string;children:ReactNode}){
  const app=useApp()
  if(module.split('|').some(m=>app.can(m)))return children
  return <StateCard icon="lock" title="Ruxsat mavjud emas" text={`“${app.currentRole.name}” roli bu modulga kira olmaydi.`} action={<Link className="primary-glass-btn" to="/">Boshqaruv paneliga qaytish</Link>}/>
}

function NotFound(){
  const location=useLocation()
  return <StateCard icon="search" title="Sahifa topilmadi" text={`“${location.pathname}” manzili mavjud emas yoki ko‘chirilgan.`} action={<Link className="primary-glass-btn" to="/">Boshqaruv paneliga o‘tish</Link>}/>
}

function RouteLoading(){return <div className="route-loading" role="status" aria-live="polite"><span/>Yuklanmoqda…</div>}

class PageBoundary extends Component<{children:ReactNode;resetKey:string},{error:Error|null}>{
  state={error:null as Error|null}
  static getDerivedStateFromError(error:Error){return {error}}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('Page crashed',error,info.componentStack)}
  componentDidUpdate(prev:{resetKey:string}){if(prev.resetKey!==this.props.resetKey&&this.state.error)this.setState({error:null})}
  render(){
    if(!this.state.error)return this.props.children
    return <StateCard icon="warning" title="Sahifada xatolik yuz berdi" text="Ma’lumotlar saqlangan. Sahifani qayta yuklang yoki boshqa bo‘limga o‘ting." action={<button type="button" className="primary-glass-btn" onClick={()=>window.location.reload()}><Icon name="refresh" size={16}/>Qayta yuklash</button>}/>
  }
}

function Page({module,children}:{module?:string;children:ReactNode}){
  const location=useLocation()
  const body=<Suspense fallback={<RouteLoading/>}>{children}</Suspense>
  return <PageBoundary resetKey={location.pathname}>{module?<Guard module={module}>{body}</Guard>:body}</PageBoundary>
}

export default function App(){
  return <Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/setup" element={<SetupPage/>}/>
    {/* Old sign-in addresses lead to the login page without first asking to sign in. */}
    {Object.entries(legacyRedirects).filter(([,to])=>to==='/login').map(([from,to])=><Route key={from} path={from} element={<Navigate to={to} replace/>}/>)}
    <Route element={<RequireAuth><AppLayout/></RequireAuth>}>
    <Route path="/" element={<Page><Dashboard/></Page>}/>
    <Route path="/production" element={<Page module="production"><Production/></Page>}/>
    <Route path="/products" element={<Page module="products"><Products/></Page>}/>
    <Route path="/materials" element={<Page module="materials"><Materials/></Page>}/>
    <Route path="/warehouse" element={<Page module="warehouse"><Warehouse/></Page>}/>
    <Route path="/purchases" element={<Page module="purchases"><Purchases/></Page>}/>
    <Route path="/sales" element={<Page module="sales"><Sales/></Page>}/>
    <Route path="/quality" element={<Page module="quality"><Quality/></Page>}/>
    <Route path="/equipment" element={<Page module="equipment"><Equipment/></Page>}/>
    <Route path="/employees" element={<Page module="employees"><Employees/></Page>}/>
    <Route path="/costs" element={<Page module="costs"><Costs/></Page>}/>
    <Route path="/reports" element={<Page module="reports"><Reports/></Page>}/>
    <Route path="/settings" element={<Page module="settings"><Settings/></Page>}/>
    <Route path="/ai" element={<Page module="ai"><AI/></Page>}/>
    <Route path="/admin" element={<Page module="users|roles|audit|settings"><Admin/></Page>}/>
    {Object.entries(legacyRedirects).filter(([from,to])=>from!=='/ai'&&to!=='/login').map(([from,to])=><Route key={from} path={from} element={<Navigate to={to} replace/>}/>)}
    <Route path="/help" element={<Navigate to="/settings?view=system" replace/>}/>
    <Route path="*" element={<NotFound/>}/>
  </Route></Routes>
}
