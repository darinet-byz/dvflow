import { useEffect, useRef, useState } from 'react'

/**
 * Scanner Stick (USB / Bluetooth HID) = "keyboard wedge": alatnya mengetik isi QR lalu Enter.
 *
 * Browser TIDAK bisa tahu apakah keyboard/scanner tersambung (WebHID memblokir perangkat
 * keyboard). Jadi status "Terhubung" hanya diberikan setelah halaman benar-benar menerima
 * ketikan secepat scanner — bukti satu-satunya bahwa alat mengirim data ke halaman ini.
 */

/** Jeda antar karakter yang masih dianggap satu tembakan scan. */
export const SCAN_BURST_RESET_MS = 1000
/** Rata-rata jeda maksimum agar dianggap alat scanner, bukan ketikan tangan. */
export const SCANNER_MAX_AVG_GAP_MS = 60
/** Isi minimum agar dianggap tembakan scan. */
export const SCANNER_MIN_LENGTH = 4

export type ScannerStickState = {
  /** Sudah pernah menerima tembakan scan dari alat di sesi halaman ini. */
  connected: boolean
  lastScanAt: number | null
  /** Ketikan scanner hanya sampai bila jendela/tab ini sedang fokus. */
  focused: boolean
}

export function useScannerStick(enabled: boolean, onPayload: (payload: string) => void): ScannerStickState {
  const [connected, setConnected] = useState(false)
  const [lastScanAt, setLastScanAt] = useState<number | null>(null)
  const [focused, setFocused] = useState(() => (typeof document === 'undefined' ? true : document.hasFocus()))
  const bufferRef = useRef('')
  const firstKeyAtRef = useRef(0)
  const lastKeyAtRef = useRef(0)
  const onPayloadRef = useRef(onPayload)
  onPayloadRef.current = onPayload

  useEffect(() => {
    if (!enabled) return

    // Dialog A61 bisa menonaktifkan hook di tengah tembakan scan; jangan biarkan
    // sisa karakter lama menempel ke scan berikutnya saat hook aktif kembali.
    bufferRef.current = ''

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const now = Date.now()
      if (now - lastKeyAtRef.current > SCAN_BURST_RESET_MS) {
        bufferRef.current = ''
        firstKeyAtRef.current = now
      }
      lastKeyAtRef.current = now

      if (e.key === 'Enter') {
        const payload = bufferRef.current.trim()
        const chars = bufferRef.current.length
        bufferRef.current = ''
        if (payload.length === 0) return
        e.preventDefault()
        const avgGap = chars > 1 ? (now - firstKeyAtRef.current) / chars : Number.POSITIVE_INFINITY
        if (payload.length >= SCANNER_MIN_LENGTH && avgGap <= SCANNER_MAX_AVG_GAP_MS) {
          setConnected(true)
          setLastScanAt(now)
        }
        onPayloadRef.current(payload)
      } else if (e.key.length === 1) {
        if (bufferRef.current === '') firstKeyAtRef.current = now
        bufferRef.current += e.key
      }
    }
    const handleFocus = () => setFocused(true)
    const handleBlur = () => setFocused(false)

    setFocused(document.hasFocus())
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled])

  return { connected, lastScanAt, focused }
}
