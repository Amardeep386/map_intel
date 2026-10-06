import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '../mirethos-theme.css'
import App from './App.jsx'
import { EvidencePage } from './views/EvidencePage.jsx'
import { ReportPage } from './views/ReportPage.jsx'

// Links that open without signing in: /evidence/<token> (a violation's evidence page) and
// /report/<token> (a hosted report).
const evidence = window.location.pathname.match(/^\/evidence\/([A-Za-z0-9_-]+)\/?$/)
const report = window.location.pathname.match(/^\/report\/([A-Za-z0-9_-]+)\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {evidence ? <EvidencePage token={evidence[1]} /> : report ? <ReportPage token={report[1]} /> : <App />}
  </StrictMode>,
)
