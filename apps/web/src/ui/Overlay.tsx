import { useEffect, type ReactNode } from 'react'

/**
 * Modal & Drawer (CLAUDE.md §13).
 *
 * Pembagiannya bukan soal selera:
 *   * **Modal** untuk konfirmasi, edit singkat, dan detail kecil;
 *   * **Drawer** untuk detail Order/Presensi, supaya konteks tabel di belakangnya
 *     tidak hilang (PRD §142 "keep context").
 *
 * Form panjang tidak ditaruh di modal; itu akan dipindahkan ke halaman sendiri
 * saat P8/P9 mengerjakan CRUD konfigurasi.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEscapeToClose(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[calc(100dvh-32px)] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-card p-4 shadow-app"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-soft hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="text-[13px] text-ink">{children}</div>
        {footer === undefined ? null : <footer className="mt-4 flex flex-wrap justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEscapeToClose(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" role="presentation" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-card p-4 shadow-app"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-soft hover:text-ink"
          >
            ×
          </button>
        </header>
        {children}
      </aside>
    </div>
  )
}

/** Esc menutup overlay — aksesibilitas dasar (guideline §136). */
function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
}
