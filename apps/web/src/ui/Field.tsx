import type { ChangeEvent, ReactNode } from 'react'
import { cn } from './cn'

/**
 * Field form (guideline §15–§16).
 *
 * Input dan select memakai radius 10px dan tinggi 36px yang sama, dengan label
 * di atasnya. Pesan galat ditampilkan di bawah field, bukan lewat `alert`.
 */

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-semibold text-ink-soft">
      {children}
    </label>
  )
}

export type TextInputProps = {
  id: string
  label?: string
  /** Label untuk pembaca layar saat label visualnya tidak ditampilkan (toolbar filter). */
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'search' | 'email'
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
  error?: string | null
  inputMode?: 'text' | 'numeric' | 'tel' | 'search'
  className?: string
}

export function TextInput({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  disabled = false,
  error = null,
  inputMode,
  className,
}: TextInputProps) {
  return (
    <div className="min-w-0 max-w-full">
      {label === undefined ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        inputMode={inputMode}
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${id}-error`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className={cn(
          'h-9 min-w-0 max-w-full w-full rounded-sm border bg-card px-3 text-[13px] text-ink placeholder:text-ink-muted',
          'focus:border-primary focus:outline-none disabled:bg-soft disabled:text-ink-muted',
          error === null ? 'border-line' : 'border-danger',
          className,
        )}
      />
      {error === null ? null : (
        <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Kotak pencarian.
 *
 * Tombol clear di dalam input adalah SATU-SATUNYA cara menghapus teks
 * pencarian — `Clear All` tidak menyentuhnya (PRD §37, 01 §7). Karena itu
 * tombolnya diberi label yang tegas, bukan sekadar "×" tanpa keterangan.
 */
export function SearchInput({
  id,
  value,
  onChange,
  placeholder = 'Cari Order ID, nama, atau nomor WA',
  disabled = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div className="relative min-w-0 max-w-full">
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Pencarian"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className="h-9 w-[260px] max-w-full rounded-sm border border-line bg-card pl-3 pr-8 text-[13px] text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none"
      />
      {value === '' ? null : (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Hapus teks pencarian"
          className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-soft hover:bg-soft hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  )
}

export type SelectOption = { value: string; label: string }

export type SelectProps = {
  id: string
  label?: string
  ariaLabel?: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function Select({
  id,
  label,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className,
}: SelectProps) {
  return (
    <div className="min-w-0 max-w-full">
      {label === undefined ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        className={cn(
          'h-9 min-w-0 max-w-full w-full rounded-sm border border-line bg-card px-2 text-[13px] text-ink',
          'focus:border-primary focus:outline-none disabled:bg-soft disabled:text-ink-muted',
          className,
        )}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
