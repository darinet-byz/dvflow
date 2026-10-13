import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { logout } from '../lib/session'
import { Skeleton } from '../ui/Feedback'
import { LOGIN_PATH } from '../layout/navigation'

/**
 * Logout (03 §6, 05 §A05).
 *
 * Endpoint logout idempoten, jadi halaman ini tidak pernah menampilkan galat:
 * sesi lokal dibersihkan dan pengguna diarahkan ke halaman login.
 */
export function LogoutPage() {
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    void logout().then(() => {
      if (active) setDone(true)
    })
    return () => {
      active = false
    }
  }, [])

  if (done) return <Navigate to={LOGIN_PATH} replace />

  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton height={24} className="max-w-[200px]" />
      <Skeleton height={16} className="max-w-[320px]" />
    </div>
  )
}
