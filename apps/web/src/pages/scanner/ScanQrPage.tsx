import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { useCallback, useEffect, useRef, useState } from 'react'
import { extractOrderIdFromQrPayload } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { effectiveSearch } from '../../lib/filters'
import { formatText, formatTime } from '../../lib/format'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, appStatusTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { ErrorState, Spinner } from '../../ui/Feedback'
import { SearchInput } from '../../ui/Field'
import { cn } from '../../ui/cn'
import { useToast } from '../../ui/Toast'
import {
  fromCheckinError,
  fromCheckinSuccess,
  fromUnknownQr,
  shouldProcessQr,
  type CheckinResponse,
  type ScanOutcome,
} from './scan-feedback'
import type { CameraFailure } from './camera-permission'
import { useQrScanner } from './useQrScanner'

/**
 * Scan QR (PRD §95–§98, 01 §14, 03 §9–§11).
 *
 * Halaman paling penting di lapangan, dan dibuat untuk satu situasi: panitia
 * berdiri di depan antrean, memegang ponsel, dan harus tahu dalam sekejap apakah
 * peserta boleh masuk. Karena itu:
 *
 *   * hasil terakhir besar dan berwarna (hijau/merah soft, guideline §37);
 *   * operator tidak dipaksa banyak klik — kamera berjalan sendiri;
 *   * **Manual Search** selalu tersedia sebagai aksi sekunder, dan menjadi
 *     satu-satunya jalan ketika kamera tidak bisa dipakai (H06);
 *   * QR hanyalah pengenal: seluruh syarat diperiksa ulang server, dan halaman
 *     ini tidak pernah memutuskan sendiri bahwa seseorang boleh masuk (04 §11).
 */
type Candidate = {
  order_id: string
  name: string | null
  phone: string | null
  app_status: string
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  already_checked_in: boolean
  checked_in_at: string | null
}

