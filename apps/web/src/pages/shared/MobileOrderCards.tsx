import type { ReactNode } from 'react'
import { toWhatsAppNumber } from '@dvflow/shared'
import { formatSession, formatText } from '../../lib/format'
import type { FollowUpSummaryView, FollowUpTarget } from '../../lib/useFollowUpActions'
import { cn } from '../../ui/cn'

export type MobileOrderCardItem = {
  /** Kunci unik baris (order_id). */
  key: string
  target: FollowUpTarget
  name: string | null
  productName: string | null
  session: string | null
  city: string | null
  quantity: number | null
  /** Badge status yang sudah jadi (Order: app_status; Presensi: attendance_status). */
  status: ReactNode
}

/**
 * Kartu bersama Order & Presensi di HP (A78).
 *
 *   No · Nama · Jumlah Tiket · Status
 *   Nama Produk · Sesi · Kota
 *   F1 · F2 · F3 · F4
 *
 * Dipakai di Order (semua HP) dan Presensi (mode lapangan, kedua tab) supaya
 * tampilan dan perilaku Follow Up-nya identik. Detail lengkap tetap di drawer.
 */
export function MobileOrderCards({
  items,
  startIndex,
  summaries,
  busyOrderId,
  onOpen,
  onBubble,
  testId = 'mobile-order-cards',
}: {
  items: readonly MobileOrderCardItem[]
  startIndex: number
  summaries: ReadonlyMap<string, FollowUpSummaryView>
  busyOrderId: string | null
  onOpen: (item: MobileOrderCardItem) => void
  onBubble: (item: MobileOrderCardItem, slot: number) => void
  testId?: string
}) {
  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-[13px] text-ink-soft">
        Tidak ada data yang cocok dengan filter aktif.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-line" data-testid={testId}>
      {items.map((item, index) => {
        const phoneValid = toWhatsAppNumber(item.target.phone) !== null
        const summary = summaries.get(item.key)
        const busy = busyOrderId === item.key

        return (
          <li key={item.key} className="px-3 py-3">
            <button
              type="button"
              className="block w-full min-w-0 text-left active:opacity-70"
              onClick={() => onOpen(item)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-[11px] tabular-nums text-ink-muted">{startIndex + index}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" title={item.name ?? undefined}>
                  {formatText(item.name)}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                  {item.quantity === null ? '-' : `${item.quantity} tiket`}
                </span>
                <span className="shrink-0">{item.status}</span>
              </div>

              <div className="mt-0.5 flex min-w-0 items-center gap-2 pl-8 text-[12px] text-ink-soft">
                <span className="min-w-0 flex-1 truncate" title={item.productName ?? undefined}>
                  {formatText(item.productName)}
                </span>
                <span className="shrink-0 whitespace-nowrap">{formatSession(item.session)}</span>
                <span className="max-w-[38%] shrink-0 truncate">{formatText(item.city)}</span>
              </div>
            </button>

            <div className="mt-2 grid grid-cols-4 gap-1.5 pl-8">
              {[1, 2, 3, 4].map((slot) => {
                const used = summary?.used.includes(slot) === true
                const hasTemplate = summary?.slots.includes(slot) === true
                const disabled = busy || !phoneValid
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={disabled}
                    aria-label={`Follow up F${slot} ${item.key}`}
                    title={
                      !phoneValid
                        ? 'Nomor WA tidak valid'
                        : used
                          ? 'Sudah dipakai untuk order ini'
                          : hasTemplate
                            ? 'Buka preview template'
                            : 'Belum ada template — buka WhatsApp kosong'
                    }
                    onClick={() => onBubble(item, slot)}
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
          </li>
        )
      })}
    </ul>
  )
}
