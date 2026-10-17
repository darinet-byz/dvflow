import { createContext, useContext, useEffect, useState } from 'react'
import { FIELD_APP_PERMISSION, FIELD_APP_ROLES } from '@dvflow/shared'

/**
 * Tampilan Apps Lapangan (A30).
 *
 * Hanya role Pimpro/Staff/Member yang izin `ui.field_app`-nya dicentang, dan hanya di layar HP.
 * Role lain — termasuk master yang otomatis punya semua izin — selalu memakai tampilan web.
 * Pengguna lapangan bisa memilih "tampilan web lengkap" di perangkatnya (disimpan lokal).
 */
export function canUseFieldApp(profile: { role: string; permissions?: string[] } | null | undefined): boolean {
  return !!profile && FIELD_APP_ROLES.includes(profile.role) && !!profile.permissions?.includes(FIELD_APP_PERMISSION)
}

const PHONE_QUERY = '(max-width: 767px)'
const PREFER_WEB_KEY = 'dvflow.preferWebLayout'
const PREFER_WEB_EVENT = 'dvflow:prefer-web'

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia?.(PHONE_QUERY)
    if (!query) return
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}

function readPreferWeb(): boolean {
  try { return window.localStorage.getItem(PREFER_WEB_KEY) === '1' } catch { return false }
}

export function setPreferWebLayout(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(PREFER_WEB_KEY, '1')
    else window.localStorage.removeItem(PREFER_WEB_KEY)
  } catch { /* penyimpanan diblokir: preferensi hanya berlaku sampai muat ulang */ }
  window.dispatchEvent(new Event(PREFER_WEB_EVENT))
}

export function usePreferWebLayout(): boolean {
  const [prefer, setPrefer] = useState(readPreferWeb)
  useEffect(() => {
    const update = () => setPrefer(readPreferWeb())
    window.addEventListener(PREFER_WEB_EVENT, update)
    return () => window.removeEventListener(PREFER_WEB_EVENT, update)
  }, [])
  return prefer
}

/** true di dalam FieldAppShell — halaman memakai varian lapangan (kartu, tanpa tombol ganda). */
export const FieldAppContext = createContext(false)

export function useFieldAppMode(): boolean {
  return useContext(FieldAppContext)
}
