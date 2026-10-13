import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ToastProvider } from './ui/Toast'
import './styles.css'

/**
 * Titik masuk aplikasi admin.
 *
 * `BrowserRouter` memerlukan fallback SPA dari hosting (semua path diarahkan ke
 * `index.html`) — itu diatur lewat `public/_redirects` untuk Cloudflare Pages,
 * dan diverifikasi lagi saat P10 karena rute `/access/*` serta `/checkin/*`
 * ditangani Pages Functions dan tidak boleh ikut tertelan fallback itu.
 */
const container = document.getElementById('root')
if (container === null) throw new Error('Elemen #root tidak ditemukan di index.html')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
