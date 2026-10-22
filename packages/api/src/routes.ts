import type { Route } from './router'
import { listConnections, saveConnection, connectionWebhookUrl, testConnection, deleteConnection } from './integrations/handlers'
import { changePassword, login, logout, refresh } from './auth/handlers'
import { createConfig, deactivateConfig, getPlatformFee, savePlatformFee, updateConfig } from './config/handlers'
import {
  deleteSeminarTicket,
  deleteWebinar,
  listSeminarTickets,
  listWebinars,
  saveSeminarTicket,
  saveWebinar,
} from './webinar/handlers'
import { createUser, deleteUser, listUsers, updateUser } from './internal-users/handlers'
import { createRole, deleteRole, getRole, listPermissions, listRoles, updateRolePermissions } from './roles/handlers'
import { accessOrder, checkinByQr, checkinInfoPage } from './participant/handlers'
import { getProfile, updateProfile } from './profile/handlers'
import { scannerManualCheckin, scannerSearch } from './scanner/handlers'
import { deleteOts, listOts, listOtsEvents, saveOts } from './ots/handlers'
import { createAdSpend, deleteAdSpend, updateAdSpend } from './ad-spend/handlers'
import { orderOnlineWebhook } from './webhooks/handlers'
import { batchRemapOrders, deleteAlias, listAliases, listUnmappedOrders, saveAlias } from './aliases/handlers'
import { getDataSummary, purgeExpiredUnmapped, resetData } from './developer/handlers'

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
  { method: 'GET', path: '/api/integrations/orderonline', handler: listConnections, auth: 'access' },
  { method: 'POST', path: '/api/integrations/orderonline', handler: saveConnection, auth: 'access' },
  { method: 'PATCH', path: '/api/integrations/orderonline/:id', handler: saveConnection, auth: 'access' },
  { method: 'DELETE', path: '/api/integrations/orderonline/:id', handler: deleteConnection, auth: 'access' },
  { method: 'GET', path: '/api/integrations/orderonline/:id/webhook', handler: connectionWebhookUrl, auth: 'access' },
  { method: 'POST', path: '/api/integrations/orderonline/:id/test', handler: testConnection, auth: 'access' },
  { method: 'POST', path: '/api/webhooks/orderonline/:connectionId/:webhookSecret', handler: orderOnlineWebhook, auth: 'none' },
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
  { method: 'PATCH', path: '/api/internal/users/:id', handler: updateUser, auth: 'access' },
  { method: 'DELETE', path: '/api/internal/users/:id', handler: deleteUser, auth: 'access' },

  // Role & Permission Management (Fitur 2.0).
  { method: 'GET', path: '/api/roles', handler: listRoles, auth: 'access' },
  { method: 'POST', path: '/api/roles', handler: createRole, auth: 'access' },
  { method: 'GET', path: '/api/roles/:id', handler: getRole, auth: 'access' },
  { method: 'PUT', path: '/api/roles/:id/permissions', handler: updateRolePermissions, auth: 'access' },
  { method: 'DELETE', path: '/api/roles/:id', handler: deleteRole, auth: 'access' },
  { method: 'GET', path: '/api/permissions', handler: listPermissions, auth: 'access' },

  // Webinar Zoom & Seminar Ticket / Barcode.
  { method: 'GET', path: '/api/webinar-destinations', handler: listWebinars, auth: 'access' },
  { method: 'POST', path: '/api/webinar-destinations', handler: saveWebinar, auth: 'access' },
  { method: 'DELETE', path: '/api/webinar-destinations', handler: deleteWebinar, auth: 'access' },
  { method: 'GET', path: '/api/seminar-tickets', handler: listSeminarTickets, auth: 'access' },
  { method: 'POST', path: '/api/seminar-tickets', handler: saveSeminarTicket, auth: 'access' },
  { method: 'DELETE', path: '/api/seminar-tickets', handler: deleteSeminarTicket, auth: 'access' },

  // Peserta (publik: Order ID adalah identitas akses — 04 §12).
  { method: 'GET', path: '/access/:kodeToko/:orderId', handler: accessOrder, auth: 'none' },
  { method: 'GET', path: '/access/:orderId', handler: accessOrder, auth: 'none' },
  // GET check-in sengaja tidak mengubah apa pun; mutasi hanya lewat POST (03 §9).
  { method: 'GET', path: '/checkin/:orderId', handler: checkinInfoPage, auth: 'none' },

  // Alias Produk & Order Unmapped (Masa Transisi).
  { method: 'GET', path: '/api/product-aliases', handler: listAliases, auth: 'access' },
  { method: 'POST', path: '/api/product-aliases', handler: saveAlias, auth: 'access' },
  { method: 'DELETE', path: '/api/product-aliases/:id', handler: deleteAlias, auth: 'access' },
  { method: 'GET', path: '/api/orders/unmapped', handler: listUnmappedOrders, auth: 'access' },
  { method: 'POST', path: '/api/orders/batch-remap', handler: batchRemapOrders, auth: 'access' },

  // Scanner (operator terautentikasi).
  { method: 'POST', path: '/checkin/:orderId', handler: checkinByQr, auth: 'access' },
  { method: 'GET', path: '/api/scanner/search', handler: scannerSearch, auth: 'access' },
  { method: 'POST', path: '/api/scanner/manual-checkin', handler: scannerManualCheckin, auth: 'access' },
  // A29: pendaftaran peserta OTS (bayar di lokasi).
  { method: 'GET', path: '/api/ots/events', handler: listOtsEvents, auth: 'access' },
  { method: 'GET', path: '/api/ots', handler: listOts, auth: 'access' },
  { method: 'POST', path: '/api/ots', handler: saveOts, auth: 'access' },
  { method: 'DELETE', path: '/api/ots/:orderId', handler: deleteOts, auth: 'access' },
  // A37: Report Spend Iklan (tulis; laporan dibaca lewat RPC ad_spend_report).
  { method: 'POST', path: '/api/ad-spend-reports', handler: createAdSpend, auth: 'access' },
  { method: 'PATCH', path: '/api/ad-spend-reports/:id', handler: updateAdSpend, auth: 'access' },
  { method: 'DELETE', path: '/api/ad-spend-reports/:id', handler: deleteAdSpend, auth: 'access' },

  // Konfigurasi (tulis saja; baca langsung lewat RLS).
  // Rute statis sebelum :resource (A15).
  { method: 'GET', path: '/api/config/platform-fee', handler: getPlatformFee, auth: 'access' },
  { method: 'PUT', path: '/api/config/platform-fee', handler: savePlatformFee, auth: 'access' },
  { method: 'POST', path: '/api/config/:resource', handler: createConfig, auth: 'access' },
  { method: 'PATCH', path: '/api/config/:resource/:id', handler: updateConfig, auth: 'access' },
  { method: 'DELETE', path: '/api/config/:resource/:id', handler: deactivateConfig, auth: 'access' },

  // Developer Tools (Khusus Developer).
  { method: 'GET', path: '/api/developer/data-summary', handler: getDataSummary, auth: 'access' },
  { method: 'POST', path: '/api/developer/reset-data', handler: resetData, auth: 'access' },
  { method: 'POST', path: '/api/developer/purge-unmapped', handler: purgeExpiredUnmapped, auth: 'access' },
]
