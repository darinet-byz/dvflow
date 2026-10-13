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

type Webinar = { product_raw: string; destination: string; updated_at: string }
const columns = [{ key: 'product_raw', header: 'Nama produk' }, { key: 'destination', header: 'Link Zoom' }, { key: 'actions', header: 'Aksi' }]

export function ZoomPage() {
  const [product, setProduct] = useState('')
  const [destination, setDestination] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(() => authorizedRequest<{ rows: Webinar[] }>('/api/webinar-destinations'), [])
  const template = `${window.location.origin}/access/{{order_id}}`
  const rows = (data?.rows ?? []).filter(row => `${row.product_raw} ${row.destination}`.toLowerCase().includes(search.trim().toLowerCase()))
  async function save() {
    if (busy) return
    setBusy(true); setFailure(null)
    try {
      await authorizedRequest('/api/webinar-destinations', { method: 'POST', body: { product_raw: product, destination } })
      setProduct(''); setDestination(''); setEditing(false); reload()
      toast.show('Link Zoom disimpan. Salin link peserta untuk template followup.', 'success')
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Link gagal disimpan.') }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(template); toast.show('Link peserta disalin.', 'success') }
    catch { toast.show('Salin link secara manual dari kotak link peserta.', 'danger') }
  }
  return <>
    <PageHeader title="Konfigurasi Zoom" description="Hubungkan nama produk webinar dengan link Zoom asli untuk peserta yang sudah membayar." />
    <Card>
      <form className="flex min-w-0 flex-col gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
        <TextInput id="zoom-product" label="Nama produk persis di OrderOnline" value={product} onChange={setProduct} disabled={busy || editing} placeholder="Contoh: KM01WO001 - ST - Jakarta" />
        <p className="text-[12px] text-ink-soft">Gunakan nama lengkap dari Product Name Generator. Setiap kombinasi produk, pengiklan, batch, sesi, dan kota disimpan terpisah.</p>
        <TextInput id="zoom-destination" label="Link Zoom asli (HTTPS)" value={destination} onChange={setDestination} disabled={busy} placeholder="https://us02web.zoom.us/j/…?pwd=…" />
        {failure ? <p role="alert" className="text-danger">{failure}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={busy}>{editing ? 'Simpan perubahan' : 'Simpan link Zoom'}</Button>
          {editing ? <Button disabled={busy} onClick={() => { setEditing(false); setProduct(''); setDestination('') }}>Batal</Button> : null}</div>
      </form>
      <div className="mt-5 border-t border-line pt-4">
        <label htmlFor="zoom-template" className="font-semibold">Link peserta untuk template followup OrderOnline</label>
        <div className="mt-2 flex min-w-0 flex-wrap gap-2"><input id="zoom-template" readOnly value={template} className="min-w-0 w-full rounded-sm border border-line p-3 font-mono text-[12px]" /><Button onClick={() => void copy()}>Salin link peserta</Button></div>
        <p className="mt-2 text-ink-soft">{'Biarkan {{order_id}} tetap seperti ini. OrderOnline akan menggantinya dengan ID order peserta. Link mencatat presensi lalu membuka Zoom sesuai produk order yang Paid.'}</p>
      </div>
    </Card>
    <div className="mt-4"><Card>
      <SearchInput id="zoom-search" value={search} onChange={setSearch} placeholder="Cari produk atau link Zoom" />
      {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
      {loading && !data ? <SkeletonRows rows={3} /> : <DataTable columns={columns} exportConfig={{ filename: 'konfigurasi-zoom', disabled: loading || error !== null, loadRows: () => rows.map(row => ({ ...row, participant_link: template })), columns: [...columns.filter(c => c.key !== 'actions'), { key: 'participant_link', header: 'Link peserta' }] }}>
        {rows.map(row => <TableRow key={row.product_raw}><TableCell className="min-w-[180px] break-words">{row.product_raw}</TableCell><TableCell className="max-w-[320px] break-all">{row.destination}</TableCell><TableCell><Button size="sm" disabled={busy} onClick={() => { setProduct(row.product_raw); setDestination(row.destination); setEditing(true); setFailure(null); document.getElementById('zoom-destination')?.focus() }}>Edit</Button></TableCell></TableRow>)}
      </DataTable>}
      {!loading && !error && rows.length === 0 ? <p className="py-4 text-ink-soft">Belum ada link yang cocok. Tambahkan nama produk webinar dan link Zoom di atas.</p> : null}
    </Card></div>
  </>
}
