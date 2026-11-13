import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Kartu (guideline §8).
 *
 * Kartu utama 18px (`rounded-lg`), kartu kecil 14px (`rounded-md`). Hierarki
 * dibangun lewat spasi dan tipografi, bukan border tebal atau bayangan berat.
 */
export function Card({
  children,
  className,
  padding = 'md',
}: {
  children: ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'none'
}) {
  const paddingClass = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : 'p-4'
  return <section className={cn('min-w-0 max-w-full rounded-lg border border-line bg-card shadow-card', paddingClass, className)}>{children}</section>
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 break-words">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        {description === undefined ? null : <p className="text-ink-soft">{description}</p>}
      </div>
      {action}
    </header>
  )
}

/**
 * Daftar label–nilai untuk drawer detail (PRD §48, §112).
 *
 * Dipakai bersama oleh drawer Order dan Presensi supaya keduanya tidak menyusun
 * tata letaknya sendiri-sendiri.
 */
export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-ink-soft">{item.label}</dt>
          <dd className="min-w-0 break-words font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * KPI card (guideline §13, PRD §43).
 *
 * Hanya SATU atau maksimal dua KPI yang diberi visual primary — sisanya kartu
 * netral. `highlight` dipakai untuk KPI utama, bukan untuk semua kartu.
 */
export function KpiCard({
  label,
  value,
  hint,
  highlight = false,
  size = 'md',
  className,
  valueClassName,
  onClick,
  pressed,
  ariaLabel,
}: {
  label: string
  value: string
  hint?: string
  highlight?: boolean
  /** `lg` untuk angka utama (mis. Gross/Net) yang perlu lebih menonjol. */
  size?: 'md' | 'lg'
  className?: string
  /** Warna angka (mis. `text-success` / `text-danger`); menggantikan `text-ink`. */
  valueClassName?: string
  /**
   * A73: bila diisi, kartu menjadi tombol (mis. drill-down KPI Sisa Tiket).
   * Isi kartu memakai `<span>` agar tetap sah di dalam `<button>`.
   */
  onClick?: () => void
  /** Status aktif untuk kartu yang berfungsi sebagai toggle filter. */
  pressed?: boolean
  /** Nama aksesibel; teks kartu terlalu panjang untuk diandalkan sebagai label. */
  ariaLabel?: string
}) {
  const labelClass = cn('text-[11px] font-semibold uppercase tracking-wide', highlight ? 'text-primary' : 'text-ink-soft')
  const valueClass = cn('mt-1 break-words font-bold', valueClassName || 'text-ink', size === 'lg' ? 'text-[28px]' : 'text-[20px]')
  const baseClass = cn(
    'min-w-0 rounded-md border',
    size === 'lg' ? 'p-4' : 'p-3',
    highlight ? 'border-primary/20 bg-primary-soft' : 'border-line bg-card',
    className,
  )

  // Kartu biasa mempertahankan struktur lama; hanya kartu yang bisa diklik yang
  // memakai <span> agar isinya sah di dalam <button>.
  if (onClick === undefined) {
    return (
      <div className={baseClass}>
        <p className={labelClass}>{label}</p>
        <p className={valueClass}>{value}</p>
        {hint === undefined ? null : <p className="text-[11px] text-ink-soft">{hint}</p>}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      className={cn(
        baseClass,
        'w-full text-left transition-colors hover:border-primary/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <span className={cn('block', labelClass)}>{label}</span>
      <span className={cn('block', valueClass)}>{value}</span>
      {hint === undefined ? null : <span className="block text-[11px] text-ink-soft">{hint}</span>}
    </button>
  )
}
