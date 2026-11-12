import { useMemo, useState } from 'react'
import { WA_EVENT_TYPES } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { formatDateTime } from '../../lib/format'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import type { WaOverview, WaPreview } from './types'

export function ConnectionSection({ overview, reload, canSend }: { overview: WaOverview; reload: () => void; canSend: boolean }) {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [productCode, setProductCode] = useState('')
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [eventType, setEventType] = useState('Seminar Offline')
  const [templateId, setTemplateId] = useState('')
  const [preview, setPreview] = useState<WaPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)

  const readyProducts = useMemo(
    () => overview.products.filter((product) => product.group !== null && product.group.is_active),
    [overview.products],
  )
  const selectedProduct = readyProducts.find((product) => product.code === productCode) ?? null
  const advertiserOptions = useMemo(
    () => (selectedProduct?.advertisers ?? [])
      .filter((advertiser) => advertiser.active && advertiser.wa_phone !== null)
      .map((advertiser) => ({
        value: advertiser.code,
        label: `${advertiser.code} — ${advertiser.name} (${advertiser.wa_phone})`,
      })),
    [selectedProduct],
  )

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
    const firstProduct = readyProducts[0] ?? null
    const firstAdvertiser = firstProduct?.advertisers.find((advertiser) => advertiser.active && advertiser.wa_phone !== null) ?? null
    setProductCode(firstProduct?.code ?? '')
    setAdvertiserCode(firstAdvertiser?.code ?? '')
    setEventType('Seminar Offline')
    setTemplateId(overview.templates.find((template) => template.is_active)?.id ?? '')
    setPreview(null)
    setTestOpen(true)
  }

  function changeProduct(value: string) {
    setProductCode(value)
    const product = readyProducts.find((row) => row.code === value)
    const firstAdvertiser = product?.advertisers.find((advertiser) => advertiser.active && advertiser.wa_phone !== null) ?? null
    setAdvertiserCode(firstAdvertiser?.code ?? '')
    setPreview(null)
  }

  function body() {
    return {
      product_code: productCode,
      advertiser_code: advertiserCode,
      template_id: templateId,
      event_type: eventType,
    }
  }

  async function loadPreview() {
    if (previewBusy) return
    if (productCode === '' || advertiserCode === '' || templateId === '') {
      toast.show('Pilih produk, pengiklan, dan template terlebih dahulu.', 'danger')
      return
    }
    setPreviewBusy(true)
    try {
      const result = await authorizedRequest<WaPreview>('/api/wa-bot/test-preview', { method: 'POST', body: body() })
      setPreview(result)
    } catch (error) {
      setPreview(null)
      toast.show(error instanceof Error ? error.message : 'Preview gagal dibuat.', 'danger')
    } finally {
      setPreviewBusy(false)
    }
  }

  async function sendTest() {
    if (sendBusy) return
    if (productCode === '' || advertiserCode === '' || templateId === '') {
      toast.show('Pilih produk, pengiklan, dan template terlebih dahulu.', 'danger')
      return
    }
    setSendBusy(true)
    try {
      const result = await authorizedRequest<{ sent: boolean; error: string | null; message: string; group_id: string }>('/api/wa-bot/test-send', {
        method: 'POST',
        body: body(),
      })
      toast.show(result.sent ? 'Pesan tes terkirim.' : `Gagal: ${result.error ?? 'tidak diketahui'}`, result.sent ? 'success' : 'danger')
      reload()
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Pesan tes gagal dikirim.', 'danger')
    } finally {
      setSendBusy(false)
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
          {canSend ? (
            <Button onClick={openTest} disabled={!overview.settings.has_token || readyProducts.length === 0}>
              Kirim Tes
            </Button>
          ) : null}
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
        onClose={() => { if (!previewBusy && !sendBusy) setTestOpen(false) }}
        footer={
          <>
            <Button disabled={previewBusy || sendBusy} onClick={() => setTestOpen(false)}>Tutup</Button>
            <Button loading={previewBusy} onClick={() => void loadPreview()}>Preview</Button>
            <Button variant="primary" loading={sendBusy} onClick={() => void sendTest()}>Kirim ke Grup</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-ink-soft">
            Pesan memakai data kemarin yang sebenarnya. Preview tidak mengirim apa pun.
          </p>
          <Select
            id="wa-test-product"
            label="Produk"
            value={productCode}
            options={readyProducts.map((product) => ({
              value: product.code,
              label: `${product.code} — ${product.name}`,
            }))}
            placeholder="Pilih produk"
            disabled={previewBusy || sendBusy}
            onChange={changeProduct}
          />
          <Select
            id="wa-test-advertiser"
            label="Pengiklan"
            value={advertiserCode}
            options={advertiserOptions}
            placeholder={selectedProduct === null ? 'Pilih produk dulu' : 'Pilih pengiklan'}
            disabled={previewBusy || sendBusy || selectedProduct === null}
            onChange={(value) => { setAdvertiserCode(value); setPreview(null) }}
          />
          <Select
            id="wa-test-event-type"
            label="Jenis Acara"
            value={eventType}
            options={WA_EVENT_TYPES.map((type) => ({ value: type, label: type }))}
            disabled={previewBusy || sendBusy}
            onChange={(value) => { setEventType(value); setPreview(null) }}
          />
          <Select
            id="wa-test-template"
            label="Template"
            value={templateId}
            options={overview.templates.map((template) => ({ value: template.id, label: template.name }))}
            placeholder="Pilih template"
            disabled={previewBusy || sendBusy}
            onChange={(value) => { setTemplateId(value); setPreview(null) }}
          />
          {selectedProduct !== null && advertiserOptions.length === 0 ? (
            <p className="text-[12px] text-warning">Produk ini belum punya pengiklan dengan nomor WA.</p>
          ) : null}
          {preview !== null ? (
            <div className="rounded-sm border border-line bg-soft p-2.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Tujuan {preview.group_id} · {preview.event_type}
              </p>
              <pre className="whitespace-pre-wrap text-[12px] text-ink">{preview.message}</pre>
            </div>
          ) : null}
        </div>
      </Modal>
    </Card>
  )
}
