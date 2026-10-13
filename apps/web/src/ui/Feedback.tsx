import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Keadaan umpan balik (guideline §11–§14, CLAUDE.md §13).
 *
 * Aturannya: skeleton untuk memuat DATA halaman; spinner kecil hanya untuk
 * aksi (Simpan, Generate, Check-in). Empty state dan error state harus selalu
 * ada, bukan hanya saat sempat dipikirkan.
 */

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Memuat"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: size, height: size }}
    />
  )
}

/** Skeleton satu blok; tinggi dapat diatur agar menyerupai isi sebenarnya. */
export function Skeleton({ height = 16, className }: { height?: number; className?: string }) {
  return <div className={cn('animate-pulse rounded-xs bg-soft', className)} style={{ height }} aria-hidden="true" />
}

/** Skeleton daftar baris untuk tabel/kartu. */
export function SkeletonRows({ rows = 6, height = 16 }: { rows?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-card px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {description === undefined ? null : <p className="max-w-md text-ink-soft">{description}</p>}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Error state yang dapat dibaca manusia.
 *
 * Pesannya berasal dari backend (`{ ok:false, error:{ message } }`) yang sudah
 * berbahasa Indonesia; tidak ada stack trace atau detail database di layar
 * (03 §1).
 */
export function ErrorState({
  title = 'Terjadi kesalahan',
  message,
  action,
}: {
  title?: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-danger-soft px-6 py-8 text-center">
      <p className="text-[14px] font-semibold text-danger">{title}</p>
      <p className="max-w-md text-ink-soft">{message}</p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  )
}
