import {Component} from 'react'
import type {ErrorInfo,ReactNode} from 'react'
import {downloadText} from '../utils/exportData'
import {todayISO} from '../utils/dates'

const STORAGE_KEY='zenix-manufacturing-v3-state'

/**
 * Last line of defence above the provider and the shell (pages have their own boundary in App.tsx). It needs
 * nothing from the app context, which may be what failed, and shows no technical detail — only what the user
 * can do: reload, or take a copy of the data saved in this browser.
 */
export class RootBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('App crashed',error,info.componentStack)}
  render(){
    if(!this.state.failed)return this.props.children
    let saved:string|null=null
    try{saved=localStorage.getItem(STORAGE_KEY)}catch{saved=null}
    return <main className="root-error" role="alert">
      <div className="permission-state card">
        <h1>Ilovada kutilmagan xatolik</h1>
        <p>Brauzerda saqlangan ma’lumotlar o‘zgartirilmadi. Sahifani qayta yuklang; xatolik takrorlansa, ma’lumot nusxasini yuklab olib administratorga yuboring.</p>
        <div className="row-actions">
          <button type="button" className="primary-glass-btn" onClick={()=>window.location.reload()}>Qayta yuklash</button>
          {saved&&<button type="button" className="secondary-glass-btn" onClick={()=>downloadText(`zenix-saqlangan-malumot-${todayISO()}.json`,saved,'application/json')}>Ma’lumot nusxasini yuklab olish</button>}
        </div>
      </div>
    </main>
  }
}
