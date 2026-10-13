import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cn } from './cn'

/**
 * Toast (guideline §20).
 *
 * Ini BUKAN notification center — hanya umpan balik sesaat untuk aksi yang baru
 * dilakukan (tersimpan, gagal, check-in berhasil). Notification center sengaja
 * tidak ada di MVP (01 §17).
 */
export type ToastTone = 'success' | 'danger' | 'info'

export type Toast = {
  id: number
  tone: ToastTone
  message: string
}

type ToastContextValue = {
  toasts: Toast[]
  show: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VISIBLE_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, tone, message }])
      // Toast hilang sendiri; tidak ada antrean yang menumpuk di layar.
      setTimeout(() => dismiss(id), VISIBLE_MS)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-sm border px-3.5 py-2 text-[12px] font-semibold shadow-app',
              toast.tone === 'success' && 'border-success/20 bg-success-soft text-[#28a95b]',
              toast.tone === 'danger' && 'border-danger/20 bg-danger-soft text-danger',
              toast.tone === 'info' && 'border-line bg-card text-ink',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (value === null) throw new Error('useToast dipakai di luar ToastProvider')
  return value
}
