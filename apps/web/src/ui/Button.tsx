import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { Spinner } from './Feedback'

/**
 * Tombol bersama (guideline §10, CLAUDE.md §13).
 *
 * Satu area fungsional hanya boleh punya SATU tombol `primary` yang menonjol.
 * Radius 10px dan tinggi 36/40px mengikuti sistem, bukan nilai per halaman.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Menampilkan spinner kecil dan menonaktifkan tombol (guideline §13). */
  loading?: boolean
  /** Ikon di kiri label; diisi elemen Lucide saat P8. */
  icon?: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/60',
  secondary: 'bg-card text-ink border border-line hover:bg-soft disabled:text-ink-muted',
  ghost: 'bg-transparent text-ink-soft hover:bg-soft hover:text-ink disabled:text-ink-muted',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-white disabled:opacity-60',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1.5',
  md: 'h-10 px-4 text-[13px] gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {children}
    </button>
  )
}
