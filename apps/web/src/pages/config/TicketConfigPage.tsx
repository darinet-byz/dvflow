import { useSession } from '../../lib/useSession'
import { hasPermission, hasAllProductAccess } from '../../lib/roles'
import { useMemo, useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { buildCheckinQrSvg } from '../../ticket/qr'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type SeminarTicketRow = {
  key: string
  mode?: 'scope' | 'exact'
  product_code: string
  batch: string
  session_code: string
  venue: string
  schedule: string
  notes: string
  active: boolean
  updated_at: string
}

type ConfigOption = { code: string; name: string; active: boolean }

type SeminarTicketListResponse = {
  rows: SeminarTicketRow[]
  products?: ConfigOption[]
  sessions?: ConfigOption[]
}

const columns = [
  { key: 'scope', header: 'Cakupan Tiket' },
  { key: 'details', header: 'Info Tiket (Lokasi / Jadwal / Catatan)' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Aksi' },
]

function describeTicketScope(
  row: { product_code: string; batch: string; session_code: string },
  products: ConfigOption[],
  sessions: ConfigOption[],
): { label: string; badgeText: string; badgeTone: 'seminar' | 'success' } {
  const p = row.product_code || '*'
  const b = row.batch || '*'
  const s = row.session_code || '*'

  if (p === '*' && b === '*' && s === '*') {
    return {
      label: 'Semua Produk • Semua Batch • Semua Sesi',
      badgeText: 'Semua Seminar (Global)',
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
    badgeTone: 'seminar',
  }
}

export function TicketConfigPage() {
  const { profile } = useSession()
  const allProducts = hasAllProductAccess(profile)
  const [productCode, setProductCode] = useState(allProducts ? '*' : '')
  const [batch, setBatch] = useState('')
  const [sessionCode, setSessionCode] = useState('*')
  const [venue, setVenue] = useState('')
  const [schedule, setSchedule] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  // Key rule yang sedang diedit: server membuangnya bila scope berubah (tanpa rule ganda).
  const [originalKey, setOriginalKey] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SeminarTicketRow | null>(null)
  const [previewRow, setPreviewRow] = useState<{
    product_code: string
    batch: string
    session_code: string
    venue: string
    schedule: string
    notes: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const toast = useToast()

  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<SeminarTicketListResponse>('/api/seminar-tickets'),
    [],
  )

  const products = data?.products ?? []
  const sessions = data?.sessions ?? []
  const template = `${window.location.origin}/access/{{order_id}}`
  const sampleQrSvg = useMemo(() => buildCheckinQrSvg('/checkin/283033796'), [])

  const rows = (data?.rows ?? []).filter((row) => {
    const scopeInfo = describeTicketScope(row, products, sessions)
    return `${scopeInfo.label} ${row.venue} ${row.schedule} ${row.notes}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  })

  function resetForm() {
    setProductCode(allProducts ? '*' : '')
    setBatch('')
    setSessionCode('*')
    setVenue('')
    setSchedule('')
    setNotes('')
    setActive(true)
    setEditing(false)
    setOriginalKey(null)
    setFailure(null)
  }

  async function save() {
    if (busy) return
    if (!allProducts && !productCode) { setFailure('Pilih produk yang ditugaskan.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/seminar-tickets', {
        method: 'POST',
        body: {
          product_code: productCode || '*',
          batch: batch.trim() || '*',
          session_code: sessionCode || '*',
          venue: venue.trim(),
          schedule: schedule.trim(),
          notes: notes.trim(),
          active,
          ...(originalKey ? { original_key: originalKey } : {}),
        },
      })
      resetForm()
      reload()
      toast.show('Konfigurasi tiket QR disimpan.', 'success')
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Konfigurasi tiket gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(row: SeminarTicketRow) {
    if (busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/seminar-tickets?key=${encodeURIComponent(row.key)}`, {
        method: 'DELETE',
      })
      setDeleting(null)
      reload()
      toast.show('Konfigurasi tiket QR dihapus.', 'success')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Gagal menghapus konfigurasi tiket.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(template)
      toast.show('Link tiket peserta disalin.', 'success')
    } catch {
      toast.show('Salin link secara manual dari kotak link peserta.', 'danger')
    }
  }

  function startEdit(row: SeminarTicketRow) {
    setOriginalKey(row.key)
    setProductCode(row.product_code || '*')
    setBatch(row.batch === '*' ? '' : row.batch)
    setSessionCode(row.session_code || '*')
    setVenue(row.venue)
    setSchedule(row.schedule)
    setNotes(row.notes)
    setActive(row.active)
    setEditing(true)
    setFailure(null)
    document.getElementById('ticket-venue')?.focus()
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
        title="Konfigurasi Barcode / Tiket"
        description="Atur tampilan dan informasi tiket QR check-in untuk peserta Seminar Offline & Hybrid (per produk, per batch, per sesi, atau 1 pengaturan untuk semua)."
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
              id="ticket-scope-product"
              label="Cakupan Produk"
              value={productCode}
              options={productOptions}
              disabled={busy}
              onChange={setProductCode}
            />
            <TextInput
              id="ticket-scope-batch"
              label="Cakupan Batch (opsional)"
              value={batch}
              onChange={setBatch}
              disabled={busy}
              placeholder="Kosong = Semua Batch (mis. 392)"
            />
            <Select
              id="ticket-scope-session"
              label="Cakupan Sesi"
              value={sessionCode}
              options={sessionOptions}
              disabled={busy}
              onChange={setSessionCode}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              id="ticket-venue"
              label="Lokasi / Venue Acara (opsional)"
              value={venue}
              onChange={setVenue}
              disabled={busy}
              placeholder="Contoh: Ballroom Hotel Solo Paragon Lt. 2"
            />
            <TextInput
              id="ticket-schedule"
              label="Jadwal / Jam Acara (opsional)"
              value={schedule}
              onChange={setSchedule}
              disabled={busy}
              placeholder="Contoh: Minggu, 09:00 - 15:00 WIB"
            />
          </div>

          <TextInput
            id="ticket-notes"
            label="Catatan Tiket Peserta (opsional)"
            value={notes}
            onChange={setNotes}
            disabled={busy}
            placeholder="Contoh: Tunjukkan QR ini di meja registrasi 30 menit sebelum sesi dimulai."
          />

          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(e) => setActive(e.target.checked)}
            />
            Tiket QR aktif untuk cakupan ini
          </label>

          {failure ? (
            <p role="alert" className="text-danger">
              {failure}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              {editing ? 'Simpan perubahan' : 'Simpan konfigurasi tiket'}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                setPreviewRow({
                  product_code: productCode || '*',
                  batch: batch.trim() || '*',
                  session_code: sessionCode || '*',
                  venue: venue.trim(),
                  schedule: schedule.trim(),
                  notes: notes.trim(),
                })
              }
            >
              Preview Tiket QR
            </Button>
            {editing ? (
              <Button disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            ) : null}
          </div>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <label htmlFor="ticket-template" className="font-semibold">
            Link tiket barcode / QR untuk template followup OrderOnline
          </label>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <input
              id="ticket-template"
              readOnly
              value={template}
              className="min-w-0 w-full rounded-sm border border-line p-3 font-mono text-[12px]"
            />
            <Button onClick={() => void copyTemplate()}>Salin link tiket</Button>
          </div>
          <p className="mt-2 text-ink-soft">
            {
              'Gunakan link {{order_id}} yang sama di template pesan WhatsApp/Email OrderOnline. Untuk produk bertipe Seminar Offline atau Hybrid yang sudah Paid, link ini otomatis menampilkan halaman Tiket QR peserta (beserta Lokasi, Jadwal, dan Catatan sesuai cakupan yang paling spesifik) untuk dipindai di menu Scan QR.'
            }
          </p>
        </div>
      </Card>

      <div className="mt-4">
        <Card>
          <SearchInput
            id="ticket-search"
            value={search}
            onChange={setSearch}
            placeholder="Cari cakupan, lokasi, jadwal, atau catatan tiket"
          />
          {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : (
            <DataTable
              columns={columns}
              exportConfig={{
                filename: 'konfigurasi-tiket-qr',
                disabled: loading || error !== null,
                loadRows: () =>
                  rows.map((row) => ({
                    scope: describeTicketScope(row, products, sessions).label,
                    details: [row.venue, row.schedule, row.notes].filter(Boolean).join(' | ') || 'Default',
                    status: row.active ? 'Aktif' : 'Nonaktif',
                    participant_link: template,
                  })),
                columns: [
                  ...columns.filter((c) => c.key !== 'actions'),
                  { key: 'participant_link', header: 'Link tiket' },
                ],
              }}
            >
              {rows.map((row) => {
                const scopeInfo = describeTicketScope(row, products, sessions)
                return (
                  <TableRow key={row.key}>
                    <TableCell className="min-w-[200px] break-words">
                      <div className="flex flex-col gap-1">
                        <div>
                          <Badge tone={scopeInfo.badgeTone}>{scopeInfo.badgeText}</Badge>
                        </div>
                        <span className="font-medium text-ink">{scopeInfo.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[320px] break-words">
                      <div className="flex flex-col gap-0.5 text-[12px]">
                        {row.venue ? (
                          <span>
                            <strong>Lokasi:</strong> {row.venue}
                          </span>
                        ) : null}
                        {row.schedule ? (
                          <span>
                            <strong>Jadwal:</strong> {row.schedule}
                          </span>
                        ) : null}
                        {row.notes ? (
                          <span>
                            <strong>Catatan:</strong> {row.notes}
                          </span>
                        ) : null}
                        {!row.venue && !row.schedule && !row.notes ? (
                          <span className="text-ink-muted">Info standar (tanpa catatan tambahan)</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge tone={row.active ? 'success' : 'danger'}>{row.active ? 'Aktif' : 'Nonaktif'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" disabled={busy} onClick={() => setPreviewRow(row)}>
                          Preview QR
                        </Button>
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
              Belum ada aturan khusus tiket seminar. Secara bawaan semua order Seminar Offline & Hybrid yang Paid tetap
              mendapatkan tiket QR standar, atau tambahkan aturan di atas untuk menampilkan lokasi, jadwal, dan catatan.
            </p>
          ) : null}
        </Card>
      </div>

      <Modal
        open={previewRow !== null}
        title="Preview Tiket Barcode / QR Peserta"
        onClose={() => setPreviewRow(null)}
        footer={<Button onClick={() => setPreviewRow(null)}>Tutup preview</Button>}
      >
        {previewRow === null ? null : (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-page p-4 text-[13px]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tiket Peserta</p>
              <p className="text-[18px] font-bold text-ink">Ahmad (Contoh Peserta)</p>
              <p className="text-ink-soft">
                Order ID <strong className="font-mono text-ink">283033796</strong>
              </p>
            </div>

            <div className="rounded-md border border-line bg-card p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Seminar Offline</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-ink-muted">Produk</dt>
                <dd className="font-semibold text-ink">
                  {previewRow.product_code === '*' ? 'Kuliner Masteri' : previewRow.product_code}
                </dd>
                <dt className="text-ink-muted">Batch</dt>
                <dd className="font-semibold text-ink">{previewRow.batch === '*' ? '392' : previewRow.batch}</dd>
                <dt className="text-ink-muted">Sesi</dt>
                <dd className="font-semibold text-ink">
                  {previewRow.session_code === '*' ? 'S1' : previewRow.session_code}
                </dd>
                <dt className="text-ink-muted">Kota</dt>
                <dd className="font-semibold text-ink">Solo</dd>
                {previewRow.venue ? (
                  <>
                    <dt className="text-ink-muted">Lokasi</dt>
                    <dd className="font-semibold text-ink">{previewRow.venue}</dd>
                  </>
                ) : null}
                {previewRow.schedule ? (
                  <>
                    <dt className="text-ink-muted">Jadwal</dt>
                    <dd className="font-semibold text-ink">{previewRow.schedule}</dd>
                  </>
                ) : null}
                {previewRow.notes ? (
                  <>
                    <dt className="text-ink-muted">Catatan</dt>
                    <dd className="font-semibold text-ink">{previewRow.notes}</dd>
                  </>
                ) : null}
              </dl>
            </div>

            <div className="rounded-md border border-line bg-card p-3 text-center">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Check-in Panitia</p>
              <div
                className="mx-auto aspect-square w-full max-w-[200px]"
                dangerouslySetInnerHTML={{ __html: sampleQrSvg }}
              />
              <p className="mt-2 text-[12px] text-ink-muted">
                Tunjukkan kode QR di atas kepada panitia untuk dipindai di menu Scan QR.
              </p>
              <p className="mt-1 font-mono text-[22px] font-bold tracking-wider text-ink">283033796</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Konfigurasi Tiket"
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
          Apakah Anda yakin ingin menghapus konfigurasi tiket untuk{' '}
          <strong>{deleting ? describeTicketScope(deleting, products, sessions).label : ''}</strong>?
        </p>
      </Modal>
    </>
  )
}

