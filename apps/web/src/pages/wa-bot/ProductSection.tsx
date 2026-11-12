import { useMemo, useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { WaOverview, WaProduct } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'product', header: 'Produk', minWidth: 180 },
  { key: 'group', header: 'Grup WhatsApp', minWidth: 160 },
  { key: 'advertisers', header: 'Pengiklan (penerima)', minWidth: 260 },
  { key: 'status', header: 'Status', minWidth: 100 },
  { key: 'actions', header: 'Aksi', minWidth: 130 },
]

type FormState = {
  id: string | null
  productId: string
  groupId: string
  isActive: boolean
}

const EMPTY: FormState = { id: null, productId: '', groupId: '', isActive: true }

export function ProductSection({ overview, reload }: { overview: WaOverview; reload: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<WaProduct | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const mapped = useMemo(
    () => new Set(overview.products.filter((product) => product.group !== null).map((product) => product.id)),
    [overview.products],
  )
  const productOptions = overview.products
    .filter((product) => !mapped.has(product.id) || product.id === form?.productId)
    .map((product) => ({
      value: product.id,
      label: `${product.code} — ${product.name}${product.active ? '' : ' (nonaktif)'}`,
    }))

  const selectedProduct = overview.products.find((product) => product.id === form?.productId) ?? null

  function openCreate() {
    setFailure(null)
    setForm({ ...EMPTY })
  }

  function openEdit(product: WaProduct) {
    if (product.group === null) return
    setFailure(null)
    setForm({
      id: product.group.id,
      productId: product.id,
      groupId: product.group.fonnte_group_id,
      isActive: product.group.is_active,
    })
  }

  async function save() {
    if (form === null || busy) return
    if (form.productId === '') { setFailure('Pilih produk terlebih dahulu.'); return }
    if (form.groupId.trim() === '') { setFailure('ID grup Fonnte wajib diisi.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(
        form.id === null ? '/api/wa-bot/product-groups' : `/api/wa-bot/product-groups/${form.id}`,
        {
          method: form.id === null ? 'POST' : 'PATCH',
          body: {
            product_id: form.productId,
            fonnte_group_id: form.groupId.trim(),
            is_active: form.isActive,
          },
        },
      )
      setForm(null)
      reload()
      toast.show('Grup WhatsApp produk disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Grup gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (deleting?.group === null || deleting?.group === undefined || busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/wa-bot/product-groups/${deleting.group.id}`, { method: 'DELETE' })
      setDeleting(null)
      reload()
      toast.show('Mapping grup produk dihapus.', 'success')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Grup gagal dihapus.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Grup WhatsApp per Produk</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            Satu produk satu grup. Pengiklan yang ditugaskan ke produk otomatis disebut namanya di pesan.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ Atur Produk</Button>
      </div>

      <DataTable columns={COLUMNS} maxRows={null}>
        {overview.products.map((product) => {
          return (
            <TableRow key={product.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{product.name}</span>
                  <span className="text-[11px] text-ink-soft">
                    {product.code}{product.active ? '' : ' · nonaktif'}
                  </span>
                </div>
              </TableCell>
              <TableCell className="break-all">
                {product.group === null ? (
                  <span className="text-[12px] text-ink-soft">Belum diatur</span>
                ) : (
                  product.group.fonnte_group_id
                )}
              </TableCell>
              <TableCell>
                {product.advertisers.length === 0 ? (
                  <span className="text-[12px] text-ink-soft">Belum ada pengiklan</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {product.advertisers.map((advertiser) => (
                      <Badge key={advertiser.id} tone="neutral">{advertiser.name}</Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {product.group === null ? (
                  <Badge tone="neutral">Belum diatur</Badge>
                ) : (
                  <Badge tone={product.group.is_active ? 'success' : 'neutral'}>
                    {product.group.is_active ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {product.group === null ? (
                    <Button size="sm" variant="primary" onClick={() => { setFailure(null); setForm({ ...EMPTY, productId: product.id }) }}>
                      Atur
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => openEdit(product)}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(product)}>Hapus</Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </DataTable>
      {overview.products.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada produk. Tambahkan produk di Konfigurasi Produk terlebih dahulu.</p>
      ) : null}

      <Modal
        open={form !== null}
        title={form?.id === null ? 'Atur Grup Produk' : 'Edit Grup Produk'}
        onClose={() => { if (!busy) setForm(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setForm(null)}>Batal</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>Simpan</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            id="wa-product-id"
            label="Produk"
            value={form?.productId ?? ''}
            options={productOptions}
            placeholder="Pilih produk"
            disabled={busy || form?.id !== null}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, productId: value })}
          />
          <TextInput
            id="wa-product-group-id"
            label="ID Grup Fonnte"
            value={form?.groupId ?? ''}
            placeholder="Contoh: 12xxxxxxxxxxxxxxxx@g.us"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, groupId: value })}
          />
          {selectedProduct !== null ? (
            <div className="rounded-sm border border-line bg-soft p-2.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Penerima otomatis</p>
              {selectedProduct.advertisers.length === 0 ? (
                <p className="text-[12px] text-ink-soft">Belum ada pengiklan yang ditugaskan ke produk ini.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selectedProduct.advertisers.map((advertiser) => (
                    <Badge key={advertiser.id} tone="neutral">{advertiser.name}</Badge>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form?.isActive ?? true}
              disabled={busy}
              onChange={(event) => setForm((current) => current === null ? current : { ...current, isActive: event.target.checked })}
            />
            Bot aktif untuk produk ini
          </label>
          {failure ? <p role="alert" className="text-[12px] text-danger">{failure}</p> : null}
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Grup Produk"
        onClose={() => { if (!busy) setDeleting(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Hapus</Button>
          </>
        }
      >
        <p>
          Hapus grup untuk <strong>{deleting?.name ?? '-'}</strong>? Riwayat pengiriman tetap tersimpan,
          tetapi pengingat berhenti untuk produk ini.
        </p>
      </Modal>
    </Card>
  )
}
