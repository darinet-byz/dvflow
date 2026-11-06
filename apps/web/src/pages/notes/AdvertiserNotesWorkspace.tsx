import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  archiveAdvertiserNote,
  fetchAdvertiserNotes,
  fromWibDateTimeInput,
  saveAdvertiserNote,
  toWibDateTimeInput,
  wibDateOf,
  wibToday,
  type AdvertiserNote,
  type AdvertiserNoteFilters,
} from '../../lib/advertiser-notes'
import { formatCount, formatWibDateTime, formatMoney } from '../../lib/format'
import { hasPermission } from '../../lib/roles'
import { describeRecentBatch, useRecentBatches } from '../../lib/recent-batches'
import { supabaseSelect } from '../../lib/supabase-rest'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { useIsPhone } from '../../lib/field-app'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useSession } from '../../lib/useSession'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { SearchInput, Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { SuggestInput } from '../../ui/SuggestInput'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

const OPEN_KEY = 'dvflow.notes.open'
const WIDTH_KEY = 'dvflow.notes.width'
const EMPTY_FILTERS: AdvertiserNoteFilters = {
  q: '', status: '', advertiserCode: '', productCode: '', batch: '', deadlineFrom: '', deadlineTo: '',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'Aktif', label: 'Aktif' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Selesai', label: 'Selesai' },
  { value: 'Dibatalkan', label: 'Dibatalkan' },
]

const FORM_STATUS_OPTIONS = [
  { value: 'Aktif', label: 'Aktif' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Selesai', label: 'Selesai' },
  { value: 'Dibatalkan', label: 'Dibatalkan' },
]

type CodeRow = { code: string; name: string }

type NoteForm = {
  advertiser_code: string
  product_code: string
  batch: string
  title: string
  description: string
  event_at: string
  location: string
  monitor_from: string
  deadline_at: string
  status: string
}

function emptyForm(): NoteForm {
  return {
    advertiser_code: '', product_code: '', batch: '', title: '', description: '',
    event_at: '', location: '', monitor_from: wibToday(), deadline_at: '', status: 'Aktif',
  }
}

function readOpen(): boolean {
  try { return window.localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
}

function readWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) ? Math.min(480, Math.max(320, value)) : 380
  } catch { return 380 }
}

function activityTone(note: AdvertiserNote): BadgeTone {
  if (note.overdue) return 'danger'
  if (note.activity_status === 'Spend Masuk') return 'success'
  if (note.activity_status === 'Order Masuk, Spend Belum') return 'warning'
  return 'neutral'
}

function deadlineTone(note: AdvertiserNote): BadgeTone {
  if (note.overdue) return 'danger'
  if (note.due_soon) return 'warning'
  return 'neutral'
}

/**
 * Advertiser Notes sebagai area kerja kedua.
 *
 * Panel ini hidup di luar `Outlet`, sehingga tidak remount saat halaman kiri
 * berpindah. Tombol Notes selalu tersedia; panel hanya di-minimize, bukan
 * ditutup permanen. Di layar ≥1440px panel menjadi kolom tetap; di bawahnya
 * menjadi panel melayang; di HP menjadi layar penuh.
 */
