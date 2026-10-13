import './polyfills' // before anything that reads PDF text (Safari: ReadableStream async iteration)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pdfjs-dist/web/pdf_viewer.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './tokens.css'
import './styles.css'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App.tsx'
import { ClerkBridge } from './account/ClerkBridge.tsx'
import { clerkAppearance } from './account/clerkAppearance.ts'

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {clerkKey ? (
      <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/" appearance={clerkAppearance}>
        <ClerkBridge />
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}) })
}
