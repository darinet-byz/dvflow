import type { ReactNode } from 'react'

/**
 * Kepala halaman (guideline §9).
 *
 * Judul 22–24px / 700, deskripsi opsional, dan satu aksi utama di kanan.
 * Satu area fungsional hanya punya SATU aksi primary (CLAUDE.md §13).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {title === '' ? null : <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>}
        {description === undefined ? null : <p className="mt-0.5 text-ink-soft">{description}</p>}
      </div>
      {action}
    </header>
  )
}