export function AdvertiserNotesWorkspace() {
  const { profile } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const allowed = hasPermission(profile, 'operasional.advertiser_notes')
  const canManage = hasPermission(profile, 'action.manage_advertiser_notes')
  const canInputSpend = !!profile?.advertiser_code && hasPermission(profile, 'action.input_spend')
  const docked = useMediaQuery('(min-width: 1440px)')
  const phone = useIsPhone()

  const [open, setOpen] = useState(readOpen)
  const [width, setWidth] = useState(readWidth)
  const [mode, setMode] = useState<'list' | 'detail' | 'form'>('list')
  const [selected, setSelected] = useState<AdvertiserNote | null>(null)
  const [editing, setEditing] = useState<AdvertiserNote | null>(null)
  const [filters, setFilters] = useState<AdvertiserNoteFilters>(EMPTY_FILTERS)
  const [form, setForm] = useState<NoteForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const resizing = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    try { window.localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* penyimpanan diblokir */ }
  }, [open])
  useEffect(() => {
    try { window.localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* penyimpanan diblokir */ }
  }, [width])
  useEffect(() => {
    if (open && mode === 'form') {
      setForm((current) => current.monitor_from === '' ? { ...current, monitor_from: wibToday() } : current)
    }
  }, [open, mode])

  const debouncedSearch = useDebouncedValue(filters.q)
  const badgeState = useAsyncData(
    () => allowed ? fetchAdvertiserNotes({ ...EMPTY_FILTERS, page: 1, pageSize: 1 }) : Promise.resolve(null),
    [allowed, refresh],
  )
  const listState = useAsyncData(
    () => open && allowed
      ? fetchAdvertiserNotes({ ...filters, q: debouncedSearch, page: 1, pageSize: 100 })
      : Promise.resolve(null),
    [open, allowed, filters.status, filters.advertiserCode, filters.productCode, filters.batch, filters.deadlineFrom, filters.deadlineTo, debouncedSearch, refresh],
  )
  const references = useAsyncData(async () => {
    if (!open || !allowed) return { products: [] as CodeRow[], advertisers: [] as CodeRow[] }
    const [products, advertisers] = await Promise.all([
      supabaseSelect<CodeRow>('products', { active: 'is.true', order: 'code.asc' }, 'code,name'),
      supabaseSelect<CodeRow>('advertisers', { active: 'is.true', order: 'code.asc' }, 'code,name'),
    ])
    return { products, advertisers }
  }, [open, allowed])

  const formBatch = useRecentBatches(mode === 'form' ? form.product_code : '', mode === 'form' ? form.advertiser_code : '')
  const batchOptions = formBatch.batches.map((batch) => {
    const described = describeRecentBatch(batch)
    return { value: batch.batch, label: described.label, hint: described.hint }
  })

  const badge = badgeState.data?.badge ?? 0
  const rows = listState.data?.rows ?? []
  const summary = listState.data?.summary
  const products = references.data?.products ?? []
  const advertisers = references.data?.advertisers ?? []

  const productOptions = useMemo(
    () => products.map((product) => ({ value: product.code, label: `${product.code} — ${product.name}` })),
    [products],
  )
  const advertiserOptions = useMemo(
    () => advertisers.map((advertiser) => ({ value: advertiser.code, label: `${advertiser.code} — ${advertiser.name}` })),
    [advertisers],
  )

  if (!allowed) return null

  function minimize(): void {
    setOpen(false)
  }

  function openPanel(): void {
    setOpen(true)
  }

  function startCreate(): void {
    setEditing(null)
    setForm({ ...emptyForm(), monitor_from: wibToday() })
    setFormError(null)
    setMode('form')
    setOpen(true)
  }

  function startEdit(note: AdvertiserNote): void {
    setEditing(note)
    setForm({
      advertiser_code: note.advertiser_code ?? '',
      product_code: note.product_code ?? '',
      batch: note.batch ?? '',
      title: note.title,
      description: note.description ?? '',
      event_at: toWibDateTimeInput(note.event_at),
      location: note.location ?? '',
      monitor_from: note.monitor_from,
      deadline_at: toWibDateTimeInput(note.deadline_at),
      status: note.status,
    })
    setFormError(null)
    setMode('form')
    setOpen(true)
  }

  function openDetail(note: AdvertiserNote): void {
    setSelected(note)
    setMode('detail')
  }

  function backToList(): void {
    setSelected(null)
    setMode('list')
  }

  async function submitForm(): Promise<void> {
    if (saving) return
    const eventAt = fromWibDateTimeInput(form.event_at)
    const deadlineAt = fromWibDateTimeInput(form.deadline_at)
    if (form.advertiser_code === '') { setFormError('Pilih pengiklan.'); return }
    if (form.product_code === '') { setFormError('Pilih produk.'); return }
    if (form.title.trim() === '') { setFormError('Judul wajib diisi.'); return }
    if (eventAt === null) { setFormError('Tanggal event wajib diisi.'); return }
    if (deadlineAt === null) { setFormError('Deadline iklan wajib diisi.'); return }
    setSaving(true)
    setFormError(null)
    try {
      await saveAdvertiserNote({
        advertiser_code: form.advertiser_code,
        product_code: form.product_code,
        batch: form.batch.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        event_at: eventAt,
        location: form.location.trim(),
        monitor_from: form.monitor_from,
        deadline_at: deadlineAt,
        status: form.status,
      }, editing?.id ?? null)
      toast.show(editing === null ? 'Catatan pengiklan dibuat.' : 'Catatan pengiklan diperbarui.', 'success')
      setEditing(null)
      setSelected(null)
      setMode('list')
      setRefresh((value) => value + 1)
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Catatan gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function archive(note: AdvertiserNote): Promise<void> {
    if (saving) return
    if (!window.confirm(`Arsipkan catatan "${note.title}"?`)) return
    setSaving(true)
    try {
      await archiveAdvertiserNote(note.id)
      toast.show('Catatan pengiklan diarsipkan.', 'success')
      setSelected(null)
      setMode('list')
      setRefresh((value) => value + 1)
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Catatan gagal diarsipkan.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  function openFilteredPage(path: '/order' | '/report-spend', note: AdvertiserNote, openSpendForm = false): void {
    const params = new URLSearchParams()
    if (note.advertiser_code) params.set('advertiserCode', note.advertiser_code)
    if (note.product_code) params.set('productCode', note.product_code)
    if (note.batch) params.set('batch', note.batch)
    params.set('dateFrom', note.monitor_from)
    params.set('dateTo', wibDateOf(note.deadline_at))
    if (openSpendForm) params.set('new', '1')
    navigate(`${path}?${params.toString()}`)
    // Halaman tujuan mungkin sudah terbuka; minta useFilterState membaca query baru.
    window.dispatchEvent(new Event('dvflow:filter-from-url'))
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!docked) return
    event.preventDefault()
    resizing.current = { x: event.clientX, width }
    const move = (moveEvent: PointerEvent) => {
      const start = resizing.current
      if (start === null) return
      setWidth(Math.min(480, Math.max(320, start.width - (moveEvent.clientX - start.x))))
    }
    const up = () => {
      resizing.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const panelVisible = open
  const panelClass = docked
    ? cn(
        'relative flex h-[calc(100vh-32px)] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-app sm:h-[calc(100vh-64px)]',
        panelVisible ? 'flex' : 'hidden',
      )
    : phone
      ? cn('fixed inset-0 z-[55] flex flex-col bg-card', panelVisible ? 'flex' : 'hidden')
      : cn('fixed bottom-3 right-3 top-3 z-[55] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-app', panelVisible ? 'flex' : 'hidden')

  const noteList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SearchInput id="notes-search" value={filters.q} onChange={(value) => setFilters((current) => ({ ...current, q: value }))} placeholder="Cari catatan, pengiklan, produk…" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Select id="notes-status" ariaLabel="Filter status catatan" value={filters.status} options={STATUS_OPTIONS} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} />
          <Select id="notes-advertiser" ariaLabel="Filter pengiklan catatan" value={filters.advertiserCode} placeholder="Semua Pengiklan" options={advertiserOptions} onChange={(value) => setFilters((current) => ({ ...current, advertiserCode: value }))} />
          <Select id="notes-product" ariaLabel="Filter produk catatan" value={filters.productCode} placeholder="Semua Produk" options={productOptions} onChange={(value) => setFilters((current) => ({ ...current, productCode: value }))} />
          <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear All</Button>
        </div>
        {summary === undefined ? null : (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-soft">
            <span>{summary.active} aktif</span>
            <span>·</span>
            <span className={summary.overdue > 0 ? 'font-semibold text-danger' : ''}>{summary.overdue} lewat deadline</span>
            <span>·</span>
            <span>{summary.spend_missing} belum ada spend</span>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {listState.error !== null ? <ErrorState message={listState.error} action={<Button onClick={listState.reload}>Coba lagi</Button>} /> : listState.loading && listState.data === null ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-soft">Belum ada catatan pengiklan pada filter ini.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((note) => (
              <li key={note.id}>
                <button type="button" onClick={() => openDetail(note)} className="w-full rounded-md border border-line bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-soft">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-semibold text-ink">{note.title}</p>
                    <Badge tone={deadlineTone(note)}>{note.overdue ? 'Lewat Deadline' : note.due_soon ? 'Mendekati' : note.status}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-soft">{note.advertiser_name ?? note.advertiser_code ?? '-'} · {note.product_name ?? note.product_code ?? '-'}{note.batch ? ` · Batch ${note.batch}` : ''}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{formatWibDateTime(note.event_at)}{note.location ? ` · ${note.location}` : ''}</p>
                  <p className="mt-1 text-[11px] text-ink-muted">Deadline: {formatWibDateTime(note.deadline_at)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={activityTone(note)}>{note.activity_status}</Badge>
                    <span className="text-[10px] text-ink-muted">{note.spend_reports} report · {note.orders} order</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  const noteDetail = selected === null ? null : (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={backToList}>‹ Kembali</Button>
        <div className="ml-auto flex gap-1.5">
          {canManage ? <Button size="sm" variant="secondary" onClick={() => startEdit(selected)}>Edit</Button> : null}
          {canManage ? <Button size="sm" variant="danger" onClick={() => void archive(selected)} disabled={saving}>Arsipkan</Button> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[16px] font-semibold text-ink">{selected.title}</h3>
          <Badge tone={deadlineTone(selected)}>{selected.overdue ? 'Lewat Deadline' : selected.due_soon ? 'Mendekati' : selected.status}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={activityTone(selected)}>{selected.activity_status}</Badge>
          <Badge tone="primary">{selected.product_name ?? selected.product_code ?? '-'}</Badge>
          {selected.batch ? <Badge tone="neutral">Batch {selected.batch}</Badge> : null}
        </div>
        <dl className="mt-3 grid grid-cols-[100px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
          <dt className="text-ink-soft">Pengiklan</dt><dd className="font-medium text-ink">{selected.advertiser_name ?? selected.advertiser_code ?? '-'}</dd>
          <dt className="text-ink-soft">Event</dt><dd className="font-medium text-ink">{formatWibDateTime(selected.event_at)}</dd>
          <dt className="text-ink-soft">Lokasi</dt><dd className="font-medium text-ink">{selected.location ?? '-'}</dd>
          <dt className="text-ink-soft">Deadline</dt><dd className="font-medium text-ink">{formatWibDateTime(selected.deadline_at)}</dd>
          <dt className="text-ink-soft">Dipantau</dt><dd className="font-medium text-ink">{selected.monitor_from}</dd>
          <dt className="text-ink-soft">Dibuat</dt><dd className="font-medium text-ink">{selected.created_by_name ?? '-'}</dd>
        </dl>
        {selected.description ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-soft p-3 text-[12px] text-ink">{selected.description}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Order</p><p className="text-[16px] font-bold text-ink">{formatCount(selected.orders)}</p></div>
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Paid</p><p className="text-[16px] font-bold text-ink">{formatCount(selected.paid)}</p></div>
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Tiket</p><p className="text-[16px] font-bold text-ink">{formatCount(selected.tickets)}</p></div>
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Omzet</p><p className="text-[16px] font-bold text-ink">{formatMoney(selected.omzet)}</p></div>
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Report Spend</p><p className="text-[16px] font-bold text-ink">{formatCount(selected.spend_reports)}</p></div>
          <div className="rounded-md bg-soft p-2.5"><p className="text-[10px] font-semibold uppercase text-ink-muted">Total Spend</p><p className="text-[16px] font-bold text-ink">{formatMoney(selected.spend_total)}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          Spend terakhir: {selected.last_spend_date ?? '-'} · Order terakhir: {formatWibDateTime(selected.last_order_at)}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => openFilteredPage('/order', selected)}>Lihat Order</Button>
          <Button size="sm" variant="secondary" onClick={() => openFilteredPage('/report-spend', selected)}>Lihat Report Spend</Button>
          {canInputSpend ? <Button size="sm" variant="primary" onClick={() => openFilteredPage('/report-spend', selected, true)}>Input Report Spend</Button> : null}
        </div>
      </div>
    </div>
  )

  const noteForm = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => { if (editing === null) backToList(); else { setSelected(editing); setMode('detail') } }}>‹ Batal</Button>
        <h3 className="text-[14px] font-semibold text-ink">{editing === null ? 'Buat Catatan' : 'Edit Catatan'}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          <Select id="note-advertiser" label="Pengiklan" value={form.advertiser_code} placeholder="Pilih pengiklan" options={advertiserOptions} onChange={(value) => setForm((current) => ({ ...current, advertiser_code: value }))} />
          <Select id="note-product" label="Produk" value={form.product_code} placeholder="Pilih produk" options={productOptions} onChange={(value) => setForm((current) => ({ ...current, product_code: value }))} />
          <p className="-mt-2 text-[11px] text-ink-soft">Note hanya terlihat oleh akun advertiser yang memegang produk ini.</p>
          <div>
            <label htmlFor="note-batch" className="mb-1 block text-[12px] font-semibold text-ink-soft">Batch (opsional)</label>
            <SuggestInput id="note-batch" ariaLabel="Batch catatan" value={form.batch} placeholder={form.product_code === '' ? 'Pilih produk untuk saran' : 'Batch'} options={batchOptions} onChange={(value) => setForm((current) => ({ ...current, batch: value }))} />
          </div>
          <TextInput id="note-title" label="Judul / Apa" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} maxLength={200} placeholder="mis. Seminar Solo batch 122" />
          <div>
            <label htmlFor="note-description" className="mb-1 block text-[12px] font-semibold text-ink-soft">Deskripsi</label>
            <textarea id="note-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} className="w-full rounded-sm border border-line bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none" placeholder="Instruksi untuk pengiklan…" />
          </div>
          <TextInput id="note-event" label="Kapan (event)" type="datetime-local" value={form.event_at} onChange={(value) => setForm((current) => ({ ...current, event_at: value }))} />
          <TextInput id="note-location" label="Dimana" value={form.location} onChange={(value) => setForm((current) => ({ ...current, location: value }))} maxLength={200} placeholder="Kota / venue" />
          <TextInput id="note-monitor" label="Pantau sejak" type="date" value={form.monitor_from} onChange={(value) => setForm((current) => ({ ...current, monitor_from: value }))} />
          <TextInput id="note-deadline" label="Deadline iklan running" type="datetime-local" value={form.deadline_at} onChange={(value) => setForm((current) => ({ ...current, deadline_at: value }))} />
          <Select id="note-status" label="Status" value={form.status} options={FORM_STATUS_OPTIONS} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
          {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          <div className="flex gap-2">
            <Button variant="primary" loading={saving} onClick={() => void submitForm()}>Simpan</Button>
            <Button variant="secondary" onClick={() => { if (editing === null) backToList(); else { setSelected(editing); setMode('detail') } }} disabled={saving}>Batal</Button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {!docked && open && !phone ? (
        <div className="fixed inset-0 z-[54] bg-ink/30" role="presentation" onClick={minimize} />
      ) : null}
      <aside className={panelClass} style={docked ? { width, display: panelVisible ? undefined : 'none' } : { display: panelVisible ? undefined : 'none' }} aria-label="Advertiser Notes">
        {docked ? <div role="separator" aria-orientation="vertical" onPointerDown={startResize} className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30" /> : null}
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">Advertiser Notes</p>
            <p className="text-[11px] text-ink-soft">{summary === undefined ? 'Catatan event & deadline iklan' : `${summary.active} aktif · ${summary.overdue} lewat deadline`}</p>
          </div>
          {canManage && mode !== 'form' ? <Button size="sm" variant="primary" onClick={startCreate} aria-label="Buat catatan pengiklan">+</Button> : null}
          <button type="button" onClick={minimize} aria-label="Perkecil Advertiser Notes" className="grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-soft hover:text-ink">»</button>
        </header>
        {mode === 'list' ? noteList : mode === 'detail' ? noteDetail : noteForm}
      </aside>
      {!open ? (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Buka Advertiser Notes"
          aria-expanded={false}
          title="Advertiser Notes"
          className="fixed bottom-4 right-4 z-[56] flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-[13px] font-semibold text-white shadow-app transition-colors hover:bg-primary-hover"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
          Notes
          {badge > 0 ? <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span> : null}
        </button>
      ) : null}
    </>
  )
}
