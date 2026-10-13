import './polyfills' // before anything that reads PDF text (Safari: ReadableStream async iteration)
import './ai/owner' // captures #owner=<key> and strips it from the URL before the app renders
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pdfjs-dist/web/pdf_viewer.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './tokens.css'
import './styles.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}) })
}
