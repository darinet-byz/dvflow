import { useMemo, useState } from 'react'
import {
  adCalendarScoreText,
  adCalendarStatusLabel,
  createAdCalendar,
  deleteAdCalendar,
  fetchAdCalendar,
  updateAdCalendar,
  type AdCalendarPage,
  type AdCalendarRow,
  type SaveAdCalendarInput,
} from '../../lib/ad-calendar'
import { MONTH_NAMES, WEEKDAYS, monthGrid, toIsoDate } from '../../lib/date-range'
import { describeRecentBatch, useRecentBatches } from '../../lib/recent-batches'
import { hasPermission } from '../../lib/roles'
import { useAsyncData } from '../../lib/useAsyncData'
import { useSession } from '../../lib/useSession'
import { useProductScope } from '../../layout/ProductScope'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { SuggestInput } from '../../ui/SuggestInput'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'
import { shortTime } from '../../lib/event-calendar'

type FormState = {
  id: string | null
  event_id: string
  advertiserCodes: string[]
  batch: string
  deadline_date: string
}

function emptyForm(deadline: string): FormState {
  return { id: null, event_id: '', advertiserCodes: [], batch: '', deadline_date: deadline }
}

/** A93: satu deadline bisa dimiliki beberapa pengiklan; edit membawa seluruh anggotanya. */
function deadlineAdvertiserCodes(
  rows: AdCalendarRow[],
  row: AdCalendarRow,
  activeAdvertisers: Array<{ code: string }>,
): string[] {
  const active = new Set(activeAdvertisers.map((advertiser) => advertiser.code))
  const codes = rows
    .filter((item) =>
      item.event_id === row.event_id
      && item.product_code === row.product_code
      && item.batch === row.batch
      && item.deadline_date === row.deadline_date)
    .map((item) => item.advertiser_code)
    .filter((code): code is string => code !== null && active.has(code))
  return [...new Set(codes)]
}

function displayDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`
}

function statusTone(status: AdCalendarRow['status']): BadgeTone {
  if (status === 'on_time') return 'success'
  if (status === 'late') return 'warning'
  if (status === 'unpublished') return 'danger'
  return 'neutral'
}

function statusAccent(status: AdCalendarRow['status']): string {
  if (status === 'on_time') return 'border-l-success'
  if (status === 'late') return 'border-l-warning'
  if (status === 'unpublished') return 'border-l-danger'
  return 'border-l-line'
}

function statusChip(status: AdCalendarRow['status']): string {
  if (status === 'on_time') return 'bg-success-soft text-[#28a95b]'
  if (status === 'late') return 'bg-warning-soft text-[#c78a21]'
  if (status === 'unpublished') return 'bg-danger-soft text-danger'
  return 'bg-soft text-ink-soft'
}

function statusDot(status: AdCalendarRow['status']): string {
  if (status === 'on_time') return 'bg-success'
  if (status === 'late') return 'bg-warning'
  if (status === 'unpublished') return 'bg-danger'
  return 'bg-ink-muted'
}

/**
 * A80: Kalender Iklan.
 *
 * Deadline tayang per pengiklan + produk + batch. Tanggal tayang dan skor
 * kedisiplinan berasal dari server (order/lead pertama atau report spend
 * pertama), bukan input manual.
 */
export function AdCalendarTab() {
  const { profile } = useSession()
  const toast = useToast()
  const canManage = hasPermission(profile, 'action.manage_ad_calendar')
  // A97: kalender iklan hanya menampilkan produk yang sedang dipilih.
  const productScope = useProductScope()
  const scopeCode = productScope !== null && productScope.chosen ? productScope.code : ''

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm(toIsoDate(new Date())))
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<AdCalendarRow | null>(null)
  const [deleting, setDeleting] = useState<AdCalendarRow | null>(null)
  const [dayDetail, setDayDetail] = useState<string | null>(null)

  const from = toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1))
  const to = toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))
  const { data, loading, error, reload } = useAsyncData<AdCalendarPage>(
    () => fetchAdCalendar(from, to),
    [from, to],
  )

  const rows = useMemo(() => {
    const list = data?.rows ?? []
    return scopeCode === '' ? list : list.filter((row) => row.product_code === scopeCode)
  }, [data, scopeCode])
  const advertisers = data?.advertisers ?? []
  const events = useMemo(() => {
    const list = data?.events ?? []
    return scopeCode === '' ? list : list.filter((event) => event.product_code === scopeCode)
  }, [data, scopeCode])
  const cells = useMemo(() => monthGrid(month.getFullYear(), month.getMonth()), [month])
  const rowsByDate = useMemo(() => {
    const map = new Map<string, AdCalendarRow[]>()
    for (const row of rows) {
      const list = map.get(row.deadline_date) ?? []
      list.push(row)
      map.set(row.deadline_date, list)
    }
    return map
  }, [rows])

  const dayDetailRows = dayDetail === null ? [] : (rowsByDate.get(dayDetail) ?? [])
  const agendaRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      const byDate = left.deadline_date.localeCompare(right.deadline_date)
      if (byDate !== 0) return byDate
      const byAdvertiser = (left.advertiser_code ?? '').localeCompare(right.advertiser_code ?? '', 'id')
      if (byAdvertiser !== 0) return byAdvertiser
      const byProduct = left.product_code.localeCompare(right.product_code, 'id')
      if (byProduct !== 0) return byProduct
      return left.batch.localeCompare(right.batch, 'id')
    })
  }, [rows])

  const selectedEvent = events.find((event) => event.id === form.event_id)
  const { batches: recentBatches } = useRecentBatches(selectedEvent?.product_code ?? '', form.advertiserCodes[0] ?? '')
  const batchSuggestions = recentBatches.map((batch) => {
    const described = describeRecentBatch(batch)
    return { value: batch.batch, label: described.label, hint: described.hint }
  })

  const eventOptions = events.map((event) => ({
    value: event.id,
    label: `${event.product_code} — ${event.category} · ${displayDate(event.event_date)} ${shortTime(event.start_time)}`,
  }))
  const today = toIsoDate(new Date())

  function shiftMonth(delta: number): void {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  function startCreate(deadline: string): void {
    setForm(emptyForm(deadline))
    setFormError(null)
    setFormOpen(true)
  }

  function startEdit(row: AdCalendarRow): void {
    setForm({
      id: row.id,
      event_id: row.event_id ?? '',
      advertiserCodes: deadlineAdvertiserCodes(rows, row, advertisers),
      batch: row.batch,
      deadline_date: row.deadline_date,
    })
    setFormError(null)
    setSelected(null)
    setFormOpen(true)
  }

  function toggleAdvertiser(code: string, checked: boolean): void {
    setForm((current) => ({
      ...current,
      advertiserCodes: checked
        ? [...current.advertiserCodes.filter((item) => item !== code), code]
        : current.advertiserCodes.filter((item) => item !== code),
    }))
    setFormError(null)
  }

  async function submitForm(): Promise<void> {
    if (saving) return
    if (form.event_id === '') { setFormError('Pilih event dari Kalender Event.'); return }
    if (form.advertiserCodes.length === 0) { setFormError('Pilih minimal satu pengiklan.'); return }
    if (form.batch.trim() === '') { setFormError('Batch wajib diisi.'); return }
    if (form.deadline_date === '') { setFormError('Tanggal deadline wajib diisi.'); return }

    setSaving(true)
    setFormError(null)
    try {
      if (form.id === null) {
        const result = await createAdCalendar({
          event_id: form.event_id,
          advertiser_codes: form.advertiserCodes,
          batch: form.batch.trim(),
          deadline_date: form.deadline_date,
        })
        const created = result.calendars.length
        toast.show(
          result.skipped.length > 0
            ? `${created} deadline ditambahkan, ${result.skipped.length} dilewati karena sudah ada.`
            : `${created} deadline ditambahkan.`,
          'success',
        )
      } else {
        const payload: SaveAdCalendarInput = {
          event_id: form.event_id,
          advertiser_codes: form.advertiserCodes,
          batch: form.batch.trim(),
          deadline_date: form.deadline_date,
        }
        await updateAdCalendar(form.id, payload)
        toast.show(
          form.advertiserCodes.length > 1
            ? `Deadline iklan diperbarui untuk ${form.advertiserCodes.length} pengiklan.`
            : 'Deadline iklan diperbarui.',
          'success',
        )
      }
      setFormOpen(false)
      reload()
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Deadline gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting === null || saving) return
    setSaving(true)
    try {
      await deleteAdCalendar(deleting.id)
      toast.show('Deadline iklan dihapus.', 'success')
      setDeleting(null)
      setSelected(null)
      reload()
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Deadline gagal dihapus.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">‹</Button>
            <p className="min-w-[150px] text-center text-[15px] font-semibold text-ink">{MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</p>
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(1)} aria-label="Bulan berikutnya">›</Button>
            <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hari Ini</Button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[12px] text-ink-muted">{rows.length} deadline bulan ini</p>
            {canManage ? <Button variant="primary" size="sm" onClick={() => startCreate(today)}>+ Tambah Deadline</Button> : null}
          </div>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
          {([
            ['on_time', 'Tepat waktu'],
            ['late', 'Terlambat'],
            ['unpublished', 'Belum tayang'],
            ['upcoming', 'Belum jatuh tempo'],
          ] as const).map(([status, label]) => (
            <span key={status} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', statusDot(status))} />
              {label}
            </span>
          ))}
        </div>

        {error !== null ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : loading && data === null ? <SkeletonRows rows={6} /> : (
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-7 gap-1 pb-1">
                {WEEKDAYS.map((day) => (
                  <p key={day} className="px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{day}</p>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((cell, index) => {
                  if (cell === null) return <div key={`empty-${index}`} className="min-h-[92px] rounded-md bg-soft/30" />
                  const dayRows = rowsByDate.get(cell) ?? []
                  const isToday = cell === today
                  return (
                    <div
                      key={cell}
                      onClick={dayRows.length > 0 ? () => setDayDetail(cell) : canManage ? () => startCreate(cell) : undefined}
                      title={dayRows.length > 0 ? 'Lihat semua deadline hari ini' : canManage ? 'Klik untuk menambah deadline' : undefined}
                      className={cn(
                        'min-h-[92px] rounded-md border p-1.5 transition-colors',
                        isToday ? 'border-primary bg-primary-soft/40' : 'border-line bg-card',
                        (canManage || dayRows.length > 0) ? 'cursor-pointer hover:border-primary/40' : '',
                      )}
                    >
                      <p className={cn('mb-1 text-[11px] font-semibold', isToday ? 'text-primary' : 'text-ink-soft')}>{Number(cell.slice(8))}</p>
                      <div className="flex flex-col gap-1">
                        {dayRows.slice(0, 3).map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelected(row) }}
                            className={cn(
                              'rounded-sm border-l-[3px] bg-soft px-1 py-0.5 text-left text-[9px] leading-tight text-ink hover:bg-primary-soft',
                              statusAccent(row.status),
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="shrink-0 font-bold">{row.advertiser_code ?? '-'}</span>
                              <span className="shrink-0 font-semibold">{row.batch}</span>
                              <span className={cn('shrink-0 rounded-full px-1 py-0 text-[9px] font-semibold', statusChip(row.status))}>{row.product_code}</span>
                              {row.incomplete === true ? <span className="shrink-0 font-bold text-danger" title="Batch/pengiklan belum lengkap">!</span> : null}
                            </span>
                          </button>
                        ))}
                        {dayRows.length > 3 ? (
                          <button
                            type="button"
                            onClick={(clickEvent) => { clickEvent.stopPropagation(); setDayDetail(cell) }}
                            className="rounded-sm px-1 py-0.5 text-left text-[9px] font-semibold text-primary hover:bg-primary-soft"
                          >
                            +{dayRows.length - 3} lainnya
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="mt-4">
        <Card>
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Agenda Deadline {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</h2>
          {agendaRows.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-soft">Belum ada deadline iklan pada bulan ini.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {agendaRows.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => setSelected(row)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-soft lg:flex-nowrap">
                    <span className="w-[122px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-ink">{displayDate(row.deadline_date)}</span>
                    {row.incomplete === true ? <span className="shrink-0 font-bold text-danger" title="Batch/pengiklan belum lengkap">!</span> : null}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{row.advertiser_code ?? '-'} — {row.advertiser_name ?? 'Tanpa pengiklan'} · {row.product_code} · Batch {row.batch}</span>
                    <span className="w-full text-[12px] text-ink-soft lg:w-[180px] lg:shrink-0">{row.publish_date === null ? 'Belum tayang' : `Tayang ${displayDate(row.publish_date)}`}</span>
                    <span className="w-[54px] shrink-0 text-right text-[12px] font-semibold text-ink-soft">{adCalendarScoreText(row)}</span>
                    <Badge tone={statusTone(row.status)}>{adCalendarStatusLabel(row)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={dayDetail !== null}
        title={dayDetail === null ? 'Deadline' : `Deadline ${displayDate(dayDetail)}`}
        onClose={() => setDayDetail(null)}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDayDetail(null)}>Tutup</Button>
            {canManage && dayDetail !== null ? (
              <Button variant="primary" onClick={() => { const date = dayDetail; setDayDetail(null); startCreate(date) }}>
                + Tambah Deadline
              </Button>
            ) : null}
          </div>
        }
      >
        {dayDetailRows.length === 0 ? (
          <p className="text-ink-soft">Tidak ada deadline pada tanggal ini.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {dayDetailRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => { setDayDetail(null); setSelected(row) }}
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 py-2 text-left hover:bg-soft"
                >
                  <Badge tone={statusTone(row.status)}>{adCalendarStatusLabel(row)}</Badge>
                  <span className="shrink-0 text-[12px] font-semibold text-ink">{row.advertiser_code ?? '-'}</span>
                  {row.incomplete === true ? <span className="shrink-0 font-bold text-danger" title="Batch/pengiklan belum lengkap">!</span> : null}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.product_code} · Batch {row.batch}</span>
                  <span className="text-[12px] text-ink-soft">{adCalendarScoreText(row)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={formOpen}
        title={form.id === null ? 'Tambah Deadline Iklan' : 'Edit Deadline Iklan'}
        onClose={() => { if (!saving) setFormOpen(false) }}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Batal</Button>
            <Button variant="primary" loading={saving} onClick={() => void submitForm()}>Simpan</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            id="ad-calendar-event"
            label="Event"
            value={form.event_id}
            placeholder="Pilih event"
            options={eventOptions}
            onChange={(value) => setForm((current) => ({ ...current, event_id: value }))}
            disabled={saving}
          />
          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-ink">Pengiklan</legend>
            <p className="mb-2 text-[11px] text-ink-soft">
              {form.id === null
                ? 'Boleh centang lebih dari satu; tiap pengiklan mendapat deadline sendiri.'
                : 'Centang pengiklan yang ikut deadline ini. Pengiklan yang dicabut centangnya tidak lagi punya deadline untuk batch ini.'}
            </p>
            <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">
              {advertisers.map((advertiser) => {
                const checked = form.advertiserCodes.includes(advertiser.code)
                return (
                  <label key={advertiser.code} className="flex cursor-pointer items-center gap-2 rounded p-1 text-[12px] hover:bg-soft">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={(event) => toggleAdvertiser(advertiser.code, event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-line text-primary focus:ring-primary"
                    />
                    <span className="truncate text-ink">{advertiser.code} — {advertiser.name}</span>
                  </label>
                )
              })}
            </div>
            {advertisers.length === 0 ? <p className="mt-1 text-[12px] text-ink-soft">Belum ada pengiklan aktif.</p> : null}
          </fieldset>
          <div>
            <label htmlFor="ad-calendar-batch" className="mb-1 block text-[12px] font-semibold text-ink">Batch</label>
            <SuggestInput
              id="ad-calendar-batch"
              ariaLabel="Batch"
              value={form.batch}
              placeholder={selectedEvent === undefined ? 'Pilih event dulu untuk saran batch' : 'mis. 392'}
              options={batchSuggestions}
              onChange={(value) => setForm((current) => ({ ...current, batch: value }))}
            />
          </div>
          <TextInput
            id="ad-calendar-deadline"
            label="Tanggal Deadline Tayang"
            type="date"
            value={form.deadline_date}
            onChange={(value) => setForm((current) => ({ ...current, deadline_date: value }))}
            disabled={saving}
          />
          <p className="text-[12px] text-ink-soft">
            Satu deadline berlaku untuk seluruh jadwal dalam batch ini. Tanggal tayang dihitung otomatis
            dari order/lead pertama, atau report spend pertama bila belum ada lead.
          </p>
          {(form.advertiserCodes.length === 0 || form.batch === '?' || form.batch.trim() === '') ? (
            <p className="rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              ! {[form.advertiserCodes.length === 0 ? 'Pengiklan' : null, form.batch === '?' || form.batch.trim() === '' ? 'Batch' : null].filter(Boolean).join(' dan ')} belum lengkap. Lengkapi di sini agar deadline dihitung normal.
            </p>
          ) : null}
          {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          {events.length === 0 ? <p className="text-[12px] text-ink-soft">Belum ada event. Tambahkan event di tab Kalender Event terlebih dahulu.</p> : null}
        </div>
      </Modal>

      <Modal
        open={selected !== null}
        title="Detail Deadline Iklan"
        onClose={() => setSelected(null)}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSelected(null)}>Tutup</Button>
            {canManage && selected !== null ? <Button onClick={() => startEdit(selected)}>Edit</Button> : null}
            {canManage && selected !== null ? <Button variant="danger" onClick={() => setDeleting(selected)}>Hapus</Button> : null}
          </div>
        }
      >
        {selected === null ? null : (
          <>
            {selected.incomplete === true ? (
              <p className="mb-3 rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
                ! Batch/pengiklan belum lengkap. Klik Edit untuk melengkapi.
              </p>
            ) : null}
            <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-[150px_1fr]">
            <dt className="text-ink-soft">Pengiklan</dt>
            <dd className="font-medium text-ink">
              {selected.advertiser_code ?? '-'} - {selected.advertiser_name ?? 'Tanpa pengiklan'}
              {selected.advertiser_code === null ? <span className="ml-1 font-bold text-danger" title="Pengiklan belum diisi">!</span> : null}
            </dd>
            <dt className="text-ink-soft">Produk</dt>
            <dd className="font-medium text-ink">{selected.product_code} — {selected.product_name}</dd>
            <dt className="text-ink-soft">Batch</dt>
            <dd className="font-medium text-ink">
              {selected.batch}
              {selected.batch === '?' ? <span className="ml-1 font-bold text-danger" title="Batch belum diisi">!</span> : null}
            </dd>
            <dt className="text-ink-soft">Event</dt>
            <dd className="font-medium text-ink">
              {selected.event_date === null
                ? 'Event sudah dihapus'
                : `${selected.category ?? '-'} · ${displayDate(selected.event_date)} ${selected.start_time === null ? '' : shortTime(selected.start_time)} · ${selected.location ?? '-'}`}
            </dd>
            <dt className="text-ink-soft">Deadline</dt>
            <dd className="font-medium text-ink">{displayDate(selected.deadline_date)}</dd>
            <dt className="text-ink-soft">Tanggal Tayang</dt>
            <dd className="font-medium text-ink">
              {selected.publish_date === null ? 'Belum terdeteksi' : displayDate(selected.publish_date)}
              {selected.publish_source === null ? '' : selected.publish_source === 'order' ? ' (leads)' : ' (report spend)'}
            </dd>
            <dt className="text-ink-soft">Status</dt>
            <dd><Badge tone={statusTone(selected.status)}>{adCalendarStatusLabel(selected)}</Badge></dd>
            <dt className="text-ink-soft">Skor</dt>
            <dd className="font-medium text-ink">{adCalendarScoreText(selected)}</dd>
          </dl>
          </>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Deadline Iklan"
        onClose={() => { if (!saving) setDeleting(null) }}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" loading={saving} onClick={() => void confirmDelete()}>Hapus</Button>
          </div>
        }
      >
        <p>Hapus deadline <strong>{deleting?.product_code} · Batch {deleting?.batch}</strong> milik {deleting?.advertiser_name ?? 'pengiklan ini'}?</p>
      </Modal>
    </>
  )
}
