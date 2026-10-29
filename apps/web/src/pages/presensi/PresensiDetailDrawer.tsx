import { useEffect, useState } from 'react'
import { Badge, appStatusTone, attendanceTone, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { DetailList } from '../../ui/Card'
import { Drawer } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { formatDateTime, formatText, formatTime } from '../../lib/format'
import { isOtsOrder, participantAccessPath, participantAccessUrl } from '../../lib/access-link'
import { supabaseSelect } from '../../lib/supabase-rest'
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
}: {
  row: PresensiRow | null
  onClose: () => void
  onChanged?: () => void
}) {
  const toast = useToast()
  const timestamps = row?.timestamps ?? []
  const [history, setHistory] = useState<RescheduleHistoryRow[]>([])

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
              { label: 'Tiket hadir', value: `${row.checked_in_tickets}/${row.quantity}` },
              { label: 'Sisa tiket', value: String(Math.max(row.quantity - row.checked_in_tickets, 0)) },
              { label: 'Total Activity', value: String(row.total_activity) },
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
              Timestamp (10 terbaru)
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
            {/* Retensi 60 hari: yang lebih tua sudah dihapus cron (PRD §106). */}
            <p className="mt-2 text-[11px] text-ink-muted">
              Total {row.total_activity} aktivitas. Timestamp lebih tua dari 60 hari dihapus otomatis.
            </p>
          </section>

          <div className="border-t border-line pt-3">
            <OrderLifecycleActions order={row} onChanged={onChanged ?? onClose} />
          </div>
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
