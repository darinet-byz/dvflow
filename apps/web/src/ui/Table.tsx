import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Tabel data (guideline §19, CLAUDE.md §13/§14).
 *
 * Dua sifat yang dipaku: header tetap terlihat saat menggulir, dan tabel boleh
 * menggulir horizontal di layar sempit — BUKAN seluruh halaman. Kolom mengikuti
 * urutan yang ditentukan dokumen (PRD §60/§103); halaman tidak menyusun ulang
 * kolomnya sendiri.
 */
export type TableColumn = {
  /** Kunci kolom; tidak harus sama dengan nama kolom database. */
  key: string
  header: string
  align?: 'left' | 'right'
  /** Lebar minimum supaya kolom angka tidak berdesakan. */
  minWidth?: number
  /**
   * Nama kolom sort yang dikirim ke server, bila kolom ini boleh diurutkan.
   *
   * Hanya kolom yang masuk whitelist dokumen (01 §6) yang boleh mengisi ini —
   * tabel tidak pernah mengurutkan sendiri di klien.
   */
  sortKey?: string
}

export type TableSort = { key: string; direction: 'asc' | 'desc' }

export function DataTable({
  columns,
  children,
  stickyHeader = true,
  className,
  sort,
  onSortChange,
}: {
  columns: readonly TableColumn[]
  /** Baris tabel; dipisah supaya pemanggil yang memutuskan isinya. */
  children: ReactNode
  stickyHeader?: boolean
  className?: string
  sort?: TableSort
  onSortChange?: (key: string) => void
}) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-line bg-card', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead className={cn('bg-soft text-left', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortKey !== undefined && onSortChange !== undefined
              const active = sortable && sort?.key === column.sortKey

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  style={column.minWidth === undefined ? undefined : { minWidth: column.minWidth }}
                  className={cn(
                    'whitespace-nowrap border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(column.sortKey as string)}
                      className={cn('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
                    >
                      {column.header}
                      <span aria-hidden="true" className="text-[10px]">
                        {active ? (sort?.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line last:border-b-0 hover:bg-soft/60">{children}</tr>
}

export function TableCell({
  children,
  align = 'left',
  mono = false,
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  mono?: boolean
  className?: string
}) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle text-ink',
        align === 'right' && 'text-right',
        mono && 'font-mono text-[12px]',
        className,
      )}
    >
      {children}
    </td>
  )
}
