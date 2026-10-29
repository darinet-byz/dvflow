import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { ExportButton, type ExportConfig } from './ExportButton'
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

export type ExtraExport = {
  label?: string
  config: ExportConfig
  columns: readonly TableColumn[]
}

export function DataTable({
  columns,
  children,
  stickyHeader = true,
  className,
  sort,
  onSortChange,
  exportConfig,
  extraExports,
  rowNumbers = false,
  rowNumberStart = 1,
  maxRows = 20,
}: {
  exportConfig?: ExportConfig
  extraExports?: readonly ExtraExport[]
  columns: readonly TableColumn[]
  /** Baris tabel; dipisah supaya pemanggil yang memutuskan isinya. */
  children: ReactNode
  stickyHeader?: boolean
  className?: string
  sort?: TableSort
  onSortChange?: (key: string) => void
  /** Nomor baris di kolom paling kiri; lanjut antar halaman lewat `rowNumberStart`. */
  rowNumbers?: boolean
  rowNumberStart?: number
  /**
   * Jumlah baris yang terlihat sebelum tabel menggulir sendiri (A61).
   * `null` mematikan batas tinggi — dipakai tabel kecil yang sudah punya tinggi sendiri.
   */
  maxRows?: number | null
}) {
  const hasExports = exportConfig !== undefined || (extraExports !== undefined && extraExports.length > 0)
  let nextRowNumber = rowNumberStart
  const body = rowNumbers
    ? Children.map(children, (child) => {
        if (!isValidElement(child)) return child

        if (child.type === TableRow) {
          const row = child as ReactElement<{ children?: ReactNode }>
          const number = nextRowNumber
          nextRowNumber += 1
          return cloneElement(
            row,
            {},
            <>
              <TableCell align="right" className="w-10 tabular-nums text-[12px] text-ink-soft">
                {number}
              </TableCell>
              {row.props.children}
            </>,
          )
        }

        if (child.type === TableTotalRow) {
          const row = child as ReactElement<{ children?: ReactNode }>
          return cloneElement(row, {}, <><TableCell />{row.props.children}</>)
        }

        return child
      })
    : children
  return (
    <div className="min-w-0 max-w-full">
      {hasExports ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 p-3 empty:hidden">
          {exportConfig ? <ExportButton config={exportConfig} columns={columns.filter(c => c.key !== 'actions')} /> : null}
          {(extraExports ?? []).map((item, index) => (
            <ExportButton key={`${item.label ?? 'export'}-${index}`} config={item.config} columns={item.columns} label={item.label} />
          ))}
        </div>
      ) : null}
    <div
      className={cn('max-w-full overflow-auto rounded-md border border-line bg-card', className)}
      // ±2,3rem per baris + header; 70vh menjaga laptop 768p tetap nyaman.
      style={maxRows === null ? undefined : { maxHeight: `min(${maxRows * 2.3}rem, 70vh)` }}
    >
      <table className="w-full border-collapse text-[13px]">
        <thead className={cn('bg-primary-soft text-left', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {rowNumbers ? (
              <th
                scope="col"
                className="w-10 whitespace-nowrap border-b border-line px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-primary"
              >
                No
              </th>
            ) : null}
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
                    'whitespace-nowrap border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(column.sortKey as string)}
                      className={cn('inline-flex items-center gap-1 hover:text-primary-hover', active && 'text-primary-hover')}
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
        <tbody>{body}</tbody>
      </table>
    </div>
    </div>
  )
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line last:border-b-0 hover:bg-soft/60">{children}</tr>
}

/**
 * Baris ringkasan di dasar tabel.
 *
 * Tinggi baris dinaikkan lewat padding vertikal sel (14px vs 8px pada baris data)
 * tanpa mengubah ukuran font. Latar indigo sangat lembut dan garis atas lebih tegas
 * membedakannya dari data biasa, sementara teks tetap bold.
 */
export function TableTotalRow({ children }: { children: ReactNode }) {
  return (
    <tr className="border-t-2 border-primary/20 bg-primary-soft/40 font-semibold [&>td]:py-3.5">
      {children}
    </tr>
  )
}

export function TableCell({
  children,
  align = 'left',
  mono = false,
  className,
}: {
  children?: ReactNode
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
