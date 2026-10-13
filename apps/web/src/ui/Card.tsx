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
  return <section className={cn('rounded-lg border border-line bg-card shadow-card', paddingClass, className)}>{children}</section>
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div>
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
    <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
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
}: {
  label: string
  value: string
  hint?: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        highlight ? 'border-primary/20 bg-primary-soft' : 'border-line bg-card',
      )}
    >
      <p className={cn('text-[11px] font-semibold uppercase tracking-wide', highlight ? 'text-primary' : 'text-ink-soft')}>
        {label}
      </p>
      <p className="mt-1 text-[20px] font-bold text-ink">{value}</p>
      {hint === undefined ? null : <p className="text-[11px] text-ink-soft">{hint}</p>}
    </div>
  )
}
