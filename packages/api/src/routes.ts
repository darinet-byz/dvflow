import type { Route } from './router'
import { changePassword, login, logout, refresh } from './auth/handlers'
import { createConfig, deactivateConfig, updateConfig } from './config/handlers'
import { listWebinars, saveWebinar } from './webinar/handlers'
import { createUser, listUsers } from './internal-users/handlers'
import { accessOrder, checkinByQr, checkinInfoPage } from './participant/handlers'
import { getProfile, updateProfile } from './profile/handlers'
import { scannerManualCheckin, scannerSearch } from './scanner/handlers'
import { orderOnlineWebhook } from './webhooks/handlers'

/**
 * Tabel rute backend (03 §4–§7, §13, §14).
 *
 * Sengaja satu daftar datar supaya mudah dibandingkan baris per baris dengan
 * `docs/03-WORKER-API-CONTRACT.md`.
 *
 * Rute baca data besar (Order, Presensi, Dashboard, Report Tax) TIDAK ada di
 * sini: browser membacanya langsung dari Supabase lewat RLS memakai access JWT
 * (02 §14, K11). Yang lewat backend hanyalah yang perlu service key atau
 * keputusan server.
 *
 * `sameOrigin` hanya dipasang pada endpoint yang memakai cookie untuk mengubah
 * state (04 §8). Login tidak: ia belum terautentikasi cookie, dan mewajibkan
 * header Origin akan mematikan login dari klien non-browser tanpa menambah
 * pertahanan yang nyata.
 *
 * Webhook dan halaman peserta juga tidak: keduanya tidak memakai cookie sama
 * sekali — webhook berotorisasi secret pada path (01 §20), dan rute peserta
 * berotorisasi Order ID (04 §12).
 */
export const ROUTES: Route[] = [
  // Ingestion.
  {
    method: 'POST',
    path: '/api/webhooks/orderonline/:webhookSecret',
    handler: orderOnlineWebhook,
    auth: 'none',
  },

  // Auth.
  { method: 'POST', path: '/api/auth/login', handler: login, auth: 'none' },
  { method: 'POST', path: '/api/auth/refresh', handler: refresh, auth: 'none', sameOrigin: true },
  { method: 'POST', path: '/api/auth/logout', handler: logout, auth: 'none', sameOrigin: true },
  { method: 'POST', path: '/api/auth/change-password', handler: changePassword, auth: 'access' },

  // Profil & provisioning.
  { method: 'GET', path: '/api/profile', handler: getProfile, auth: 'access' },
  { method: 'PATCH', path: '/api/profile', handler: updateProfile, auth: 'access' },
  { method: 'POST', path: '/api/internal/users', handler: createUser, auth: 'access' },

  { method: 'GET', path: '/api/internal/users', handler: listUsers, auth: 'access' },
  { method: 'GET', path: '/api/webinar-destinations', handler: listWebinars, auth: 'access' },
  { method: 'POST', path: '/api/webinar-destinations', handler: saveWebinar, auth: 'access' },

  // Peserta (publik: Order ID adalah identitas akses — 04 §12).
  { method: 'GET', path: '/access/:orderId', handler: accessOrder, auth: 'none' },
  // GET check-in sengaja tidak mengubah apa pun; mutasi hanya lewat POST (03 §9).
  { method: 'GET', path: '/checkin/:orderId', handler: checkinInfoPage, auth: 'none' },

  // Scanner (operator terautentikasi).
  { method: 'POST', path: '/checkin/:orderId', handler: checkinByQr, auth: 'access' },
  { method: 'GET', path: '/api/scanner/search', handler: scannerSearch, auth: 'access' },
  { method: 'POST', path: '/api/scanner/manual-checkin', handler: scannerManualCheckin, auth: 'access' },

  // Konfigurasi (tulis saja; baca langsung lewat RLS).
  { method: 'POST', path: '/api/config/:resource', handler: createConfig, auth: 'access' },
  { method: 'PATCH', path: '/api/config/:resource/:id', handler: updateConfig, auth: 'access' },
  { method: 'DELETE', path: '/api/config/:resource/:id', handler: deactivateConfig, auth: 'access' },
]
