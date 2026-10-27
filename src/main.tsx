import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import App from './App'
import {AppProvider} from './app/providers/AppProvider/AppContext'
import {RootBoundary} from './app/RootBoundary'
import './styles.css'
createRoot(document.getElementById('root')!).render(<StrictMode><RootBoundary><BrowserRouter><AppProvider><App/></AppProvider></BrowserRouter></RootBoundary></StrictMode>)
