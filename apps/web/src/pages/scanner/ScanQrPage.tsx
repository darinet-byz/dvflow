import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Modal } from '../../ui/Overlay'
import { buildCheckinQrSvg } from '../../ticket/qr'
import {
  fromCheckinError,
  fromCheckinSuccess,
  fromScannerTestQr,
  fromUnknownQr,
  isScannerTestQr,
  SCANNER_TEST_QR_PAYLOAD,
  shouldProcessQr,
  type CheckinResponse,
  type ScanOutcome,
} from './scan-feedback'
import type { CameraFailure } from './camera-permission'
import { useQrScanner } from './useQrScanner'
import { useScannerStick } from './useScannerStick'
import { OtsDrawer } from './OtsDrawer'
import { useFieldAppMode } from '../../lib/field-app'

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
  quantity: number
  checked_in_tickets: number
  remaining_tickets: number
  already_checked_in: boolean
  checked_in_at: string | null
}

export function ScanQrPage() {
  const { profile } = useSession()
  const toast = useToast()
  const { outcome, setOutcome, busy, runCheckin, playAudioFeedback, pendingTickets, confirmTickets, cancelTickets } =
    useCheckin()
  const fieldMode = useFieldAppMode()
  const [scanMode, setScanMode] = useState<'camera' | 'scanner_stick'>('camera')
  const [showTestQr, setShowTestQr] = useState(false)
  const [showOts, setShowOts] = useState(false)
  const lastQrRef = useRef<{ orderId: string; at: number } | null>(null)

  const handlePayload = useCallback(
    (rawPayload: string): void => {
      // A61: selama dialog jumlah tiket terbuka, scan lain diabaikan. Ini juga
      // melindungi Scanner Stick dari mengonfirmasi jumlah secara tak sengaja.
      if (pendingTickets !== null) return

      // QR tes: dicek lebih dulu, tidak pernah ke server, tidak mencatat presensi.
      if (isScannerTestQr(rawPayload)) {
        if (!shouldProcessQr(lastQrRef.current, SCANNER_TEST_QR_PAYLOAD, Date.now())) return
        lastQrRef.current = { orderId: SCANNER_TEST_QR_PAYLOAD, at: Date.now() }
        setOutcome(fromScannerTestQr())
        playAudioFeedback(true)
        toast.show('QR tes terbaca · scanner berfungsi', 'success')
        return
      }

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
    [pendingTickets, runCheckin, toast],
  )

  const scanner = useQrScanner(handlePayload)

  // Keyboard wedged dimatikan saat dialog terbuka; lihat catatan di modal.
  const stick = useScannerStick(scanMode === 'scanner_stick' && pendingTickets === null, handlePayload)

  return (
    <>
      <PageHeader
        title={fieldMode ? '' : 'Scan Presensi Seminar'}
        action={
          <div className="flex flex-wrap gap-2">
            {!fieldMode && hasPermission(profile, 'action.ots') ? (
              <Button variant="primary" onClick={() => setShowOts(true)}>Peserta OTS</Button>
            ) : null}
            <Button onClick={() => setShowTestQr(true)}>QR Tes Scanner</Button>
          </div>
        }
      />
      <TestQrModal open={showTestQr} onClose={() => setShowTestQr(false)} />
      <OtsDrawer open={showOts} onClose={() => setShowOts(false)} canDelete={hasPermission(profile, 'action.delete_master')} />
      <TicketQuantityModal
        prompt={pendingTickets}
        busy={busy}
        scannerStick={scanMode === 'scanner_stick'}
        onConfirm={(tickets) => {
          lastQrRef.current = pendingTickets === null ? null : { orderId: pendingTickets.orderId, at: Date.now() }
          void confirmTickets(tickets)
        }}
        onCancel={() => {
          lastQrRef.current = pendingTickets === null ? null : { orderId: pendingTickets.orderId, at: Date.now() }
          cancelTickets()
        }}
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
            <ScannerStickPanel state={stick} />
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <OutcomeCard outcome={outcome} busy={busy} />

          {!fieldMode && hasPermission(profile, 'action.manual_checkin') ? <ManualSearch onCheckin={(orderId) => void runCheckin(orderId, 'manual')} busy={busy} /> : null}
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
export function ManualSearch({ onCheckin, busy }: { onCheckin: (orderId: string) => void; busy: boolean }) {
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
                  {candidate.quantity > 1 ? (
                    <Badge tone="primary">
                      {candidate.quantity} tiket · hadir {candidate.checked_in_tickets}/{candidate.quantity}
                    </Badge>
                  ) : null}
                  {candidate.already_checked_in ? (
                    <Badge tone="warning">Sudah check-in {formatTime(candidate.checked_in_at)}</Badge>
                  ) : null}
                </div>
              </div>

              <Button
                size="sm"
                variant="primary"
                disabled={busy || candidate.already_checked_in}
                onClick={() => {
                  onCheckin(candidate.order_id)
                  setRefreshKey((value) => value + 1)
                }}
              >
                {candidate.already_checked_in ? 'Sudah check-in' : 'Check-in'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Status Scanner Stick. "Terhubung" hanya setelah halaman menerima tembakan scan dari alat
 * (browser tidak bisa mendeteksi colokan USB/Bluetooth keyboard), lihat useScannerStick.
 */
function ScannerStickPanel({ state }: { state: ReturnType<typeof useScannerStick> }) {
  const tone = !state.focused ? 'danger' : state.connected ? 'success' : 'warning'
  return (
    <div
      data-stick-status={!state.focused ? 'unfocused' : state.connected ? 'connected' : 'waiting'}
      className={cn(
        'flex min-h-[295px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center',
        tone === 'success' && 'border-success/40 bg-success-soft/30',
        tone === 'warning' && 'border-warning/50 bg-warning-soft/40',
        tone === 'danger' && 'border-danger/40 bg-danger-soft/40',
      )}
    >
      {!state.focused ? (
        <>
          <Badge tone="danger" className="mb-2">Halaman tidak fokus</Badge>
          <p className="text-[14px] font-semibold text-ink">Klik di halaman ini dulu</p>
          <p className="mt-1 max-w-xs text-[12px] text-ink-muted">
            Scanner mengetik ke jendela yang sedang aktif. Selama jendela lain yang aktif, hasil scan tidak sampai ke sini.
          </p>
        </>
      ) : state.connected ? (
        <>
          <Badge tone="success" className="mb-2">Scanner terhubung</Badge>
          <p className="text-[14px] font-semibold text-ink">Siap memindai tiket peserta</p>
          <p className="mt-1 max-w-xs text-[12px] text-ink-muted">
            Scan terakhir diterima {state.lastScanAt === null ? '' : formatTime(new Date(state.lastScanAt).toISOString())}.
          </p>
        </>
      ) : (
        <>
          <Badge tone="warning" className="mb-2">Menunggu scanner</Badge>
          <p className="text-[14px] font-semibold text-ink">Belum ada data dari Scanner Stick</p>
          <p className="mt-1 max-w-xs text-[12px] text-ink-muted">
            Sambungkan scanner (USB atau Bluetooth), lalu scan QR apa saja untuk tes koneksi. Status berubah menjadi
            "Scanner terhubung" setelah hasil scan pertama diterima halaman ini.
          </p>
        </>
      )}
    </div>
  )
}

/** QR tes yang bisa dipindai berulang untuk mengecek kamera / Scanner Stick tanpa tiket peserta. */
function TestQrModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // SVG dibuat oleh kode kita sendiri dari konstanta; tidak ada input pengguna/webhook.
  const svg = useMemo(() => buildCheckinQrSvg(SCANNER_TEST_QR_PAYLOAD), [])
  const downloadHref = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg])
  return (
    <Modal
      open={open}
      title="QR Tes Scanner"
      onClose={onClose}
      footer={
        <>
          <a
            href={downloadHref}
            download="dvflow-qr-tes-scanner.svg"
            className="inline-flex items-center rounded-sm border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-soft"
          >
            Unduh QR
          </a>
          <Button onClick={onClose}>Tutup</Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="aspect-square w-full max-w-[220px] bg-white" data-testid="scanner-test-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="font-mono text-[12px] text-ink-soft">{SCANNER_TEST_QR_PAYLOAD}</p>
        <p className="max-w-sm text-[12px] text-ink-muted">
          Scan QR ini dengan kamera atau Scanner Stick untuk mengecek alat. Hasilnya "QR tes terbaca", tidak mencatat
          presensi, dan bisa dipakai berulang. Tampilkan di HP lain, atau unduh lalu cetak.
        </p>
      </div>
    </Modal>
  )
}

/**
 * State & aksi check-in bersama layar Scan dan Cari Peserta (A30): satu sumber pesan,
 * bunyi, dan toast jumlah tiket, supaya kedua layar berperilaku sama persis.
 */
export type PendingTickets = {
  orderId: string
  source: 'qr' | 'manual'
  name: string | null
  session: string | null
  quantity: number
  checkedIn: number
  remaining: number
}

export function useCheckin() {
  const toast = useToast()
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingTickets, setPendingTickets] = useState<PendingTickets | null>(null)

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

  /**
   * A61: `tickets` kosong berarti "tanya server berapa sisanya". Server menjawab
   * NEEDS_QUANTITY tanpa menulis apa pun, lalu pemanggil menampilkan dialog.
   */
  const runCheckin = useCallback(
    async (orderId: string, source: 'qr' | 'manual', tickets?: number): Promise<void> => {
      setBusy(true)
      try {
        const payload =
          source === 'qr'
            ? await authorizedRequest<CheckinResponse>(`/checkin/${encodeURIComponent(orderId)}`, {
                method: 'POST',
                ...(tickets === undefined ? {} : { body: { tickets } }),
              })
            : await authorizedRequest<CheckinResponse>('/api/scanner/manual-checkin', {
                method: 'POST',
                body: tickets === undefined ? { order_id: orderId } : { order_id: orderId, tickets },
              })

        if (payload.state === 'NEEDS_QUANTITY') {
          setPendingTickets({
            orderId: payload.order_id,
            source,
            name: payload.name,
            session: payload.session,
            quantity: Math.max(payload.quantity ?? 1, 1),
            checkedIn: payload.checked_in_tickets ?? 0,
            remaining: Math.max(payload.remaining_tickets ?? 1, 1),
          })
          return
        }

        setPendingTickets(null)
        setOutcome(fromCheckinSuccess(payload))
        playAudioFeedback(true)
        const confirmed = payload.tickets_confirmed ?? 0
        const remaining = payload.remaining_tickets ?? 0
        if (payload.state === 'ALREADY_CHECKED_IN') {
          toast.show(`Sudah check-in · ${payload.quantity ?? 1} tiket`, 'info')
        } else if (remaining > 0) {
          toast.show(`Check-in ${confirmed} tiket · sisa ${remaining} dari ${payload.quantity ?? confirmed}`, 'success')
        } else {
          toast.show(`Check-in ${confirmed} tiket berhasil`, 'success')
        }
      } catch (error) {
        setPendingTickets(null)
        setOutcome(fromCheckinError(error))
        playAudioFeedback(false)
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  const confirmTickets = useCallback(
    async (tickets: number): Promise<void> => {
      if (pendingTickets === null) return
      await runCheckin(pendingTickets.orderId, pendingTickets.source, tickets)
    },
    [pendingTickets, runCheckin],
  )

  const cancelTickets = useCallback(() => setPendingTickets(null), [])

  return {
    outcome,
    setOutcome,
    busy,
    runCheckin,
    playAudioFeedback,
    pendingTickets,
    confirmTickets,
    cancelTickets,
  }
}

/**
 * Dialog jumlah tiket (A61).
 *
 * Muncul hanya bila sisa tiket > 1. Untuk Scanner Stick, seluruh tombol keyboard
 * diabaikan selama dialog terbuka: alat mengetik isi QR + Enter, dan tanpa guard
 * ini Enter bisa mengonfirmasi jumlah yang salah. Konfirmasi selalu lewat klik/tap.
 */
export function TicketQuantityModal({
  prompt,
  busy,
  scannerStick = false,
  onConfirm,
  onCancel,
}: {
  prompt: PendingTickets | null
  busy: boolean
  scannerStick?: boolean
  onConfirm: (tickets: number) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(1)

  useEffect(() => {
    setCount(Math.max(prompt?.remaining ?? 1, 1))
  }, [prompt?.orderId, prompt?.remaining])

  if (prompt === null) return null

  const max = Math.max(prompt.remaining, 1)
  const safeCount = Math.min(Math.max(count, 1), max)
  const quick = Array.from({ length: Math.min(max, 6) }, (_, index) => index + 1)

  return (
    <Modal open title="Berapa tiket yang masuk?" onClose={onCancel}>
      <div
        data-testid="ticket-quantity-modal"
        onKeyDown={(event) => {
          // Enter dan karakter tunggal (isi QR dari Scanner Stick) tidak boleh
          // mengubah atau mengonfirmasi apa pun. Tab/Escape tetap berfungsi.
          if (event.key === 'Enter' || event.key.length === 1) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <p className="text-[15px] font-semibold text-ink">{formatText(prompt.name)}</p>
        <p className="font-mono text-[12px] text-ink-soft">Order {prompt.orderId}</p>
        {prompt.session === null ? null : <p className="text-[12px] text-ink-soft">Sesi {prompt.session}</p>}

        <p className="mt-2 rounded-md border border-line bg-page p-2 text-[12px] text-ink-soft">
          Order ini <strong className="text-ink">{prompt.quantity} tiket</strong> · sudah hadir{' '}
          <strong className="text-ink">{prompt.checkedIn}</strong> · sisa{' '}
          <strong className="text-ink">{max}</strong>
        </p>

        <div className="mt-3 flex items-center justify-center gap-3">
          <Button size="sm" disabled={safeCount <= 1} onClick={() => setCount((value) => Math.max(1, value - 1))}>
            −
          </Button>
          <span className="min-w-[3ch] text-center text-[32px] font-bold leading-none tabular-nums text-primary">
            {safeCount}
          </span>
          <Button size="sm" disabled={safeCount >= max} onClick={() => setCount((value) => Math.min(max, value + 1))}>
            +
          </Button>
        </div>

        {quick.length > 1 ? (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {quick.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCount(value)}
                className={cn(
                  'h-8 min-w-8 rounded-sm border px-2 text-[13px] font-semibold',
                  safeCount === value
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-line bg-card text-ink hover:bg-soft',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}

        {scannerStick ? (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-2 text-[11px] text-[#c78a21]">
            Mode Scanner Stick: konfirmasi dengan klik. Ketikan alat berikutnya diabaikan selama dialog ini terbuka.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>Batal</Button>
          <Button variant="primary" loading={busy} onClick={() => onConfirm(safeCount)}>
            Konfirmasi {safeCount} tiket
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Kartu "Hasil terakhir" (PRD §96): status, nama, Order ID, jumlah tiket besar. */
export function OutcomeCard({ outcome, busy }: { outcome: ScanOutcome | null; busy: boolean }) {
  return (
    <Card className={cn(outcome !== null && outcome.tone === 'success' && 'border-success/30 bg-success-soft')}>
      <CardHeader
        title="Hasil terakhir" description={busy ? 'Memproses…' : undefined}
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
          {outcome.quantity === null ? null : (
            <p
              className="my-1 text-[15px] font-bold tracking-wide text-primary"
              aria-label={`Jumlah tiket ${outcome.ticketsConfirmed || outcome.quantity}`}
            >
              <span className="mr-1 text-[40px] leading-none">{outcome.ticketsConfirmed || outcome.quantity}</span>TIKET
            </p>
          )}
          {outcome.quantity === null || outcome.checkedInTickets === null ? null : (
            <p className="text-[12px] font-semibold text-ink">
              Total hadir {outcome.checkedInTickets}/{outcome.quantity}
              {outcome.remainingTickets !== null && outcome.remainingTickets > 0
                ? ` · sisa ${outcome.remainingTickets} tiket`
                : ''}
            </p>
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
  )
}
