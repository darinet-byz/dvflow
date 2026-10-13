import { useSyncExternalStore } from 'react'
import { getSessionSnapshot, subscribe, type SessionSnapshot } from './session'

/**
 * Baca sesi dari React.
 *
 * `useSyncExternalStore` dipakai supaya keadaan sesi yang hidup di luar React
 * tetap konsisten saat beberapa komponen membacanya bersamaan (mis. shell dan
 * halaman profil).
 */
export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, getSessionSnapshot, getSessionSnapshot)
}
