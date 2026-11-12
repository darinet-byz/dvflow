import { useEffect, useState } from 'react'
import { Badge, appStatusTone, attendanceTone, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { DetailList } from '../../ui/Card'
import { TextInput } from '../../ui/Field'
import { Drawer, Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { ApiError } from '../../lib/api'
import { formatDateTime, formatText, formatTime } from '../../lib/format'
import { isOtsOrder, participantAccessPath, participantAccessUrl } from '../../lib/access-link'
import { hasPermission } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { supabaseSelect } from '../../lib/supabase-rest'
import { useSession } from '../../lib/useSession'
import type { PresensiRow, RescheduleHistoryRow } from '../../lib/queries'
import { OrderLifecycleActions } from '../order/OrderLifecycleActions'

/**
 * Drawer detail Presensi (PRD §112).
 *
 * Dipakai supaya konteks tabel di belakangnya tidak hilang (PRD §142). Isinya
 * hanya data presensi yang memang ada — PRD §112 menyatakan field TAMBAHAN di
 * luar data presensi **tidak ditentukan**, jadi tidak ada yang dikarang di sini.
 *
 * Semua timestamp ditampilkan (sampai yang tersimpan), bukan hanya sepuluh yang
 * dipakai kolom tabel.
 */
export function PresensiDetailDrawer({
  row,
  onClose,
  onChanged,
  realtime = false,
}: {
  row: PresensiRow | null
  onClose: () => void
  onChanged?: () => void
  /** A68: tab Realtime menghitung status dari rentang tanggal, tetapi koreksi manual tetap total. */
  realtime?: boolean
}) {
  const toast = useToast()
  const profile = useSession().profile
  const timestamps = row?.timestamps ?? []
  const [history, setHistory] = useState<RescheduleHistoryRow[]>([])
  const [correction, setCorrection] = useState<'present' | 'reset' | null>(null)
  const [correctionCount, setCorrectionCount] = useState('1')
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)

  useEffect(() => {
    if (row === null || row.rescheduled !== true) {
      setHistory([])
      return
    }
    let cancelled = false
    void supabaseSelect<RescheduleHistoryRow>(
      'order_reschedules',
      { order_id: `eq.${row.order_id}`, order: 'created_at.desc' },
      'id,from_batch,from_session,from_city,to_batch,to_session,to_city,reason,actor_name,created_at',
    )
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [row?.order_id, row?.rescheduled])

  // Tutup dialog koreksi saat pindah baris / drawer ditutup.
  useEffect(() => {
    setCorrection(null)
    setCorrectionError(null)
  }, [row?.order_id])

  // A62: koreksi manual hanya untuk presensi seminar/hybrid yang masih Paid.
  // Webinar tidak punya scan, dan OTS memang langsung hadir.
  const remainingTickets = row === null ? 0 : Math.max(row.quantity - row.checked_in_tickets, 0)
  const canCorrect = row !== null &&
    hasPermission(profile, 'action.manual_checkin') &&
    row.app_status === 'Paid' &&
    !isOtsOrder(row.order_id) &&
    (row.event_type === 'Seminar Offline' || row.event_type === 'Hybrid')

  function openCorrection(kind: 'present' | 'reset'): void {
    if (row === null) return
    setCorrectionError(null)
    setCorrection(kind)
    setCorrectionCount(String(kind === 'present' ? Math.max(remainingTickets, 1) : Math.max(row.checked_in_tickets, 1)))
  }

  async function submitCorrection(): Promise<void> {
    if (row === null || correction === null || correctionBusy) return
    const max = correction === 'present' ? remainingTickets : row.checked_in_tickets
    const count = Number(correctionCount)
    if (!Number.isInteger(count) || count < 1 || count > max) {
      setCorrectionError(`Jumlah tiket harus antara 1 dan ${max}.`)
      return
    }

    setCorrectionBusy(true)
    setCorrectionError(null)
    try {
      await authorizedRequest(
        `/api/presensi/${encodeURIComponent(row.order_id)}/${correction === 'present' ? 'mark-present' : 'reset'}`,
        { method: 'POST', body: { tickets: count } },
      )
      toast.show(
        correction === 'present'
          ? `${count} tiket ditandai hadir.`
          : `${count} check-in dibatalkan.`,
        'success',
      )
      setCorrection(null)
      onChanged?.()
    } catch (cause) {
      setCorrectionError(cause instanceof ApiError ? cause.message : 'Tindakan gagal. Silakan coba lagi.')
    } finally {
      setCorrectionBusy(false)
    }
  }

  // A27: link resmi memisahkan kode toko: /access/MTIX/283818331.
  const accessUrl = row ? participantAccessUrl(row.order_id) : ''

  async function copyAccessLink() {
    if (!accessUrl) return
    try {
      await navigator.clipboard.writeText(accessUrl)
      toast.show('Link akses peserta disalin.', 'success')
    } catch {
      toast.show('Salin link secara manual dari kotak link.', 'danger')
    }
  }

  return (
    <Drawer
      open={row !== null}
      title={row === null ? 'Detail Presensi' : `Presensi ${row.order_id}`}
      onClose={onClose}
    >
      {row === null ? null : (
        <div className="flex flex-col gap-4">
          <DetailList
            items={[
              { label: 'Order ID', value: <span className="font-mono">{row.order_id}</span> },
              { label: 'Nama', value: formatText(row.name) },
              { label: 'No WA', value: formatText(row.phone) },
              { label: 'Status order', value: <Badge tone={appStatusTone(row.app_status)}>{row.app_status}</Badge> },
              { label: 'Status presensi', value: <Badge tone={attendanceTone(row.attendance_status)}>{row.attendance_status}</Badge> },
              { label: 'Jumlah tiket', value: String(row.quantity) },
              {
                label: realtime ? 'Tiket hadir (rentang)' : 'Tiket hadir',
                value: `${realtime ? row.checked_in_in_range ?? row.checked_in_tickets : row.checked_in_tickets}/${row.quantity}`,
              },
              ...(realtime
                ? [{ label: 'Tiket hadir (total)', value: `${row.checked_in_tickets}/${row.quantity}` }]
                : []),
              { label: realtime ? 'Sisa tiket (total)' : 'Sisa tiket', value: String(Math.max(row.quantity - row.checked_in_tickets, 0)) },
              { label: realtime ? 'Total Activity (rentang)' : 'Total Activity', value: String(row.total_activity) },
              { label: 'Di-scan oleh', value: formatText(row.scanner_names?.length ? row.scanner_names.join(', ') : null) },
              { label: 'Aktivitas terbaru', value: formatDateTime(row.latest_activity) },
            ]}
          />

          {row.rescheduled === true ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Reschedule</h3>
              <DetailList
                items={[
                  { label: 'Asal', value: eventLabel(row.original_batch, row.original_session, row.original_city) },
                  { label: 'Tujuan', value: eventLabel(row.batch, row.session, row.city) },
                  { label: 'Alasan terakhir', value: formatText(history[0]?.reason) },
                  { label: 'Diubah oleh', value: formatText(history[0]?.actor_name) },
                  { label: 'Waktu', value: formatDateTime(history[0]?.created_at) },
                ]}
              />
              {history.length > 1 ? (
                <details className="mt-2 text-[12px] text-ink-soft">
                  <summary className="cursor-pointer font-semibold text-ink">Riwayat lengkap ({history.length})</summary>
                  <ol className="mt-2 flex flex-col gap-1.5">
                    {history.map((item) => (
                      <li key={item.id}>
                        <span className="font-mono">{formatDateTime(item.created_at)}</span>
                        {' · '}
                        {eventLabel(item.from_batch, item.from_session, item.from_city)}
                        {' → '}
                        {eventLabel(item.to_batch, item.to_session, item.to_city)}
                        {item.actor_name ? ` · ${item.actor_name}` : ''}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </section>
          ) : null}

          {isOtsOrder(row.order_id) ? (
            <p className="rounded-md border border-line bg-page p-2.5 text-[12px] text-ink-soft">
              Peserta OTS: terdaftar dan dibayar di lokasi, langsung hadir. Tidak memakai tiket/link online.
            </p>
          ) : (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Tautan Akses Peserta (Tiket QR / Zoom)
            </h3>
            <div className="flex flex-col gap-2 rounded-md border border-line bg-page p-2.5">
              <span className="break-all font-mono text-[12px] text-ink">{accessUrl}</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void copyAccessLink()}>
                  Salin Link
                </Button>
                <a
                  href={participantAccessPath(row.order_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-sm border border-line bg-card px-2.5 text-[12px] font-semibold text-primary hover:bg-soft"
                >
                  Buka Tiket / Link
                </a>
              </div>
            </div>
          </section>
          )}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Acara</h3>
            <DetailList
              items={[
                { label: 'Produk', value: formatText(row.product_name) },
                { label: 'Kode produk', value: formatText(row.product_code) },
                { label: 'Pengiklan', value: formatText(row.advertiser_name) },
                {
                  label: 'Jenis acara',
                  value:
                    row.event_type === null ? '-' : <Badge tone={eventTypeTone(row.event_type)}>{row.event_type}</Badge>,
                },
                { label: 'Batch', value: formatText(row.batch) },
                { label: 'Sesi', value: formatText(row.session) },
                { label: 'Kota', value: formatText(row.city) },
              ]}
            />
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {realtime ? 'Timestamp (rentang, 10 terbaru)' : 'Timestamp (10 terbaru)'}
            </h3>
            {timestamps.length === 0 ? (
              <p className="text-ink-soft">Belum ada aktivitas presensi.</p>
            ) : (
              <ol className="flex flex-col gap-1 text-[13px]">
                {timestamps.map((timestamp, index) => (
                  <li key={`${timestamp}-${index}`} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-ink-soft">T{index + 1}</span>
                    <span className="font-mono">{formatTime(timestamp)}</span>
                    <span className="text-[11px] text-ink-muted">{formatDateTime(timestamp)}</span>
                  </li>
                ))}
              </ol>
            )}
            {/* Retensi 30 hari: yang lebih tua sudah dihapus cron (PRD §106, A41). */}
            <p className="mt-2 text-[11px] text-ink-muted">
              Total {row.total_activity} aktivitas{realtime ? ' pada rentang ini' : ''}. Timestamp lebih tua dari 30 hari dihapus otomatis.
            </p>
          </section>

          {canCorrect ? (
            <section data-testid="presensi-correction">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Koreksi Presensi
              </h3>
              <div className="flex flex-wrap gap-2">
                {remainingTickets > 0 ? (
                  <Button size="sm" onClick={() => openCorrection('present')}>
                    Tandai Hadir
                  </Button>
                ) : null}
                {row.checked_in_tickets > 0 ? (
                  <Button size="sm" variant="danger" onClick={() => openCorrection('reset')}>
                    Batalkan Check-in
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-[12px] text-ink-soft">
                Koreksi manual tanpa scan. Tindakan ini tercatat atas nama Anda di kolom “Di-scan oleh”.
                {realtime ? ' Koreksi selalu memakai total tiket, bukan hanya tiket pada rentang.' : ''}
              </p>
            </section>
          ) : null}

          <div className="border-t border-line pt-3">
            <OrderLifecycleActions order={row} onChanged={onChanged ?? onClose} />
          </div>

          <Modal
            open={correction !== null}
            title={correction === 'present' ? 'Tandai Hadir' : 'Batalkan Check-in'}
            onClose={() => {
              if (!correctionBusy) setCorrection(null)
            }}
            footer={
              <>
                <Button onClick={() => setCorrection(null)} disabled={correctionBusy}>
                  Batal
                </Button>
                <Button
                  variant={correction === 'reset' ? 'danger' : 'primary'}
                  loading={correctionBusy}
                  onClick={() => void submitCorrection()}
                >
                  {correction === 'present' ? 'Tandai Hadir' : 'Batalkan Check-in'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="rounded-md border border-line bg-page p-2.5 text-[12px] text-ink-soft">
                <strong className="text-ink">{row.order_id}</strong>
                {row.name ? ` · ${formatText(row.name)}` : ''}
                <br />
                Status saat ini: {row.attendance_status} · {row.checked_in_tickets}/{row.quantity} tiket hadir.
              </p>

              <TextInput
                id="presensi-correction-count"
                label={
                  correction === 'present'
                    ? `Jumlah tiket yang ditandai hadir (maks. ${Math.max(remainingTickets, 1)})`
                    : `Jumlah tiket yang dikembalikan ke Belum Hadir (maks. ${Math.max(row.checked_in_tickets, 1)})`
                }
                type="number"
                inputMode="numeric"
                value={correctionCount}
                onChange={setCorrectionCount}
              />

              <p className={correction === 'reset' ? 'text-[12px] text-danger' : 'text-[12px] text-ink-soft'}>
                {correction === 'present'
                  ? 'Tiket yang dipilih langsung dianggap hadir tanpa scan. Data presensi tetap tercatat per tiket.'
                  : 'Data presensi tiket terpilih dihapus permanen. E-tiket peserta kembali menampilkan QR untuk tiket yang dibatalkan.'}
              </p>

              {correctionError === null ? null : <p className="text-[12px] text-danger">{correctionError}</p>}
            </div>
          </Modal>
        </div>
      )}
    </Drawer>
  )
}

function eventLabel(batch: string | null | undefined, session: string | null | undefined, city: string | null | undefined): string {
  const parts = [
    batch ? `Batch ${batch}` : null,
    session ? `Sesi ${session}` : null,
    city ?? null,
  ].filter(Boolean)
  return parts.length === 0 ? '-' : parts.join(' · ')
}
