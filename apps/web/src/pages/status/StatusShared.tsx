import type { BadgeTone } from '../../ui/Badge'
import { Badge } from '../../ui/Badge'

export type ProductStatus = 'Active' | 'In-Active' | 'On-Hold' | 'Upcoming'
export type AdvertiserStatus = 'In-House' | 'Freelance' | 'Intern' | 'Resign'

export const PRODUCT_STATUS_OPTIONS: ReadonlyArray<{ value: ProductStatus; label: string }> = [
  { value: 'Active', label: 'Active' },
  { value: 'In-Active', label: 'In-Active' },
  { value: 'On-Hold', label: 'On-Hold' },
  { value: 'Upcoming', label: 'Upcoming' },
]

export const ADVERTISER_STATUS_OPTIONS: ReadonlyArray<{ value: AdvertiserStatus; label: string }> = [
  { value: 'In-House', label: 'In-House' },
  { value: 'Freelance', label: 'Freelance' },
  { value: 'Intern', label: 'Intern' },
  { value: 'Resign', label: 'Resign' },
]

export function productStatusTone(status: string): BadgeTone {
  if (status === 'Active') return 'success'
  if (status === 'On-Hold') return 'warning'
  if (status === 'Upcoming') return 'primary'
  return 'neutral'
}

export function advertiserStatusTone(status: string): BadgeTone {
  if (status === 'In-House') return 'success'
  if (status === 'Freelance') return 'primary'
  if (status === 'Intern') return 'warning'
  return 'danger'
}

export type MappingItem = { id?: string; code: string; name: string }

/**
 * Label mapping (produk-pengiklan) di tabel status.
 * Maksimal 4 badge; sisanya diringkas dan daftar lengkap ada di title.
 *
 * A59: Status Produk menampilkan NAMA pengiklan (bukan kode); Status Pengiklan
 * tetap menampilkan KODE produk. Kode/nama lengkap tetap ada di tooltip.
 */
export function MappingBadges({
  items,
  empty = '-',
  label = 'code',
}: {
  items: MappingItem[]
  empty?: string
  label?: 'code' | 'name'
}) {
  if (items.length === 0) return <span className="text-[12px] text-ink-muted">{empty}</span>
  const visible = items.slice(0, 4)
  const hidden = items.length - visible.length
  const text = (item: MappingItem): string =>
    label === 'name' ? (item.name.trim() === '' ? item.code : item.name) : item.code
  return (
    <div className="flex max-w-[260px] flex-wrap items-center gap-1">
      {visible.map((item) => (
        <span key={`${item.code}-${item.name}`} title={`${item.code} — ${item.name}`}>
          <Badge tone="primary">{text(item)}</Badge>
        </span>
      ))}
      {hidden > 0 ? (
        <span title={items.map((item) => `${item.code} — ${item.name}`).join(', ')}>
          <Badge tone="neutral">+{hidden} lagi</Badge>
        </span>
      ) : null}
    </div>
  )
}
