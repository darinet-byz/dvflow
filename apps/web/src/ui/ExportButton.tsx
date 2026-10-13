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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  async function run() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const rows = await config.loadRows()
      downloadCsv(config.filename, rows, config.columns ?? columns)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export gagal. Silakan coba lagi.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 p-3">
    {error ? <p role="alert" className="break-words text-danger">{error}</p> : null}
    <Button disabled={config.disabled} loading={busy} onClick={() => void run()}>Export CSV</Button>
  </div>
}
