import { Badge, appStatusTone, attendanceTone, eventTypeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { DetailList } from '../../ui/Card'
import { Drawer } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { formatDateTime, formatText, formatTime } from '../../lib/format'
import type { PresensiRow } from '../../lib/queries'

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
export function PresensiDetailDrawer({ row, onClose }: { row: PresensiRow | null; onClose: () => void }) {
  const toast = useToast()
  const timestamps = row?.timestamps ?? []
  const accessUrl = row ? `${window.location.origin}/access/${encodeURIComponent(row.order_id)}` : ''

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
              { label: 'Total Activity', value: String(row.total_activity) },
              { label: 'Aktivitas terbaru', value: formatDateTime(row.latest_activity) },
            ]}
          />

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
                  href={`/access/${encodeURIComponent(row.order_id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-sm border border-line bg-card px-2.5 text-[12px] font-semibold text-primary hover:bg-soft"
                >
                  Buka Tiket / Link
                </a>
              </div>
            </div>
          </section>

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
        </div>
      )}
    </Drawer>
  )
}
