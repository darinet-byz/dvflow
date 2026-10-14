import { useSession } from '../../lib/useSession'
import { hasPermission } from '../../lib/roles'
import { useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, SearchInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableRow, TableCell } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type Connection = {
  id: string
  name: string
  slug: string
  active: boolean
  has_api_token: boolean
  last_received_at: string | null
}

const base = '/api/integrations/orderonline'
const columns = [
  { key: 'name', header: 'Nama Toko' },
  { key: 'slug', header: 'Kode' },
  { key: 'status', header: 'Status' },
  { key: 'api', header: 'Token API' },
  { key: 'received', header: 'Webhook Terakhir' },
  { key: 'actions', header: 'Aksi' },
]

export function IntegrationsPage() {
  const { profile } = useSession()
  const [id, setId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [token, setToken] = useState('')
  const [active, setActive] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [webhook, setWebhook] = useState<{ name: string; slug: string; url: string; redirectUrl?: string } | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<{ rows: Connection[] }>(base),
    [],
  )
  const rows = (data?.rows ?? []).filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase()) ||
    row.slug.toLowerCase().includes(search.trim().toLowerCase()),
  )

  function reset() {
    setId(null)
    setName('')
    setSlug('')
    setToken('')
    setActive(true)
  }

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      await action()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Permintaan gagal.')
    } finally {
      setBusy(false)
    }
  }

  async function showWebhook(row: { id: string; name: string; slug: string }) {
    const result = await authorizedRequest<{ url: string; redirectUrl?: string }>(`${base}/${row.id}/webhook`)
    setWebhook({ name: row.name, slug: row.slug, url: result.url, redirectUrl: result.redirectUrl })
  }

  async function confirmDelete(row: Connection) {
    if (busy) return
    setBusy(true)
    try {
      await authorizedRequest(`${base}/${row.id}`, { method: 'DELETE' })
      if (id === row.id) reset()
      setDeleting(null)
      reload()
      toast.show('Koneksi OrderOnline dihapus.', 'success')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal menghapus koneksi.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function copyToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show(successMessage, 'success')
    } catch {
      toast.show('Gagal menyalin ke clipboard', 'danger')
    }
  }

  return (
    <>
      <PageHeader
        title="API & Webhook"
        description="Hubungkan hingga 10+ akun atau toko OrderOnline. Setiap toko memiliki kode toko unik dan URL redirect yang seirama."
      />
      <Card>
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const result = await authorizedRequest<{ id: string }>(id ? `${base}/${id}` : base, {
                method: id ? 'PATCH' : 'POST',
                body: { name, slug: slug.trim().toUpperCase(), api_token: token, active },
              })
              const currentName = name
              const currentSlug = slug.trim().toUpperCase()
              reset()
              reload()
              toast.show('Koneksi toko disimpan.', 'success')
              await showWebhook({ id: result.id, name: currentName, slug: currentSlug })
            })
          }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextInput
              id="integration-name"
              label="Nama Toko"
              value={name}
              onChange={setName}
              disabled={busy}
              placeholder="Contoh: Seminar Solo"
            />
            <div>
              <TextInput
                id="integration-slug"
                label="Kode Toko (Maksimal 4 Karakter)"
                value={slug}
                onChange={(val) => setSlug(val.toUpperCase().slice(0, 4))}
                disabled={busy}
                placeholder="Contoh: SOLO, BDG, TK1"
              />
              <p className="mt-1 text-[11px] text-ink-muted">
                Digunakan pada URL redirect & pencegah tabrakan Order ID antar toko.
              </p>
            </div>
          </div>

          <TextInput
            id="integration-token"
            label="Personal Access Token OrderOnline"
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={setToken}
            disabled={busy}
            placeholder={
              id ? 'Kosongkan untuk mempertahankan token tersimpan' : 'Paste personal access token API OrderOnline'
            }
          />
          <p className="text-[12px] text-ink-soft">
            Token disimpan terenkripsi. Digunakan untuk fitur Tes API. Order masuk secara otomatis melalui webhook.
          </p>

          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(e) => setActive(e.target.checked)}
            />
            Koneksi toko aktif
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || (!id && !slug.trim())}>
              {id ? 'Simpan Perubahan' : 'Tambah Koneksi'}
            </Button>
            {id ? (
              <Button disabled={busy} onClick={reset}>
                Batal
              </Button>
            ) : null}
          </div>
        </form>

        {failure ? (
          <p role="alert" className="mt-3 text-danger text-[13px]">
            {failure}
          </p>
        ) : null}

        {webhook ? (
          <div className="mt-4 min-w-0 border-t border-line pt-4 flex flex-col gap-3">
            <div>
              <label htmlFor="integration-webhook" className="font-semibold text-[13px] text-ink">
                1. URL Webhook OrderOnline ({webhook.name})
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="integration-webhook"
                  readOnly
                  value={webhook.url}
                  className="w-full min-w-0 rounded-sm border border-line bg-soft/50 p-2.5 text-[12px] font-mono text-ink"
                />
                <Button onClick={() => void copyToClipboard(webhook.url, 'URL webhook disalin.')}>
                  Salin
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-ink-soft">
                Salin URL ini ke pengaturan Webhook di akun OrderOnline toko ini (pilih event Order Created & Status Changed).
              </p>
            </div>

            {webhook.redirectUrl ? (
              <div>
                <label htmlFor="integration-redirect" className="font-semibold text-[13px] text-ink">
                  2. URL Redirect Peserta (Halaman Terima Kasih OrderOnline)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="integration-redirect"
                    readOnly
                    value={webhook.redirectUrl}
                    className="w-full min-w-0 rounded-sm border border-line bg-soft/50 p-2.5 text-[12px] font-mono text-ink"
                  />
                  <Button onClick={() => void copyToClipboard(webhook.redirectUrl!, 'URL redirect disalin.')}>
                    Salin
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">
                  Salin URL ini ke pengaturan form checkout OrderOnline pada kolom <strong>Redirect URL</strong>. Variabel <code>{`{order_id}`}</code> akan otomatis diganti oleh OrderOnline.
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={() => setWebhook(null)}>Tutup</Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="mt-4">
        <Card>
          <SearchInput
            id="integration-search"
            value={search}
            onChange={setSearch}
            placeholder="Cari nama atau kode toko"
          />
          {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : (
            <DataTable
              columns={columns}
              exportConfig={{
                filename: 'koneksi-orderonline',
                disabled: loading || error !== null,
                columns: columns.filter((c) => c.key !== 'actions'),
                loadRows: () =>
                  rows.map((row) => ({
                    name: row.name,
                    slug: row.slug,
                    status: row.active ? 'Aktif' : 'Nonaktif',
                    api: row.has_api_token ? 'Tersimpan' : 'Belum diisi',
                    received: row.last_received_at ?? 'Belum ada',
                  })),
              }}
            >
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[200px] font-medium break-words">{row.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                      {row.slug}
                    </span>
                  </TableCell>
                  <TableCell>{row.active ? 'Aktif' : 'Nonaktif'}</TableCell>
                  <TableCell>{row.has_api_token ? 'Tersimpan' : 'Belum diisi'}</TableCell>
                  <TableCell>
                    {row.last_received_at
                      ? new Date(row.last_received_at).toLocaleString('id-ID')
                      : 'Belum ada'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setId(row.id)
                          setName(row.name)
                          setSlug(row.slug)
                          setToken('')
                          setActive(row.active)
                          setFailure(null)
                          document.getElementById('integration-name')?.focus()
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => void run(() => showWebhook(row))}>
                        Link Webhook
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy || !row.active || !row.has_api_token}
                        onClick={() =>
                          void run(async () => {
                            const result = await authorizedRequest<{
                              connected: boolean
                              message: string
                            }>(`${base}/${row.id}/test`, { method: 'POST' })
                            toast.show(result.message, result.connected ? 'success' : 'danger')
                          })
                        }
                      >
                        Tes API
                      </Button>
                      {hasPermission(profile, 'action.delete_master') ? <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(row)}>
                        Hapus
                      </Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          )}
          {!loading && !error && rows.length === 0 ? (
            <p className="py-4 text-ink-soft">Belum ada koneksi toko yang cocok.</p>
          ) : null}
        </Card>
      </div>

      <Modal
        open={deleting !== null}
        title="Hapus Koneksi OrderOnline"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => deleting !== null && void confirmDelete(deleting)}
            >
              Hapus Koneksi
            </Button>
          </>
        }
      >
        <p>
          Apakah Anda yakin ingin menghapus koneksi <strong>{deleting?.name ?? ''} ({deleting?.slug ?? ''})</strong>? URL webhook koneksi ini
          tidak akan lagi menerima order baru, tetapi data order historis yang sudah tersimpan tetap aman.
        </p>
      </Modal>
    </>
  )
}
