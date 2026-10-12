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