export function ScanQrPage() {
  const { profile } = useSession()
  const toast = useToast()
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanMode, setScanMode] = useState<'camera' | 'scanner_stick'>('camera')
  const lastQrRef = useRef<{ orderId: string; at: number } | null>(null)
  const barcodeBufferRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)

  function playAudioFeedback(success: boolean) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = success ? 880 : 330
      gain.gain.setValueAtTime(0.12, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } catch {
      // Audio context blocked by browser until user gesture
    }
  }

  const runCheckin = useCallback(
    async (orderId: string, source: 'qr' | 'manual'): Promise<void> => {
      setBusy(true)
      try {
        const payload =
          source === 'qr'
            ? await authorizedRequest<CheckinResponse>(`/checkin/${encodeURIComponent(orderId)}`, { method: 'POST' })
            : await authorizedRequest<CheckinResponse>('/api/scanner/manual-checkin', {
                method: 'POST',
                body: { order_id: orderId },
              })

        setOutcome(fromCheckinSuccess(payload))
        playAudioFeedback(true)
        if (payload.state === 'ALREADY_CHECKED_IN') toast.show('Peserta sudah check-in sebelumnya.', 'info')
      } catch (error) {
        setOutcome(fromCheckinError(error))
        playAudioFeedback(false)
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  const handlePayload = useCallback(
    (rawPayload: string): void => {
      const orderId = extractOrderIdFromQrPayload(rawPayload)
      if (orderId === null) {
        setOutcome(fromUnknownQr(rawPayload))
        playAudioFeedback(false)
        return
      }

      // QR yang masih di depan kamera terbaca berkali-kali per detik; lihat
      // SAME_QR_COOLDOWN_MS untuk alasannya.
      if (!shouldProcessQr(lastQrRef.current, orderId, Date.now())) return
      lastQrRef.current = { orderId, at: Date.now() }

      void runCheckin(orderId, 'qr')
    },
    [runCheckin],
  )

  const scanner = useQrScanner(handlePayload)

  // Listener keyboard wedge untuk Scanner Stick (USB / Bluetooth HID)
  useEffect(() => {
    if (scanMode !== 'scanner_stick') return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      const now = Date.now()
      if (now - lastKeyTimeRef.current > 1000) {
        barcodeBufferRef.current = ''
      }
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        const payload = barcodeBufferRef.current.trim()
        barcodeBufferRef.current = ''
        if (payload.length > 0) {
          e.preventDefault()
          handlePayload(payload)
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [scanMode, handlePayload])

  return (
    <>
      <PageHeader
        title="Scan Presensi Seminar"
        description="Arahkan kamera atau gunakan scanner stick ke kode QR pada tiket peserta."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex border-b border-line">
            <button
              type="button"
              onClick={() => setScanMode('camera')}
              className={cn(
                'px-4 py-2 text-[13px] font-semibold border-b-2 transition-colors',
                scanMode === 'camera'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              📷 Mode Kamera (HP / Webcam)
            </button>
            <button
              type="button"
              onClick={() => {
                setScanMode('scanner_stick')
                if (scanner.status === 'scanning') scanner.stop()
              }}
              className={cn(
                'px-4 py-2 text-[13px] font-semibold border-b-2 transition-colors',
                scanMode === 'scanner_stick'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              🔫 Mode Scanner Stick (USB / Bluetooth)
            </button>
          </div>

          {scanMode === 'camera' ? (
            <>
              <div className="relative overflow-hidden rounded-md bg-ink">
                <video
                  ref={scanner.videoRef}
                  // `playsInline` wajib: tanpa itu iOS membuka pemutar layar penuh.
                  playsInline
                  muted
                  className={cn('h-[260px] w-full object-cover', scanner.status !== 'scanning' && 'opacity-30')}
                />
                {scanner.status === 'scanning' ? null : (
                  <div className="absolute inset-0 grid place-items-center p-4 text-center">
                    <p className="text-[13px] font-semibold text-white">
                      {scanner.failure === null ? 'Kamera belum aktif.' : scanner.failure.title}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                {scanner.status === 'scanning' ? (
                  <Button variant="secondary" onClick={scanner.stop}>
                    Hentikan kamera
                  </Button>
                ) : (
                  <Button variant="primary" loading={scanner.status === 'starting'} onClick={() => void scanner.start()}>
                    Nyalakan kamera
                  </Button>
                )}
                <span className="text-[12px] text-ink-soft">
                  {scanner.status === 'scanning' ? 'Kamera aktif — memindai…' : 'Kamera tidak aktif'}
                </span>
              </div>

              {scanner.failure === null ? null : <CameraHelp failure={scanner.failure} onRetry={() => void scanner.start()} />}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-success/40 bg-success-soft/30 p-8 text-center min-h-[295px]">
              <div className="relative mb-3 flex h-16 w-16 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/20 opacity-75" />
                <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-success text-white shadow-md">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </span>
              </div>
              <Badge tone="success" className="mb-2">🟢 SCANNER STICK AKTIF</Badge>
              <p className="text-[14px] font-semibold text-ink">Siap Menerima Tembakan Laser Scanner</p>
              <p className="mt-1 max-w-xs text-[12px] text-ink-muted">
                Arahkan laser scanner USB atau dongle Bluetooth ke barcode/QR tiket peserta. Tembakan laser akan diproses seketika (0% CPU, tanpa izin kamera).
              </p>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className={cn(outcome !== null && outcome.tone === 'success' && 'border-success/30 bg-success-soft')}>
            <CardHeader
              title="Hasil terakhir"
              description={busy ? 'Memproses…' : 'Muncul otomatis setelah QR terbaca.'}
            />

            {busy ? (
              <div className="flex items-center gap-2 text-ink-soft">
                <Spinner />
                Memeriksa tiket…
              </div>
            ) : outcome === null ? (
              <p className="text-ink-soft">Belum ada tiket yang dipindai.</p>
            ) : (
              <div
                className={cn(
                  'rounded-md border p-3',
                  outcome.tone === 'success' && 'border-success/30 bg-success-soft',
                  outcome.tone === 'warning' && 'border-warning/30 bg-warning-soft',
                  outcome.tone === 'danger' && 'border-danger/30 bg-danger-soft',
                )}
              >
                <p
                  className={cn(
                    'text-[16px] font-bold',
                    outcome.tone === 'success' && 'text-[#28a95b]',
                    outcome.tone === 'warning' && 'text-[#c78a21]',
                    outcome.tone === 'danger' && 'text-danger',
                  )}
                >
                  {outcome.title}
                </p>
                {outcome.name === null ? null : (
                  <p className="text-[15px] font-semibold text-ink">{outcome.name}</p>
                )}
                {outcome.orderId === null ? null : (
                  <p className="font-mono text-[12px] text-ink-soft">Order {outcome.orderId}</p>
                )}
                <p className="mt-1 text-[12px] text-ink-soft">{outcome.detail}</p>
                {outcome.clickedAt === null ? null : (
                  <p className="mt-1 text-[12px] font-semibold text-ink">
                    Check-in {formatTime(outcome.clickedAt)}
                  </p>
                )}
              </div>
            )}
          </Card>

          {hasPermission(profile, 'action.manual_checkin') ? <ManualSearch onCheckin={(orderId) => void runCheckin(orderId, 'manual')} busy={busy} /> : null}
        </div>
      </div>
    </>
  )
}

/**
 * Bantuan saat kamera gagal (PRD §98, H06).
 *
 * Menampilkan langkah konkret, bukan sekadar "gagal": izin kamera di browser
 * hanya bisa diubah dari setelan situs, dan panitia di lapangan tidak punya
 * waktu menebak. Setiap jenis kegagalan punya langkahnya sendiri, dan tombol
 * coba lagi hanya muncul bila percobaan ulang memang masuk akal — pada izin yang
 * sudah ditolak, menekan tombol lagi tidak akan memunculkan dialog apa pun.
 */
function CameraHelp({ failure, onRetry }: { failure: CameraFailure; onRetry: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-3">
      <p className="text-[13px] font-semibold text-[#c78a21]">{failure.title}</p>
      <p className="mt-0.5 text-[12px] text-ink">{failure.message}</p>

      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[12px] text-ink-soft">
        {failure.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="mt-3 flex items-center gap-2">
        {failure.canRetry ? (
          <Button size="sm" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
        <span className="text-[11px] text-ink-soft">
          Manual Search di bawah tetap dapat dipakai tanpa kamera.
        </span>
      </div>
    </div>
  )
}

/**
 * Manual Search — aksi sekunder (PRD §99, 01 §14, 03 §10–§11).
 *
 * Muncul sebagai bagian halaman, bukan disembunyikan: justru saat kamera gagal
 * (H06) operator membutuhkannya, dan saat itu ia tidak punya waktu mencari menu.
 * Validasi check-in-nya identik dengan QR dan tidak dapat mem-bypass aturan Paid
 * (H09) — server yang memutuskan, bukan halaman ini.
 */
function ManualSearch({ onCheckin, busy }: { onCheckin: (orderId: string) => void; busy: boolean }) {
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const debounced = useDebouncedValue(query)
  const term = effectiveSearch(debounced)

  const { data, loading, error } = useAsyncData(
    async () => {
      if (term === '') return { candidates: [] as Candidate[] }
      return authorizedRequest<{ candidates: Candidate[] }>(`/api/scanner/search?q=${encodeURIComponent(term)}`)
    },
    [term, refreshKey],
  )

  const candidates = data?.candidates ?? []

  return (
    <Card>
      <CardHeader
        title="Manual Search"
        description="Dipakai bila kamera bermasalah. Cari Order ID, nama, atau nomor WA."
      />

      <SearchInput
        id="scanner-manual-search"
        value={query}
        onChange={setQuery}
        placeholder="Order ID, nama, atau nomor WA"
      />

      {error === null ? null : <div className="mt-3"><ErrorState message={error} /></div>}

      {term === '' ? (
        <p className="mt-3 text-ink-soft">Ketik minimal 2 karakter (Order ID numerik boleh 1 karakter).</p>
      ) : loading ? (
        <p className="mt-3 flex items-center gap-2 text-ink-soft">
          <Spinner /> Mencari…
        </p>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-ink-soft">Tidak ada kandidat seminar yang cocok.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.order_id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-card p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{formatText(candidate.name)}</p>
                <p className="font-mono text-[12px] text-ink-soft">Order {candidate.order_id}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={appStatusTone(candidate.app_status)}>{candidate.app_status}</Badge>
                  {candidate.already_checked_in ? (
                    <Badge tone="warning">Sudah check-in {formatTime(candidate.checked_in_at)}</Badge>
                  ) : null}
                </div>
              </div>

              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  onCheckin(candidate.order_id)
                  setRefreshKey((value) => value + 1)
                }}
              >
                Check-in
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
