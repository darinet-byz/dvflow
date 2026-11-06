import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { cn } from './cn'

/**
 * Input teks dengan saran, tetapi tetap menerima ketikan bebas.
 *
 * Dipakai untuk filter Batch: saran diambil dari 3 batch terbaru pada data order
 * (produk + pengiklan terpilih), bukan daftar tertutup. Nilainya tidak pernah
 * dipaksa menjadi salah satu saran.
 */
export type SuggestOption = {
  value: string
  label: string
  /** Keterangan tambahan di bawah label, mis. jumlah tiket. */
  hint?: string
}

export function SuggestInput({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  disabled = false,
  className,
  emptyMessage = 'Belum ada saran batch. Batch tetap bisa diketik manual.',
  maxResults = 5,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: readonly SuggestOption[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  emptyMessage?: string
  maxResults?: number
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle === ''
      ? options
      : options.filter((option) => `${option.value} ${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle))
    return matches.slice(0, maxResults)
  }, [options, query, maxResults])

  useEffect(() => {
    setActiveIndex(filtered.length === 0 ? -1 : 0)
  }, [filtered.length, query])

  function choose(option: SuggestOption): void {
    onChange(option.value)
    setQuery(option.value)
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const text = event.target.value
    setQuery(text)
    onChange(text)
    setOpen(true)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (filtered.length === 0 ? -1 : (current + 1) % filtered.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (filtered.length === 0 ? -1 : (current - 1 + filtered.length) % filtered.length))
      return
    }
    if (event.key === 'Enter' && open && activeIndex >= 0) {
      const option = filtered[activeIndex]
      if (option !== undefined) {
        event.preventDefault()
        choose(option)
      }
    }
  }

  const listId = `${id}-listbox`

  return (
    <div className={cn('relative min-w-0 max-w-full', className)}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-9 w-full min-w-0 max-w-full rounded-sm border border-line bg-card px-3 text-[13px] text-ink placeholder:text-ink-muted',
          'focus:border-primary focus:outline-none disabled:bg-soft disabled:text-ink-muted',
        )}
      />
      {open && !disabled ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-md border border-line bg-card p-1 shadow-app"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Saran batch terbaru</p>
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-ink-soft">{emptyMessage}</p>
          ) : (
            filtered.map((option, index) => (
              <button
                key={`${option.value}-${index}`}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={cn(
                  'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-[13px] text-ink',
                  index === activeIndex ? 'bg-primary-soft text-primary' : 'hover:bg-soft',
                )}
              >
                <span className="font-semibold">Batch {option.value}</span>
                <span className="text-[11px] text-ink-soft">{option.label}</span>
                {option.hint === undefined ? null : <span className="text-[10px] text-ink-muted">{option.hint}</span>}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
