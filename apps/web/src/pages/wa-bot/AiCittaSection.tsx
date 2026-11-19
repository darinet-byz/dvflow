import { useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/format'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { AiDraft, AiRun, AiSettings, AiTestResult } from './types'

const DRAFT_COLUMNS: readonly TableColumn[] = [
  { key: 'created', header: 'Waktu', minWidth: 130 },
  { key: 'code', header: 'Kode', minWidth: 70 },
  { key: 'command', header: 'Perintah', minWidth: 90 },
  { key: 'product', header: 'Produk', minWidth: 100 },
  { key: 'status', header: 'Status', minWidth: 100 },
  { key: 'action', header: 'Aksi', minWidth: 90 },
]

const RUN_COLUMNS: readonly TableColumn[] = [
  { key: 'created', header: 'Waktu', minWidth: 130 },
  { key: 'command', header: 'Perintah', minWidth: 90 },
  { key: 'model', header: 'Model', minWidth: 120 },
  { key: 'tokens', header: 'Token', minWidth: 100 },
  { key: 'status', header: 'Status', minWidth: 90 },
]

const DRAFT_STATUS: Record<AiDraft['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  pending: { label: 'Menunggu', tone: 'warning' },
  confirmed: { label: 'Tersimpan', tone: 'success' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
  expired: { label: 'Kedaluwarsa', tone: 'neutral' },
  failed: { label: 'Gagal', tone: 'danger' },
}

/**
 * A82: pengaturan Citta + audit.
 *
 * API key hanya ditulis; backend tidak pernah mengembalikannya. Tombol
 * "Tes Koneksi" memanggil model dengan prompt kecil supaya key/model terbukti
 * sebelum dipakai menerima perintah grup.
 */
export function AiCittaSection() {
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(async () => {
    const [settings, drafts, runs] = await Promise.all([
      authorizedRequest<AiSettings>('/api/ai/settings'),
      authorizedRequest<{ drafts: AiDraft[] }>('/api/ai/drafts'),
      authorizedRequest<{ runs: AiRun[] }>('/api/ai/runs'),
    ])
    return { settings, drafts: drafts.drafts, runs: runs.runs }
  }, [])

  const [form, setForm] = useState({ enabled: false, baseUrl: '', model: '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<AiTestResult | null>(null)

  useEffect(() => {
    if (data === null) return
    setForm({
      enabled: data.settings.enabled,
      baseUrl: data.settings.base_url,
      model: data.settings.model,
      apiKey: '',
    })
  }, [data])

  async function save() {
    if (saving) return
    setSaving(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/ai/settings', {
        method: 'PUT',
        body: {
          enabled: form.enabled,
          base_url: form.baseUrl.trim(),
          model: form.model.trim(),
          ...(form.apiKey.trim() === '' ? {} : { api_key: form.apiKey.trim() }),
        },
      })
      setForm((current) => ({ ...current, apiKey: '' }))
      setTest(null)
      reload()
      toast.show('Pengaturan Citta disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Pengaturan gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    if (testing) return
    setTesting(true)
    setTest(null)
    setFailure(null)
    try {
      const result = await authorizedRequest<AiTestResult>('/api/ai/settings/test', {
        method: 'POST',
        body: {
          base_url: form.baseUrl.trim(),
          model: form.model.trim(),
          ...(form.apiKey.trim() === '' ? {} : { api_key: form.apiKey.trim() }),
        },
      })
      setTest(result)
      if (result.ok) toast.show('Koneksi LLM berhasil.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Tes koneksi gagal.')
    } finally {
      setTesting(false)
    }
  }

  async function cancelDraft(draft: AiDraft) {
    try {
      await authorizedRequest(`/api/ai/drafts/${draft.id}/cancel`, { method: 'POST' })
      reload()
      toast.show('Draft dibatalkan.', 'success')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Draft gagal dibatalkan.', 'danger')
    }
  }

  if (loading && data === null) return <SkeletonRows rows={5} />
  if (error !== null) return <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
  if (data === null) return null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Citta AI</h2>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              Hanya perintah <code>/add</code> dan <code>/delete</code> di grup yang diaktifkan.
              Pesan lain tidak memanggil AI.
            </p>
          </div>
          <Badge tone={data.settings.enabled ? 'success' : 'neutral'}>
            {data.settings.enabled ? 'Citta aktif' : 'Citta mati'}
          </Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            id="ai-base-url"
            label="Base URL LLM"
            value={form.baseUrl}
            placeholder="https://api.deepseek.com"
            disabled={saving}
            onChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))}
          />
          <TextInput
            id="ai-model"
            label="Model"
            value={form.model}
            placeholder="deepseek-flash"
            disabled={saving}
            onChange={(value) => setForm((current) => ({ ...current, model: value }))}
          />
        </div>

        <div className="mt-3">
          <TextInput
            id="ai-api-key"
            label="API Key"
            type="password"
            value={form.apiKey}
            placeholder={data.settings.has_key ? 'Tersimpan - isi untuk mengganti' : 'Belum diatur'}
            disabled={saving}
            onChange={(value) => setForm((current) => ({ ...current, apiKey: value }))}
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            Key disimpan terenkripsi dan tidak pernah dikirim kembali ke browser.
          </p>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={saving}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
          />
          Citta aktif menerima perintah dari grup
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={saving} onClick={() => void save()}>Simpan</Button>
          <Button loading={testing} onClick={() => void runTest()}>Tes Koneksi</Button>
          <span className="text-[11px] text-ink-soft">
            {data.settings.has_key ? 'API key tersimpan.' : 'API key belum diatur.'}
          </span>
        </div>

        {failure ? <p role="alert" className="mt-3 text-[12px] text-danger">{failure}</p> : null}
        {test ? (
          <div className={`mt-3 rounded-sm border p-3 text-[12px] ${test.ok ? 'border-success/30 bg-success-soft text-[#28a95b]' : 'border-danger/30 bg-danger-soft text-danger'}`}>
            {test.ok ? (
              <>
                <p className="font-semibold">Koneksi berhasil.</p>
                <p className="mt-0.5 text-ink-soft">Model: {test.model}{test.reply ? ` • Balasan: ${test.reply}` : ''}</p>
              </>
            ) : (
              <>
                <p className="font-semibold">
                  {test.error === 'NO_KEY' ? 'API key belum diatur.' : 'Koneksi gagal.'}
                </p>
                <p className="mt-0.5">
                  {test.error === 'TOKEN_UNREADABLE'
                    ? 'Key tersimpan tidak dapat dibaca. Simpan ulang.'
                    : `${test.error ?? 'UNKNOWN'}${test.detail ? `: ${test.detail}` : ''}`}
                </p>
              </>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Draft terakhir</h2>
        <p className="mb-3 text-[12px] text-ink-soft">
          Draft menunggu konfirmasi bisa dibatalkan dari sini. Konfirmasi tetap lewat balasan <strong>YA</strong> di grup.
        </p>
        <DataTable columns={DRAFT_COLUMNS} maxRows={null}>
          {data.drafts.map((draft) => {
            const status = DRAFT_STATUS[draft.status] ?? { label: draft.status, tone: 'neutral' as const }
            return (
              <TableRow key={draft.id}>
                <TableCell>{formatDateTime(draft.created_at)}</TableCell>
                <TableCell><span className="font-semibold">{draft.code}</span></TableCell>
                <TableCell>{draft.command === 'add' ? '/add' : '/delete'}</TableCell>
                <TableCell>{draft.product_code}</TableCell>
                <TableCell><Badge tone={status.tone}>{status.label}</Badge></TableCell>
                <TableCell>
                  {draft.status === 'pending' ? (
                    <Button size="sm" variant="danger" onClick={() => void cancelDraft(draft)}>Batalkan</Button>
                  ) : (
                    <span className="text-[11px] text-ink-soft">-</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </DataTable>
        {data.drafts.length === 0 ? <p className="py-3 text-[12px] text-ink-soft">Belum ada draft.</p> : null}
      </Card>

      <Card>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Audit panggilan AI</h2>
        <p className="mb-3 text-[12px] text-ink-soft">Hanya perintah /add dan /delete yang muncul di sini.</p>
        <DataTable columns={RUN_COLUMNS} maxRows={null}>
          {data.runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{formatDateTime(run.created_at)}</TableCell>
              <TableCell>{run.command === 'add' ? '/add' : '/delete'}</TableCell>
              <TableCell>{run.model ?? '-'}</TableCell>
              <TableCell>
                {run.input_tokens === null && run.output_tokens === null
                  ? '-'
                  : `${run.input_tokens ?? 0} / ${run.output_tokens ?? 0}`}
              </TableCell>
              <TableCell>
                <Badge tone={run.status === 'ok' ? 'success' : 'danger'}>
                  {run.status === 'ok' ? 'OK' : run.status === 'invalid_json' ? 'JSON rusak' : 'Gagal'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {data.runs.length === 0 ? <p className="py-3 text-[12px] text-ink-soft">Belum ada panggilan AI.</p> : null}
      </Card>
    </div>
  )
}
