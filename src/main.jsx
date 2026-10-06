import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '../mirethos-theme.css'
import App from './App.jsx'
import { EvidencePage } from './views/EvidencePage.jsx'

// Links that open without signing in: /evidence/<token> (a violation's evidence page).
const evidence = window.location.pathname.match(/^\/evidence\/([A-Za-z0-9_-]+)\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {evidence ? <EvidencePage token={evidence[1]} /> : <App />}
  </StrictMode>,
)
