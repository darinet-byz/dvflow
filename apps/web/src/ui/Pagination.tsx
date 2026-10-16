import { ALLOWED_PAGE_SIZES, MAX_LIST_ROWS } from '@dvflow/shared'
import { cn } from './cn'
import { pageRange, totalPages, type PageSize } from '../lib/filters'

/**
 * Pagination (PRD §33, CLAUDE.md §14).
 *
 * Ukuran halaman hanya 50 atau 100 — nilai lain tidak ditawarkan, dan server
 * juga menolaknya (`INVALID_PAGE_SIZE`). Rentang baris selalu ditampilkan supaya
 * operator tahu ia melihat bagian mana dari berapa banyak data.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: PageSize
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: PageSize) => void
}) {
  // Maksimal MAX_LIST_ROWS baris (10 halaman x 50) agar halaman dalam tidak membebani database.
  const pageLimit = Math.max(1, Math.floor(MAX_LIST_ROWS / pageSize))
  const pages = Math.min(totalPages(total, pageSize), pageLimit)
  const capped = total > MAX_LIST_ROWS
  const range = pageRange(page, pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-[12px] text-ink-soft">
      <p>
        Menampilkan <strong className="text-ink">{range.from}</strong>–
        <strong className="text-ink">{range.to}</strong> dari <strong className="text-ink">{total}</strong> baris
        {capped ? (
          <span className="mt-0.5 block text-[11px] text-[#c78a21]" role="note">
            Hanya {MAX_LIST_ROWS} data pertama yang bisa dibuka. Persempit filter (tanggal/produk) untuk melihat sisanya.
          </span>
        ) : null}
      </p>

      <div className="flex max-w-full flex-wrap items-center gap-3">
        <label className="flex max-w-full flex-wrap items-center gap-1.5">
          Baris
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
            className="h-8 rounded-sm border border-line bg-card px-1.5 text-[12px] text-ink"
          >
            {ALLOWED_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <PageButton label="Sebelumnya" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <PageButton label="Berikutnya" disabled={page >= pages} onClick={() => onPageChange(page + 1)} />
        </div>
      </div>
    </div>
  )
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-8 rounded-sm border border-line bg-card px-2.5 font-semibold text-ink',
        'disabled:cursor-not-allowed disabled:text-ink-muted',
      )}
    >
      {label}
    </button>
  )
}
