import { useSession } from '../../lib/useSession'
import { hasPermission, hasAllProductAccess } from '../../lib/roles'
import { useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type WebinarRow = {
  key?: string
  product_raw: string
  mode?: 'scope' | 'exact'
  product_code?: string
  batch?: string
  session_code?: string
  destination: string
  updated_at: string
}

type ConfigOption = { code: string; name: string; active: boolean }

type WebinarListResponse = {
  rows: WebinarRow[]
  products?: ConfigOption[]
  sessions?: ConfigOption[]
}

const columns = [
  { key: 'scope', header: 'Cakupan / Nama Produk' },
  { key: 'destination', header: 'Link Zoom' },
  { key: 'actions', header: 'Aksi' },
]

function describeWebinarScope(
  row: WebinarRow,
  products: ConfigOption[],
  sessions: ConfigOption[],
): { label: string; badgeText: string; badgeTone: 'webinar' | 'success' | 'neutral' } {
  const isScope = row.mode === 'scope' || row.product_raw.startsWith('__scope__::')
  if (!isScope) {
    return {
      label: row.product_raw,
      badgeText: 'Produk Persis',
      badgeTone: 'neutral',
    }
  }

  const rawParts = row.product_raw.startsWith('__scope__::')
    ? row.product_raw.slice('__scope__::'.length).split(':')
    : [row.product_code ?? '*', row.batch ?? '*', row.session_code ?? '*']
  const p = row.product_code || rawParts[0] || '*'
  const b = row.batch || rawParts[1] || '*'
  const s = row.session_code || rawParts[2] || '*'

  if (p === '*' && b === '*' && s === '*') {
    return {
      label: 'Semua Produk • Semua Batch • Semua Sesi',
      badgeText: '1 Link Semua (Global)',
      badgeTone: 'success',
    }
  }

  const productObj = products.find((item) => item.code.toUpperCase() === p.toUpperCase())
  const sessionObj = sessions.find((item) => item.code.toUpperCase() === s.toUpperCase())

  const pText = p === '*' ? 'Semua Produk' : `Produk ${p}${productObj ? ` (${productObj.name})` : ''}`
  const bText = b === '*' ? 'Semua Batch' : `Batch ${b}`
  const sText = s === '*' ? 'Semua Sesi' : `Sesi ${s}${sessionObj ? ` (${sessionObj.name})` : ''}`

  return {
    label: `${pText} • ${bText} • ${sText}`,
    badgeText: 'Per Cakupan',
    badgeTone: 'webinar',
  }
}

export function ZoomPage() {
  const { profile } = useSession()
  const allProducts = hasAllProductAccess(profile)
  const [productCode, setProductCode] = useState(allProducts ? '*' : '')
  const [batch, setBatch] = useState('')
  const [sessionCode, setSessionCode] = useState('*')
  const [productRaw, setProductRaw] = useState('')
  const [destination, setDestination] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState<WebinarRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const toast = useToast()

  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<WebinarListResponse>('/api/webinar-destinations'),
    [],
  )

  const products = data?.products ?? []
  const sessions = data?.sessions ?? []
  const template = `${window.location.origin}/access/{{order_id}}`

  const rows = (data?.rows ?? []).filter((row) => {
    const desc = describeWebinarScope(row, products, sessions)
    return `${row.product_raw} ${desc.label} ${row.destination}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  })

  function resetForm() {
    setProductCode(allProducts ? '*' : '')
    setBatch('')
    setSessionCode('*')
    setProductRaw('')
    setDestination('')
    setEditing(false)
    setFailure(null)
  }

  async function save() {
    if (busy) return
    if (!allProducts && !productCode && !productRaw.trim()) { setFailure('Pilih produk yang ditugaskan.'); return }
    setBusy(true)
    setFailure(null)
    try {
      const trimmedRaw = productRaw.trim()
      const body =
        trimmedRaw !== ''
          ? { product_raw: trimmedRaw, destination }
          : {
              product_code: productCode || '*',
              batch: batch.trim() || '*',
              session_code: sessionCode || '*',
              destination,
            }
      await authorizedRequest('/api/webinar-destinations', { method: 'POST', body })
      resetForm()
      reload()
      toast.show('Link Zoom disimpan. Salin link peserta untuk template followup.', 'success')
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Link gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(row: WebinarRow) {
    if (busy) return
    setBusy(true)
    try {
      const targetKey = row.key ?? row.product_raw
      await authorizedRequest(`/api/webinar-destinations?key=${encodeURIComponent(targetKey)}`, {
        method: 'DELETE',
      })
      setDeleting(null)
      reload()
      toast.show('Konfigurasi link Zoom dihapus.', 'success')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal menghapus link Zoom.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(template)
      toast.show('Link peserta disalin.', 'success')
    } catch {
      toast.show('Salin link secara manual dari kotak link peserta.', 'danger')
    }
  }

  function startEdit(row: WebinarRow) {
    const isScope = row.mode === 'scope' || row.product_raw.startsWith('__scope__::')
    if (isScope) {
      const rawParts = row.product_raw.startsWith('__scope__::')
        ? row.product_raw.slice('__scope__::'.length).split(':')
        : [row.product_code ?? '*', row.batch ?? '*', row.session_code ?? '*']
      const p = row.product_code || rawParts[0] || '*'
      const b = row.batch || rawParts[1] || '*'
      const s = row.session_code || rawParts[2] || '*'
      setProductCode(p)
      setBatch(b === '*' ? '' : b)
      setSessionCode(s)
      setProductRaw('')
    } else {
      setProductCode(allProducts ? '*' : '')
      setBatch('')
      setSessionCode('*')
      setProductRaw(row.product_raw)
    }
    setDestination(row.destination)
    setEditing(true)
    setFailure(null)
    document.getElementById('zoom-destination')?.focus()
  }

  const productOptions = [
    ...(allProducts ? [{ value: '*', label: 'Semua Produk (Global)' }] : [{ value: '', label: 'Pilih produk yang ditugaskan' }]),
    ...products.map((item) => ({
      value: item.code,
      label: `${item.code} — ${item.name}${item.active ? '' : ' (nonaktif)'}`,
    })),
  ]

  const sessionOptions = [
    { value: '*', label: 'Semua Sesi' },
    ...sessions.map((item) => ({
      value: item.code,
      label: `${item.code} — ${item.name}${item.active ? '' : ' (nonaktif)'}`,
    })),
  ]

  return (
    <>
      <PageHeader
        title="Konfigurasi Zoom"
        description="Atur 1 link Zoom untuk semua produk/sesi, per produk, per batch, per sesi, atau untuk nama produk tertentu."
      />
      <Card>
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              id="zoom-scope-product"
              label="Cakupan Produk"
              value={productCode}
              options={productOptions}
              disabled={busy || productRaw.trim() !== ''}
              onChange={setProductCode}
            />
            <TextInput
              id="zoom-scope-batch"
              label="Cakupan Batch (opsional)"
              value={batch}
              onChange={setBatch}
              disabled={busy || productRaw.trim() !== ''}
              placeholder="Kosong = Semua Batch (mis. 392)"
            />
            <Select
              id="zoom-scope-session"
              label="Cakupan Sesi"
              value={sessionCode}
              options={sessionOptions}
              disabled={busy || productRaw.trim() !== ''}
              onChange={setSessionCode}
            />
          </div>
          <p className="text-[12px] text-ink-soft">
            Biarkan <strong>Semua Produk</strong>, <strong>Batch kosong</strong>, dan <strong>Semua Sesi</strong> bila
            ingin memakai <strong>1 link Zoom untuk semua webinar</strong>. Sistem otomatis memilih aturan yang paling
            spesifik saat peserta membuka link akses.
          </p>

          <TextInput
            id="zoom-product"
            label="Nama produk persis di OrderOnline"
            value={productRaw}
            onChange={setProductRaw}
            disabled={busy}
            placeholder="Opsional — isi hanya jika ingin spesifik 1 nama produk utuh (Contoh: KM01WO001 - ST - Jakarta)"
          />

          <TextInput
            id="zoom-destination"
            label="Link Zoom asli (HTTPS)"
            value={destination}
            onChange={setDestination}
            disabled={busy}
            placeholder="https://us02web.zoom.us/j/…?pwd=…"
          />

          {failure ? (
            <p role="alert" className="text-danger">
              {failure}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              {editing ? 'Simpan perubahan' : 'Simpan link Zoom'}
            </Button>
            {editing ? (
              <Button disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            ) : null}
          </div>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <label htmlFor="zoom-template" className="font-semibold">
            Link peserta untuk template followup OrderOnline
          </label>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <input
              id="zoom-template"
              readOnly
              value={template}
              className="min-w-0 w-full rounded-sm border border-line p-3 font-mono text-[12px]"
            />
            <Button onClick={() => void copy()}>Salin link peserta</Button>
          </div>
          <p className="mt-2 text-ink-soft">
            {
              'Biarkan {{order_id}} tetap seperti ini. OrderOnline akan menggantinya dengan ID order peserta. Link mencatat presensi lalu membuka Zoom sesuai aturan yang paling spesifik untuk order Paid.'
            }
          </p>
        </div>
      </Card>

      <div className="mt-4">
        <Card>
          <SearchInput
            id="zoom-search"
            value={search}
            onChange={setSearch}
            placeholder="Cari cakupan, produk, atau link Zoom"
          />
          {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : (
            <DataTable
              columns={columns}
              exportConfig={{
                filename: 'konfigurasi-zoom',
                disabled: loading || error !== null,
                loadRows: () =>
                  rows.map((row) => ({
                    scope: describeWebinarScope(row, products, sessions).label,
                    destination: row.destination,
                    participant_link: template,
                  })),
                columns: [
                  ...columns.filter((c) => c.key !== 'actions'),
                  { key: 'participant_link', header: 'Link peserta' },
                ],
              }}
            >
              {rows.map((row) => {
                const scopeInfo = describeWebinarScope(row, products, sessions)
                return (
                  <TableRow key={row.key ?? row.product_raw}>
                    <TableCell className="min-w-[200px] break-words">
                      <div className="flex flex-col gap-1">
                        <div>
                          <Badge tone={scopeInfo.badgeTone}>{scopeInfo.badgeText}</Badge>
                        </div>
                        <span className="font-medium text-ink">{scopeInfo.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[320px] break-all">{row.destination}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" disabled={busy} onClick={() => startEdit(row)}>
                          Edit
                        </Button>
                        {hasPermission(profile, 'action.delete_master') ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(row)}>
                          Hapus
                        </Button> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          )}
          {!loading && !error && rows.length === 0 ? (
            <p className="py-4 text-ink-soft">
              Belum ada link Zoom yang dikonfigurasi. Pilih cakupan (atau Semua Produk & Sesi) lalu simpan link Zoom di
              atas.
            </p>
          ) : null}
        </Card>
      </div>

      <Modal
        open={deleting !== null}
        title="Hapus Konfigurasi Link Zoom"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => deleting !== null && void confirmDelete(deleting)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p>
          Apakah Anda yakin ingin menghapus aturan link Zoom untuk{' '}
          <strong>{deleting ? describeWebinarScope(deleting, products, sessions).label : ''}</strong>?
        </p>
      </Modal>
    </>
  )
}
