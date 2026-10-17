import { useState, useEffect } from 'react'
import { PASSWORD_MIN_LENGTH } from '@dvflow/shared'
import { ApiError } from '../../lib/api'
import { changePassword, updateProfile } from '../../lib/session'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { TextInput } from '../../ui/Field'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'
import { Link } from 'react-router-dom'
import { setPreferWebLayout, useFieldAppMode } from '../../lib/field-app'

/**
 * Profil (PRD §113–§116, 03 §13).
 *
 * Isinya persis yang disebut dokumen: Nama, Username, Avatar Emoji, dan Ganti
 * Password. Username TIDAK dapat diubah pada MVP (03 §13: "Username change is
 * not exposed in Profile MVP"), jadi ia ditampilkan sebagai teks, bukan input.
 *
 * Avatar memakai emoji yang dipilih, bukan unggah gambar (PRD §114), dan
 * contohnya diambil apa adanya dari PRD §114 — tidak dikarang sendiri.
 */
const AVATAR_CHOICES = ['😎', '🚀', '🐼', '🦊', '🐯', '👨💻', '🤖']

export function ProfilePage() {
  const session = useSession()
  const toast = useToast()
  const profile = session.profile

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [emoji, setEmoji] = useState(profile?.avatar_emoji ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Profil bisa tiba setelah halaman terpasang (refresh profil saat navigasi); isi form sekali saat itu.
  const profileUserId = profile?.user_id ?? null
  useEffect(() => {
    if (profile === null) return
    setDisplayName(profile.display_name)
    setEmoji(profile.avatar_emoji ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat user berganti, bukan tiap refresh
  }, [profileUserId])

  if (profile === null) return null

  async function saveProfile(): Promise<void> {
    setSavingProfile(true)
    try {
      await updateProfile({ displayName: displayName.trim(), avatarEmoji: emoji === '' ? null : emoji })
      toast.show('Profil diperbarui.', 'success')
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Profil tidak dapat disimpan.', 'danger')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(): Promise<void> {
    setPasswordError(null)

    // Validasi bentuk dulu supaya kesalahan yang jelas tidak perlu satu
    // perjalanan ke server. Aturannya tetap milik server (01 §4).
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(`Password baru minimal ${PASSWORD_MIN_LENGTH} karakter.`)
      return
    }
    if (newPassword !== confirmation) {
      setPasswordError('Password baru dan konfirmasi tidak sama.')
      return
    }

    setSavingPassword(true)
    try {
      await changePassword({
        currentPassword,
        newPassword,
        newPasswordConfirmation: confirmation,
      })
      // Seluruh sesi sudah dicabut server (01 §3), jadi klien wajib login ulang.
      toast.show('Password diubah. Silakan login kembali.', 'success')
    } catch (error) {
      setPasswordError(error instanceof ApiError ? error.message : 'Password tidak dapat diubah.')
    } finally {
      setSavingPassword(false)
    }
  }

  const fieldMode = useFieldAppMode()

  return (
    <>
      {fieldMode ? null : <PageHeader title="Profil" />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Akun" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-12 w-12 place-items-center rounded-full border border-line bg-soft text-[22px]"
              >
                {emoji === '' ? (displayName.slice(0, 1).toUpperCase() || '?') : emoji}
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink">{displayName || profile.display_name}</p>
                <p className="text-[12px] text-ink-soft">{profile.username}</p>
              </div>
            </div>

            <TextInput id="profile-name" label="Nama" value={displayName} onChange={setDisplayName} />

            <div>
              <p className="mb-1 text-[12px] font-semibold text-ink-soft">Avatar Emoji</p>
              <div className="flex flex-wrap gap-2">
                {AVATAR_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-label={`Pilih avatar ${choice}`}
                    aria-pressed={emoji === choice}
                    onClick={() => setEmoji(emoji === choice ? '' : choice)}
                    className={cn(
                      'grid h-10 w-10 place-items-center rounded-full text-[20px] transition-colors',
                      emoji === choice
                        ? // Guideline §115: selected memakai primary-soft + border primary.
                          'border border-primary bg-primary-soft shadow-card'
                        : 'border border-line bg-card hover:bg-soft',
                    )}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </div>

            <Button variant="primary" loading={savingProfile} onClick={() => void saveProfile()} className="mt-1">
              Simpan profil
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Ganti Password"
          />

          <div className="flex flex-col gap-3">
            <TextInput
              id="current-password"
              label="Password saat ini"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
            <TextInput
              id="new-password"
              label="Password baru"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
            <TextInput
              id="confirm-password"
              label="Ulangi password baru"
              type="password"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              error={passwordError}
            />

            <Button
              variant="secondary"
              loading={savingPassword}
              onClick={() => void savePassword()}
              className="mt-1"
            >
              Ubah password
            </Button>
          </div>
        </Card>

        {/* A30: di Tampilan Apps Lapangan tidak ada sidebar — Logout & tampilan web ada di sini. */}
        {fieldMode ? (
          <Card>
            <CardHeader title="Tampilan" />
            <div className="flex flex-col gap-2">
              <Button onClick={() => setPreferWebLayout(true)}>Buka tampilan web lengkap</Button>
              <p className="text-[12px] text-ink-soft">
                Untuk membuka menu lain (mis. Dashboard). Kembali lewat tombol "Tampilan aplikasi" di bagian atas.
              </p>
              <Link
                to="/logout"
                className="mt-2 inline-flex h-10 items-center justify-center rounded-sm border border-danger/30 bg-danger-soft text-[13px] font-semibold text-danger"
              >
                Logout
              </Link>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}
