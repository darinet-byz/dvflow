import { useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, SearchInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { DataTable, TableRow, TableCell } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type Connection = { id: string; name: string; active: boolean; has_api_token: boolean; last_received_at: string | null }
const base = '/api/integrations/orderonline'
const columns = [{ key: 'name', header: 'Nama koneksi' }, { key: 'status', header: 'Status' }, { key: 'api', header: 'Token API' }, { key: 'received', header: 'Webhook terakhir diterima' }, { key: 'actions', header: 'Aksi' }]

export function IntegrationsPage() {
  const [id, setId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [active, setActive] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [webhook, setWebhook] = useState<{ name: string; url: string } | null>(null)
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(() => authorizedRequest<{ rows: Connection[] }>(base), [])
  const rows = (data?.rows ?? []).filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()))
  function reset() { setId(null); setName(''); setToken(''); setActive(true) }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setFailure(null)
    try { await action() } catch (e) { setFailure(e instanceof Error ? e.message : 'Permintaan gagal.') }
    finally { setBusy(false) }
  }
  async function showWebhook(row: { id: string; name: string }) {
    const result = await authorizedRequest<{ url: string }>(`${base}/${row.id}/webhook`)
    setWebhook({ name: row.name, url: result.url })
  }
  return <>
    <PageHeader title="API & Webhook" description="Hubungkan beberapa akun atau toko OrderOnline. Setiap koneksi memiliki URL webhook sendiri." />
    <Card>
      <form className="flex min-w-0 flex-col gap-3" onSubmit={e => { e.preventDefault(); void run(async () => {
        const result = await authorizedRequest<{ id: string }>(id ? `${base}/${id}` : base, { method: id ? 'PATCH' : 'POST', body: { name, api_token: token, active } })
        reset(); reload(); toast.show('Koneksi disimpan.', 'success'); await showWebhook({ id: result.id, name })
      }) }}>
        <TextInput id="integration-name" label="Nama koneksi / toko" value={name} onChange={setName} disabled={busy} placeholder="Contoh: Toko Seminar" />
        <TextInput id="integration-token" label="Personal access token OrderOnline (opsional untuk webhook)" type="password" autoComplete="new-password" value={token} onChange={setToken} disabled={busy} placeholder={id ? 'Kosongkan untuk mempertahankan token tersimpan' : 'Paste token API OrderOnline'} />
        <p className="text-[12px] text-ink-soft">Token disimpan terenkripsi. Gunakan Tes API setelah menyimpan. Order masuk melalui webhook; tes API tidak mengimpor order lama.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} disabled={busy} onChange={e => setActive(e.target.checked)} />Koneksi aktif</label>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{id ? 'Simpan perubahan' : 'Tambah koneksi'}</Button>{id ? <Button disabled={busy} onClick={reset}>Batal</Button> : null}</div>
      </form>
      {failure ? <p role="alert" className="mt-3 text-danger">{failure}</p> : null}
      {webhook ? <div className="mt-4 min-w-0 border-t border-line pt-4">
        <label htmlFor="integration-webhook" className="font-semibold break-words">URL webhook: {webhook.name}</label>
        <input id="integration-webhook" readOnly value={webhook.url} className="mt-2 w-full min-w-0 rounded-sm border border-line p-3 text-[12px]" />
        <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => void run(async () => { await navigator.clipboard.writeText(webhook.url); toast.show('URL webhook disalin.', 'success') })}>Salin URL webhook</Button><Button onClick={() => setWebhook(null)}>Tutup</Button></div>
        <p className="mt-2 text-ink-soft">Paste URL ini pada pengaturan webhook order di OrderOnline untuk order baru dan perubahan status. URL ini rahasia; jangan kirim ke peserta. Nonaktifkan koneksi untuk menghentikan penerimaan.</p>
      </div> : null}
    </Card>
    <div className="mt-4"><Card>
      <SearchInput id="integration-search" value={search} onChange={setSearch} placeholder="Cari nama koneksi" />
      {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
      {loading && !data ? <SkeletonRows rows={3} /> : <DataTable columns={columns} exportConfig={{ filename: 'koneksi-orderonline', disabled: loading || error !== null, columns: columns.filter(c => c.key !== 'actions'), loadRows: () => rows.map(row => ({ name: row.name, status: row.active ? 'Aktif' : 'Nonaktif', api: row.has_api_token ? 'Tersimpan' : 'Belum diisi', received: row.last_received_at ?? 'Belum ada' })) }}>
        {rows.map(row => <TableRow key={row.id}><TableCell className="max-w-[240px] break-words">{row.name}</TableCell><TableCell>{row.active ? 'Aktif' : 'Nonaktif'}</TableCell><TableCell>{row.has_api_token ? 'Tersimpan' : 'Belum diisi'}</TableCell><TableCell>{row.last_received_at ? new Date(row.last_received_at).toLocaleString('id-ID') : 'Belum ada'}</TableCell><TableCell><div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => { setId(row.id); setName(row.name); setToken(''); setActive(row.active); setFailure(null); document.getElementById('integration-name')?.focus() }}>Edit</Button>
          <Button size="sm" disabled={busy} onClick={() => void run(() => showWebhook(row))}>URL webhook</Button>
          <Button size="sm" disabled={busy || !row.active || !row.has_api_token} onClick={() => void run(async () => { const result = await authorizedRequest<{ connected: boolean; message: string }>(`${base}/${row.id}/test`, { method: 'POST' }); toast.show(result.message, result.connected ? 'success' : 'danger') })}>Tes API</Button>
        </div></TableCell></TableRow>)}
      </DataTable>}
      {!loading && !error && rows.length === 0 ? <p className="py-4 text-ink-soft">Belum ada koneksi yang cocok.</p> : null}
    </Card></div>
  </>
}
