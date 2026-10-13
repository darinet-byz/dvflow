import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { login } from '../lib/session'
import { useSession } from '../lib/useSession'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { TextInput } from '../ui/Field'
import { LoginMascot } from '../ui/LoginMascot'
import { DASHBOARD_PATH } from '../layout/navigation'

/**
 * Login (03 §4, 05 §A01–§A03, §A10).
 *
 * Login memakai username + password; TIDAK ada signup, forgot password, magic
 * link, atau OAuth di MVP (04 §2). Karena itu halaman ini sengaja tidak memuat
 * tautan semacam itu.
 *
 * Pesan gagal diambil apa adanya dari backend, yang selalu memakai pesan yang
 * sama untuk "username tidak dikenal" dan "password salah" (03 §4) — layar ini
 * tidak menambahkan petunjuk yang membocorkan keberadaan akun.
 */
export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session.status === 'authenticated') return <Navigate to={DASHBOARD_PATH} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login(username, password)
      navigate(DASHBOARD_PATH, { replace: true })
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Tidak dapat login. Coba lagi.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-page p-4">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LoginMascot />
        <Card className="w-full">
          <div className="mb-5 text-center">
            <h1 className="text-[20px] font-bold tracking-tight text-ink">Selamat Datang di DVFLOW</h1>
            <p className="mt-1 text-[13px] text-ink-soft">Masuk untuk mengelola operasional event.</p>
          </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <TextInput
            id="username"
            label="Username"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            disabled={submitting}
          />
          <TextInput
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={submitting}
          />

          {error === null ? null : (
            <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[12px] font-semibold text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
            Masuk
          </Button>
        </form>
      </Card>
      </div>
    </div>
  )
}
