import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { useState } from 'react'
import { type ProductAliasItem, validateProductNameInput } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { useConfigLists } from '../../lib/useConfigLists'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, SearchInput, Select } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableRow, TableCell } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

const columns = [
  { key: 'alias', header: 'Nama Alias di OrderOnline' },
  { key: 'target', header: 'Target Konfigurasi DVFLOW' },
  { key: 'created', header: 'Dibuat Pada' },
  { key: 'actions', header: 'Aksi' },
]

export function ProductAliasSection({ configVersion = 0 }: { configVersion?: number }) {
  const { profile } = useSession()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<ProductAliasItem | null>(null)

  // Form input tambah alias
  const [aliasName, setAliasName] = useState('')
  const [productCode, setProductCode] = useState('')
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [sessionCode, setSessionCode] = useState('')
  const [batch, setBatch] = useState('')
  const [city, setCity] = useState('')

  const toast = useToast()
  const { lists, error: listsError } = useConfigLists(configVersion)

  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<{ rows: ProductAliasItem[] }>('/api/product-aliases'),
    [],
  )

  const rows = (data?.rows ?? []).filter((r) =>
    r.alias_name.toLowerCase().includes(search.trim().toLowerCase()) ||
    r.canonical_target.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const canonicalValidation = validateProductNameInput({
    productCode,
    advertiserCode,
    typeCode,
    sessionCode,
    batch,
    city,
  })
  const canonicalTarget = canonicalValidation.ok ? canonicalValidation.value : ''

  function resetForm() {
    setAliasName('')
    setProductCode('')
    setAdvertiserCode('')
    setTypeCode('')
    setSessionCode('')
    setBatch('')
    setCity('')
  }

  async function handleSaveAlias() {
    if (!aliasName.trim()) {
      toast.show('Nama alias di OrderOnline wajib diisi.', 'danger')
      return
    }
    if (!canonicalTarget) {
      toast.show('Lengkapi seluruh elemen konfigurasi target DVFLOW.', 'danger')
      return
    }

    setBusy(true)
    try {
      await authorizedRequest('/api/product-aliases', {
        method: 'POST',
        body: {
          alias_name: aliasName.trim(),
          canonical_target: canonicalTarget,
        },
      })
      toast.show('Alias produk berhasil disimpan.', 'success')
      setModalOpen(false)
      resetForm()
      reload()
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal menyimpan alias produk.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(alias: ProductAliasItem) {
    setBusy(true)
    try {
      await authorizedRequest(`/api/product-aliases/${alias.id}`, { method: 'DELETE' })
      toast.show('Alias produk dihapus.', 'success')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal menghapus alias.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-ink">Daftar Alias Produk</h2>
            <p className="text-[12px] text-ink-muted">
              Peta nama produk checkout OrderOnline ke format resmi DVFLOW. Order baru dengan nama alias ini otomatis tervalidasi.
            </p>
          </div>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + Tambah Alias Baru
          </Button>
        </div>

        <SearchInput
          id="search-alias"
          value={search}
          onChange={setSearch}
          placeholder="Cari nama alias atau target konfigurasi..."
        />

        {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
        {listsError ? <ErrorState title="Pilihan kode gagal dimuat" message={listsError} /> : null}

        {loading && !data ? (
          <SkeletonRows rows={3} />
        ) : (
          <DataTable
            rowNumbers
            columns={columns}
            exportConfig={{
              filename: 'alias-produk-dvflow',
              disabled: loading || error !== null,
              columns: columns.filter((c) => c.key !== 'actions'),
              loadRows: () =>
                rows.map((r) => ({
                  alias: r.alias_name,
                  target: r.canonical_target,
                  created: new Date(r.created_at).toLocaleString('id-ID'),
                })),
            }}
          >
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-ink">
                  <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[12px] font-semibold text-amber-800 dark:text-amber-300">
                    {row.alias_name}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-[12px] font-bold text-primary">
                  {row.canonical_target}
                </TableCell>
                <TableCell className="text-[12px] text-ink-muted">
                  {new Date(row.created_at).toLocaleDateString('id-ID')}
                </TableCell>
                <TableCell>
                  {hasPermission(profile, 'action.delete_master') ? <Button size="sm" variant="danger" onClick={() => setDeleting(row)}>
                    Hapus
                  </Button> : null}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}

        {!loading && !error && rows.length === 0 ? (
          <p className="py-4 text-ink-soft text-[13px]">Belum ada alias produk yang terdaftar.</p>
        ) : null}
      </div>

      <Modal
        open={modalOpen}
        title="Tambah Alias Produk Baru"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setModalOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!aliasName.trim() || !canonicalTarget}
              onClick={() => void handleSaveAlias()}
            >
              Simpan Alias
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-left">
          <TextInput
            id="new-alias-name"
            label="Nama Produk di OrderOnline (Nama Alias)"
            value={aliasName}
            onChange={setAliasName}
            placeholder="Contoh: Workshop Kuliner Solo VIP"
          />
          <p className="text-[11px] text-ink-muted -mt-1">
            Tulis persis seperti <strong>Nama Produk</strong> di OrderOnline (bukan nama form/halaman checkout).
          </p>

          <span className="mt-2 text-[12px] font-bold uppercase tracking-wider text-ink-muted">
            Format Resmi Target DVFLOW:
          </span>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Select
              id="alias-prod"
              label="Produk"
              value={productCode}
              onChange={setProductCode}
              options={[
                { value: '', label: '-- Pilih Produk --' },
                ...(lists?.products ?? []),
              ]}
            />
            <Select
              id="alias-adv"
              label="Pengiklan"
              value={advertiserCode}
              onChange={setAdvertiserCode}
              options={[
                { value: '', label: '-- Pilih Pengiklan --' },
                ...(lists?.advertisers ?? []),
              ]}
            />
            <Select
              id="alias-type"
              label="Tipe Acara"
              value={typeCode}
              onChange={setTypeCode}
              options={[
                { value: '', label: '-- Pilih Tipe --' },
                ...(lists?.eventTypes ?? []),
              ]}
            />
            <Select
              id="alias-session"
              label="Sesi"
              value={sessionCode}
              onChange={setSessionCode}
              options={[
                { value: '', label: '-- Pilih Sesi --' },
                ...(lists?.sessions ?? []),
              ]}
            />
            <TextInput
              id="alias-batch"
              label="Batch"
              value={batch}
              onChange={setBatch}
              placeholder="Contoh: 392"
            />
            <TextInput
              id="alias-city"
              label="Kota / Live Zoom"
              value={city}
              onChange={setCity}
              placeholder="Contoh: Solo atau Live Zoom"
            />
          </div>

          <div className="mt-2 rounded border border-primary/20 bg-primary/5 p-2.5">
            <span className="text-[11px] font-semibold text-primary">Preview Format Kanonik:</span>
            <p className="mt-0.5 font-mono text-[13px] font-bold text-ink">
              {canonicalTarget || '(Lengkapi pilihan di atas)'}
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Alias Produk"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => deleting && void handleDelete(deleting)}
            >
              Hapus Alias
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink">
          Apakah Anda yakin ingin menghapus alias <strong>{deleting?.alias_name}</strong>? Order baru dari OrderOnline
          dengan nama ini tidak akan lagi dipetakan otomatis ke <code>{deleting?.canonical_target}</code>.
        </p>
      </Modal>
    </Card>
  )
}
