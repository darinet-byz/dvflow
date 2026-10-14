import { hasPermission } from '../lib/roles'
import { useSession } from '../lib/useSession'
import { refreshProfile, getSessionSnapshot } from '../lib/session'
import { useRef, useState } from 'react'
import { downloadCsv, type ExportColumn } from '../lib/export'
import { Button } from './Button'

export type ExportConfig = {
  filename: string
  loadRows: () => Promise<Record<string, unknown>[]> | Record<string, unknown>[]
  columns?: readonly ExportColumn[]
  disabled?: boolean
}

export function ExportButton({ config, columns }: { config: ExportConfig; columns: readonly ExportColumn[] }) {
  const { profile } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  async function run() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await refreshProfile()
      const current = getSessionSnapshot().profile
      if (!hasPermission(current, 'action.export_data')) throw new Error('Anda tidak memiliki izin ekspor.')
      const access = (p: typeof current) => JSON.stringify([p?.user_id, p?.role, p?.has_all_product_access, [...(p?.permissions ?? [])].sort(), [...(p?.allowed_product_codes ?? [])].sort()])
      if (access(current) !== access(profile)) throw new Error('Hak akses berubah. Muat ulang data sebelum mengekspor.')
      const rows = await config.loadRows()
      downloadCsv(config.filename, rows, config.columns ?? columns)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export gagal. Silakan coba lagi.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  if (!hasPermission(profile, 'action.export_data')) return null
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 p-3">
    {error ? <p role="alert" className="break-words text-danger">{error}</p> : null}
    <Button disabled={config.disabled} loading={busy} onClick={() => void run()}>Export CSV</Button>
  </div>
}
