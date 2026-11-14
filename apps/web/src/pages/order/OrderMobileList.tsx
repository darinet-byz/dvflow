import { toWhatsAppNumber } from '@dvflow/shared'
import { Badge, appStatusTone } from '../../ui/Badge'
import { formatText } from '../../lib/format'
import type { OrderRow } from '../../lib/queries'
import { cn } from '../../ui/cn'

export type FollowUpSummaryView = { slots: number[]; used: number[] }

/**
 * Kartu Order untuk layar HP (A77).
 *
 * Fokus ke data yang dipakai saat follow up: Nama, Produk (kode), Status, dan
 * F1-F4. Kolom lain tetap tersedia di drawer detail. Semua teks panjang memakai
 * ellipsis (bukan dipotong di data); nama lengkap ada di `title` dan drawer.
 */
export function OrderMobileList({
  rows,
  startIndex,
  summaries,
  busyOrderId,
  onOpen,
  onBubble,
}: {
  rows: readonly OrderRow[]
  /** Nomor urut halaman (1-based) untuk baris pertama. */
  startIndex: number
  summaries: ReadonlyMap<string, FollowUpSummaryView>
  busyOrderId: string | null
  onOpen: (order: OrderRow) => void
  onBubble: (order: OrderRow, slot: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const phoneValid = toWhatsAppNumber(row.phone) !== null
        const summary = summaries.get(row.order_id)
        const busy = busyOrderId === row.order_id

        return (
          <article key={row.id} className="rounded-md border border-line bg-card p-3">
            <button type="button" className="block w-full min-w-0 text-left" onClick={() => onOpen(row)}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{startIndex + index}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft" title={row.order_id}>
                  {row.order_id}
                </span>
                <Badge tone={appStatusTone(row.app_status)}>{row.app_status}</Badge>
              </div>

              <div className="mt-1 flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" title={row.name ?? undefined}>
                  {formatText(row.name)}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[12px] text-ink-soft">{formatText(row.phone)}</span>
              </div>

              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-soft">
                <span className="font-mono font-semibold text-ink">{formatText(row.product_code)}</span>
                {row.session === null ? null : <span>Sesi {row.session}</span>}
                {row.city === null ? null : <span className="truncate">{row.city}</span>}
              </div>
            </button>

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 4].map((slot) => {
                const used = summary?.used.includes(slot) === true
                const hasTemplate = summary?.slots.includes(slot) === true
                const disabled = busy || !phoneValid
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={disabled}
                    aria-label={`Follow up F${slot} ${row.order_id}`}
                    title={
                      !phoneValid
                        ? 'Nomor WA tidak valid'
                        : used
                          ? 'Sudah dipakai untuk order ini'
                          : hasTemplate
                            ? 'Buka preview template'
                            : 'Belum ada template — buka WhatsApp kosong'
                    }
                    onClick={() => onBubble(row, slot)}
                    className={cn(
                      'rounded-md border py-2 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      used
                        ? 'border-success/40 bg-success-soft text-success'
                        : hasTemplate
                          ? 'border-primary/30 bg-primary-soft text-primary hover:bg-primary/10'
                          : 'border-dashed border-line bg-soft text-ink-muted hover:bg-page',
                    )}
                  >
                    F{slot}
                    {used ? <span aria-hidden="true"> ✓</span> : null}
                  </button>
                )
              })}
            </div>
          </article>
        )
      })}
    </div>
  )
}
