import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Inject web fonts at runtime so the static bundle has no remote <link>
// for the inliner to choke on; fonts still load when viewed online.
;(() => {
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href =
    'https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&family=Chakra+Petch:wght@400;500;600;700&display=swap'
  document.head.appendChild(l)
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
