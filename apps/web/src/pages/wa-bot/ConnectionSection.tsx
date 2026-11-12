import { useCallback, useEffect, useMemo, useState } from 'react'
import { WA_EVENT_TYPES } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { formatDateTime } from '../../lib/format'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import type { WaDeviceCheck, WaOverview, WaPreview } from './types'

const MENTION_SCOPE_OPTIONS = [
  { value: 'all', label: 'Semua pengiklan yang beraktivitas' },
  { value: 'missing', label: 'Hanya yang belum lapor' },
]

export function ConnectionSection({ overview, reload, canSend }: { overview: WaOverview; reload: () => void; canSend: boolean }) {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [check, setCheck] = useState<WaDeviceCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkFailure, setCheckFailure] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [productCode, setProductCode] = useState('')
  const [eventType, setEventType] = useState('Seminar Offline')
  const [mentionScope, setMentionScope] = useState<'all' | 'missing'>('all')
  const [templateId, setTemplateId] = useState('')
  const [preview, setPreview] = useState<WaPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)

  const readyProducts = useMemo(
    () => overview.products.filter((product) => product.group !== null && product.group.is_active),
    [overview.products],
  )
  const runCheck = useCallback(async () => {
    setChecking(true)
    setCheckFailure(null)
    try {
      setCheck(await authorizedRequest<WaDeviceCheck>('/api/wa-bot/settings/verify', { method: 'POST' }))
    } catch (error) {
      setCheck(null)
      setCheckFailure(error instanceof Error ? error.message : 'Status koneksi tidak dapat diperiksa.')
    } finally {
      setChecking(false)
    }
  }, [])

  // Status device ikut diperiksa ulang setiap token berubah (termasuk setelah
  // "Simpan Token"): menyimpan token bukan bukti device terhubung.
  useEffect(() => {
    if (!overview.settings.has_token) {
      setCheck(null)
      setCheckFailure(null)
      return
    }
    void runCheck()
  }, [overview.settings.has_token, overview.settings.updated_at, runCheck])

  const connection = connectionState(overview.settings.has_token, checking, check, checkFailure)
  const device = check?.device ?? null
  const statusDetail = (() => {
    if (!overview.settings.has_token) {
      return <p className="text-ink-soft">Tempel token device Fonnte lalu klik <strong>Simpan Token</strong>. Status device akan diperiksa otomatis setelah token tersimpan.</p>
    }
    if (checking && check === null) {
      return <p className="text-ink-soft">Memeriksa status device ke Fonnte…</p>
    }
    if (checkFailure !== null) {
      return <p className="text-warning">Status tidak dapat diperiksa: {checkFailure}</p>
    }
    if (check === null) {
      return <p className="text-ink-soft">Token tersimpan, status device belum diperiksa.</p>
    }
    if (check.connected) {
      return (
        <div>
          <p className="font-semibold text-[#28a95b]">
            Terhubung ke WhatsApp {device?.number ?? '(nomor tidak dilaporkan)'}
          </p>
          <p className="mt-0.5 text-ink-soft">
            {[
              device?.name,
              device?.package === null || device?.package === undefined ? null : `Paket ${device.package}`,
              device?.quota === null || device?.quota === undefined ? null : `Kuota ${device.quota}`,
              device?.expired === null || device?.expired === undefined ? null : `Aktif s/d ${device.expired}`,
            ].filter((part) => part !== null && part !== undefined && part !== '').join(' · ')}
          </p>
        </div>
      )
    }
    if (check.error === 'NETWORK') {
      return (
        <p className="text-warning">
          Fonnte tidak dapat dihubungi dari server{check.detail === null ? ' (jaringan/timeout)' : `: ${check.detail}`}.
          {' '}Token tetap tersimpan; klik <strong>Cek Ulang</strong> beberapa saat lagi.
        </p>
      )
    }
    if (check.error === null) {
      return <p className="text-warning">Token diterima, tetapi device sedang terputus ({check.status ?? 'disconnect'}). Sambungkan ulang WhatsApp di ponsel Fonnte, lalu klik <strong>Cek Ulang</strong>.</p>
    }
    return <p className="text-danger">Fonnte menolak token: {describeFonnteError(check.error)}. Ambil token baru di dashboard Fonnte, lalu simpan ulang di sini.</p>
  })()

  async function saveToken() {
    if (busy) return
    if (token.trim() === '') { setFailure('Token wajib diisi.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/wa-bot/settings', { method: 'PUT', body: { fonnte_token: token.trim() } })
      setToken('')
      reload()
      toast.show('Token Fonnte disimpan. Memeriksa koneksi device…', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Token gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  function openTest() {
    if (!overview.settings.has_token) {
      toast.show('Simpan token Fonnte dulu sebelum mengirim tes.', 'danger')
      return
    }
    if (readyProducts.length === 0) {
      toast.show('Belum ada produk dengan grup WhatsApp aktif. Atur di tab Produk & Grup.', 'danger')
      return
    }
    const firstProduct = readyProducts[0] ?? null
    setProductCode(firstProduct?.code ?? '')
    setEventType('Seminar Offline')
    setMentionScope('all')
    setTemplateId(overview.templates.find((template) => template.is_active)?.id ?? '')
    setPreview(null)
    setTestOpen(true)
  }

  function changeProduct(value: string) {
    setProductCode(value)
    setPreview(null)
  }

  function body() {
    return {
      product_code: productCode,
      template_id: templateId,
      event_type: eventType,
      mention_scope: mentionScope,
    }
  }

  async function loadPreview() {
    if (previewBusy) return
    if (productCode === '' || templateId === '') {
      toast.show('Pilih produk dan template terlebih dahulu.', 'danger')
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
    if (productCode === '' || templateId === '') {
      toast.show('Pilih produk dan template terlebih dahulu.', 'danger')
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={connection.tone}>{connection.label}</Badge>
          {overview.settings.has_token ? (
            <Button size="sm" variant="ghost" loading={checking} onClick={() => void runCheck()}>Cek Ulang</Button>
          ) : null}
          {canSend ? <Button onClick={openTest}>Kirim Tes</Button> : null}
        </div>
      </div>

      <div className="mt-3 rounded-sm border border-line bg-soft px-2.5 py-2 text-[12px]">
        {statusDetail}
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
      {!canSend ? (
        <p className="mt-1 text-[11px] text-ink-soft">
          Akun ini tidak memegang izin <strong>Kirim Pesan WA</strong>, jadi tombol Kirim Tes tidak ditampilkan.
        </p>
      ) : null}
      {canSend && (!overview.settings.has_token || readyProducts.length === 0) ? (
        <p className="mt-1 text-[11px] text-warning">
          {!overview.settings.has_token
            ? 'Kirim Tes aktif setelah token Fonnte disimpan.'
            : 'Kirim Tes memerlukan minimal satu produk dengan grup WhatsApp aktif (tab Produk & Grup).'}
        </p>
      ) : null}

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
            id="wa-test-event-type"
            label="Jenis Acara"
            value={eventType}
            options={WA_EVENT_TYPES.map((type) => ({ value: type, label: type }))}
            disabled={previewBusy || sendBusy}
            onChange={(value) => { setEventType(value); setPreview(null) }}
          />
          <Select
            id="wa-test-mention-scope"
            label="Siapa yang disebut"
            value={mentionScope}
            options={MENTION_SCOPE_OPTIONS}
            disabled={previewBusy || sendBusy}
            onChange={(value) => { setMentionScope(value === 'missing' ? 'missing' : 'all'); setPreview(null) }}
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
          {overview.templates.length === 0 ? (
            <p className="text-[12px] text-warning">Belum ada template pesan. Tambahkan dulu di tab Template.</p>
          ) : null}
          {preview !== null ? (
            <div className="rounded-sm border border-line bg-soft p-2.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Tujuan {preview.group_id} · {preview.event_type}
              </p>
              <p className="mb-1 text-[11px] text-ink-soft">
                Disebut: {preview.advertisers.map((row) => row.name).join(', ')}
              </p>
              <pre className="whitespace-pre-wrap text-[12px] text-ink">{preview.message}</pre>
            </div>
          ) : null}
        </div>
      </Modal>
    </Card>
  )
}

/**
 * Label status koneksi.
 *
 * "Token tersimpan" dan "device terhubung" sengaja dibedakan: token bisa valid
 * sementara WhatsApp di ponsel sudah logout, dan saat itu pengingat tidak akan
 * pernah sampai meski semuanya tampak hijau.
 */
function connectionState(
  hasToken: boolean,
  checking: boolean,
  check: WaDeviceCheck | null,
  failure: string | null,
): { tone: BadgeTone; label: string } {
  if (!hasToken) return { tone: 'warning', label: 'Token belum diatur' }
  if (checking && check === null) return { tone: 'neutral', label: 'Memeriksa…' }
  if (failure !== null) return { tone: 'warning', label: 'Status tidak diketahui' }
  if (check === null) return { tone: 'neutral', label: 'Token terpasang' }
  if (check.connected) return { tone: 'success', label: 'Terhubung' }
  if (check.error === null) return { tone: 'warning', label: 'Device terputus' }
  if (check.error === 'NETWORK') return { tone: 'warning', label: 'Fonnte tak terjangkau' }
  return { tone: 'danger', label: 'Token ditolak' }
}

function describeFonnteError(error: string): string {
  if (error === 'TOKEN_UNREADABLE') return 'token tersimpan tidak dapat dibaca (kunci enkripsi berubah)'
  return error
}
