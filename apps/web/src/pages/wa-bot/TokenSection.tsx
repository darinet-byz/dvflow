import { useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { formatDateTime } from '../../lib/format'
import { useConfigLists } from '../../lib/useConfigLists'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import type { WaOverview } from './types'

export function TokenSection({ overview, reload, canSend }: { overview: WaOverview; reload: () => void; canSend: boolean }) {
  const toast = useToast()
  const { lists } = useConfigLists()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [productCode, setProductCode] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ sent: boolean; error: string | null; message: string; group_id: string } | null>(null)

  const mappedGroups = overview.groups.filter((group) => group.is_active && group.advertiser_code !== null && group.advertiser_code !== undefined)

  async function saveToken() {
    if (busy) return
    if (token.trim() === '') { setFailure('Token wajib diisi.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/wa-bot/settings', { method: 'PUT', body: { fonnte_token: token.trim() } })
      setToken('')
      reload()
      toast.show('Token Fonnte disimpan terenkripsi.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Token gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  function openTest() {
    setTestResult(null)
    setAdvertiserCode(mappedGroups[0]?.advertiser_code ?? '')
    setProductCode('')
    setTemplateId(overview.templates.find((template) => template.is_active)?.id ?? '')
    setTestOpen(true)
  }

  async function sendTest() {
    if (testBusy) return
    if (advertiserCode === '' || productCode === '' || templateId === '') {
      toast.show('Pilih pengiklan, produk, dan template terlebih dahulu.', 'danger')
      return
    }
    setTestBusy(true)
    try {
      const result = await authorizedRequest<{ sent: boolean; error: string | null; message: string; group_id: string }>('/api/wa-bot/test-send', {
        method: 'POST',
        body: { advertiser_code: advertiserCode, product_code: productCode, template_id: templateId },
      })
      setTestResult(result)
      toast.show(result.sent ? 'Pesan tes terkirim.' : `Gagal: ${result.error ?? 'tidak diketahui'}`, result.sent ? 'success' : 'danger')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Pesan tes gagal dikirim.', 'danger')
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Koneksi Fonnte</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            Token device disimpan terenkripsi di database dan tidak pernah dikirim ke browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={overview.settings.has_token ? 'success' : 'warning'}>
            {overview.settings.has_token ? 'Token terpasang' : 'Token belum diatur'}
          </Badge>
          {canSend ? <Button onClick={openTest} disabled={!overview.settings.has_token || mappedGroups.length === 0}>Kirim Tes</Button> : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto]">
        <TextInput
          id="wa-fonnte-token"
          label={overview.settings.has_token ? 'Ganti token Fonnte' : 'Token Fonnte'}
          type="password"
          value={token}
          autoComplete="new-password"
          placeholder="Tempel token device dari dashboard Fonnte"
          disabled={busy}
          onChange={setToken}
        />
        <Button variant="primary" loading={busy} onClick={() => void saveToken()}>Simpan Token</Button>
      </div>
      <p className="mt-2 text-[11px] text-ink-soft">
        {overview.settings.updated_at
          ? `Terakhir diubah ${formatDateTime(overview.settings.updated_at)}.`
          : 'Belum pernah diubah dari dashboard.'}
        {' '}Jika WhatsApp terputus, ganti token di sini tanpa deploy ulang.
      </p>
      {failure ? <p role="alert" className="mt-1 text-[12px] text-danger">{failure}</p> : null}

      <Modal
        open={testOpen}
        title="Kirim Pesan Tes"
        onClose={() => { if (!testBusy) setTestOpen(false) }}
        footer={
          <>
            <Button disabled={testBusy} onClick={() => setTestOpen(false)}>Tutup</Button>
            <Button variant="primary" loading={testBusy} onClick={() => void sendTest()}>Kirim</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-ink-soft">
            Pesan memakai angka leads/paid kemarin yang sebenarnya, lalu dikirim ke grup pengiklan terpilih.
          </p>
          <Select
            id="wa-test-advertiser"
            label="Pengiklan"
            value={advertiserCode}
            options={mappedGroups.map((group) => ({ value: group.advertiser_code ?? '', label: `${group.advertiser_code} — ${group.advertiser_name}` }))}
            placeholder="Pilih pengiklan"
            disabled={testBusy}
            onChange={setAdvertiserCode}
          />
          <Select
            id="wa-test-product"
            label="Produk"
            value={productCode}
            options={lists?.products ?? []}
            placeholder="Pilih produk"
            disabled={testBusy}
            onChange={setProductCode}
          />
          <Select
            id="wa-test-template"
            label="Template"
            value={templateId}
            options={overview.templates.map((template) => ({ value: template.id, label: template.name }))}
            placeholder="Pilih template"
            disabled={testBusy}
            onChange={setTemplateId}
          />
          {testResult ? (
            <div className="rounded-sm border border-line bg-soft p-2.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {testResult.sent ? 'Terkirim ke ' : 'Gagal — '}{testResult.group_id}
              </p>
              <pre className="whitespace-pre-wrap text-[12px] text-ink">{testResult.message}</pre>
              {testResult.error ? <p className="mt-1 text-[12px] text-danger">{testResult.error}</p> : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </Card>
  )
}
