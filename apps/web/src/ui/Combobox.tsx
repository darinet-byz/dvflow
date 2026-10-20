import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { FieldLabel } from './Field'
import { cn } from './cn'

/**
 * Combobox pencarian (A34).
 *
 * Dipakai untuk memilih produk/acara dari daftar yang panjang (mis. 200 produk aktif):
 * mengetik menyaring berdasarkan kode dan nama, tanpa membuka dropdown raksasa.
 * Nilai yang disimpan tetap `value`, sedangkan teks input adalah kata kunci pencarian.
 */
export type ComboboxOption = {
  value: string
  label: string
  /** Judul kelompok opsional, mis. "Acara terakhir" atau "Produk". */
  group?: string
}

export function Combobox({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Cari…',
  disabled = false,
  emptyMessage = 'Tidak ada hasil.',
  maxResults = 8,
}: {
  id: string
  label?: string
  value: string
  options: readonly ComboboxOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  emptyMessage?: string
  maxResults?: number
}) {
  const listId = `${id}-listbox`
  const selected = options.find((option) => option.value === value) ?? null
  const selectedLabel = selected?.label ?? ''
  const [query, setQuery] = useState(selectedLabel)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  // Saat nilai berubah dari luar (mis. edit), tampilkan labelnya. Saat pengguna
  // sedang mengetik (open + value kosong), jangan hapus ketikannya.
  useEffect(() => {
    if (value !== '') setQuery(selectedLabel)
    else if (!open) setQuery('')
  }, [value, selectedLabel, open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle === ''
      ? options
      : options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle))
    return matches.slice(0, maxResults)
  }, [options, query, maxResults])

  useEffect(() => {
    setActiveIndex(filtered.length === 0 ? -1 : 0)
  }, [filtered.length, query])

  function select(option: ComboboxOption): void {
    onChange(option.value)
    setQuery(option.label)
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const text = event.target.value
    setQuery(text)
    setOpen(true)
    setActiveIndex(0)
    // Mengetik berarti pengguna sedang mencari pilihan lain; nilai lama tidak boleh
    // tertinggal dan terpakai saat menyimpan.
    if (value !== '') onChange('')
  }

  function handleFocus(): void {
    setOpen(true)
    // Kosongkan tampilan label supaya pengguna bisa langsung mengetik kata kunci.
    if (value !== '') setQuery('')
  }

  function handleBlur(): void {
    // Jeda kecil memberi waktu klik opsi (mouse/touch) diproses.
    window.setTimeout(() => {
      setOpen(false)
      setQuery(value === '' ? '' : selectedLabel)
    }, 100)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false)
      setQuery(value === '' ? '' : selectedLabel)
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
    if (event.key === 'Enter' && open) {
      const option = filtered[activeIndex]
      if (option !== undefined) {
        event.preventDefault()
        select(option)
      }
    }
  }

  return (
    <div className="relative min-w-0 max-w-full">
      {label === undefined ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-9 w-full min-w-0 max-w-full rounded-sm border border-line bg-card px-3 text-[13px] text-ink placeholder:text-ink-muted',
          'focus:border-primary focus:outline-none disabled:bg-soft disabled:text-ink-muted',
        )}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-card p-1 shadow-app"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-ink-soft">{emptyMessage}</p>
          ) : (
            filtered.map((option, index) => {
              const previousGroup = index === 0 ? undefined : filtered[index - 1]?.group
              return (
                <div key={option.value}>
                  {option.group !== undefined && option.group !== previousGroup ? (
                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{option.group}</p>
                  ) : null}
                  <button
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(option)}
                    className={cn(
                      'flex w-full items-center rounded-sm px-2 py-2 text-left text-[13px] text-ink',
                      index === activeIndex ? 'bg-primary-soft text-primary' : 'hover:bg-soft',
                    )}
                  >
                    {option.label}
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
