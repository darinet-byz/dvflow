import { useCallback, useRef, useState } from 'react'
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
  const toast = useToast()
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const lastQrRef = useRef<{ orderId: string; at: number } | null>(null)

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
        if (payload.state === 'ALREADY_CHECKED_IN') toast.show('Peserta sudah check-in sebelumnya.', 'info')
      } catch (error) {
        setOutcome(fromCheckinError(error))
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

  return (
    <>
      <PageHeader
        title="Scan Presensi Seminar"
        description="Arahkan kamera ke kode QR pada tiket peserta."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
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

          <ManualSearch onCheckin={(orderId) => void runCheckin(orderId, 'manual')} busy={busy} />
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
