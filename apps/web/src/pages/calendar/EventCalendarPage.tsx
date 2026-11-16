import { useMemo, useState } from 'react'
import {
  EVENT_CATEGORIES,
  createEventCalendar,
  deleteEventCalendar,
  fetchEventCalendar,
  shortTime,
  updateEventCalendar,
  type CalendarEvent,
  type SaveEventInput,
} from '../../lib/event-calendar'
import { MONTH_NAMES, WEEKDAYS, monthGrid, toIsoDate } from '../../lib/date-range'
import { hasPermission } from '../../lib/roles'
import { useAsyncData } from '../../lib/useAsyncData'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Badge, type BadgeTone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

const CATEGORY_OPTIONS = EVENT_CATEGORIES.map((category) => ({ value: category, label: category }))

type EventForm = SaveEventInput

function emptyForm(eventDate: string): EventForm {
  return { product_code: '', category: 'Seminar', event_date: eventDate, start_time: '', location: '' }
}

function categoryTone(category: string): BadgeTone {
  if (category === 'Seminar') return 'danger'
  if (category === 'Webinar') return 'webinar'
  return 'warning'
}

function categoryAccent(category: string): string {
  if (category === 'Seminar') return 'border-l-danger'
  if (category === 'Webinar') return 'border-l-webinar'
  return 'border-l-warning'
}

function categoryDot(category: string): string {
  if (category === 'Seminar') return 'bg-danger'
  if (category === 'Webinar') return 'bg-webinar'
  return 'bg-warning'
}

function categoryChip(category: string): string {
  if (category === 'Seminar') return 'bg-danger-soft text-danger'
  if (category === 'Webinar') return 'bg-webinar-soft text-webinar'
  return 'bg-warning-soft text-[#c78a21]'
}

function displayDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`
}

/**
 * Kalender Event (A79).
 *
 * Menampilkan jadwal Seminar / Webinar / Workshop dalam tampilan bulan plus
 * agenda. Pemegang izin kelola dapat menambah, mengubah, dan menghapus.
 */
export function EventCalendarPage() {
  const { profile } = useSession()
  const toast = useToast()
  const canManage = hasPermission(profile, 'action.manage_event_calendar')

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [form, setForm] = useState<EventForm>(() => emptyForm(toIsoDate(new Date())))
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)
  const [dayDetail, setDayDetail] = useState<string | null>(null)

  const from = toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1))
  const to = toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))
  const { data, loading, error, reload } = useAsyncData(
    () => fetchEventCalendar(from, to),
    [from, to],
  )

  const events = data?.events ?? []
  const products = data?.products ?? []
  const cells = useMemo(() => monthGrid(month.getFullYear(), month.getMonth()), [month])
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const list = map.get(event.event_date) ?? []
      list.push(event)
      map.set(event.event_date, list)
    }
    return map
  }, [events])

  const dayDetailEvents = dayDetail === null ? [] : (eventsByDate.get(dayDetail) ?? [])
  const agendaEvents = useMemo(() => {
    return [...events].sort((left, right) => {
      const byDate = left.event_date.localeCompare(right.event_date)
      if (byDate !== 0) return byDate
      const byProduct = left.product_code.localeCompare(right.product_code, 'id')
      if (byProduct !== 0) return byProduct
      return left.start_time.localeCompare(right.start_time)
    })
  }, [events])

  const productOptions = products.map((product) => ({ value: product.code, label: `${product.code} — ${product.name}` }))
  const today = toIsoDate(new Date())

  function shiftMonth(delta: number): void {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  function startCreate(eventDate: string): void {
    setEditing(null)
    setForm(emptyForm(eventDate))
    setFormError(null)
    setFormOpen(true)
  }

  function startEdit(event: CalendarEvent): void {
    setEditing(event)
    setForm({
      product_code: event.product_code,
      category: event.category,
      event_date: event.event_date,
      start_time: shortTime(event.start_time),
      location: event.location,
    })
    setFormError(null)
    setSelected(null)
    setFormOpen(true)
  }

  async function submitForm(): Promise<void> {
    if (saving) return
    if (form.product_code === '') { setFormError('Pilih produk.'); return }
    if (form.category === '') { setFormError('Pilih jenis acara.'); return }
    if (form.event_date === '') { setFormError('Tanggal wajib diisi.'); return }
    if (form.start_time === '') { setFormError('Jam mulai wajib diisi.'); return }
    if (form.location.trim() === '') { setFormError('Lokasi / platform wajib diisi.'); return }

    setSaving(true)
    setFormError(null)
    try {
      const payload = { ...form, location: form.location.trim() }
      if (editing === null) await createEventCalendar(payload)
      else await updateEventCalendar(editing.id, payload)
      toast.show(editing === null ? 'Event ditambahkan ke kalender.' : 'Event diperbarui.', 'success')
      setFormOpen(false)
      setEditing(null)
      reload()
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Event gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting === null || saving) return
    setSaving(true)
    try {
      await deleteEventCalendar(deleting.id)
      toast.show('Event dihapus dari kalender.', 'success')
      setDeleting(null)
      setSelected(null)
      reload()
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Event gagal dihapus.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Kalender Event"
        description="Jadwal Seminar, Webinar, dan Workshop per produk."
        action={canManage ? <Button variant="primary" onClick={() => startCreate(today)}>+ Tambah Event</Button> : undefined}
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">‹</Button>
            <p className="min-w-[150px] text-center text-[15px] font-semibold text-ink">{MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</p>
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(1)} aria-label="Bulan berikutnya">›</Button>
            <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hari Ini</Button>
          </div>
          <p className="text-[12px] text-ink-muted">{events.length} event bulan ini</p>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
          {EVENT_CATEGORIES.map((category) => (
            <span key={category} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', categoryDot(category))} />
              {category}
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
                  const dayEvents = eventsByDate.get(cell) ?? []
                  const isToday = cell === today
                  return (
                    <div
                      key={cell}
                      onClick={dayEvents.length > 0 ? () => setDayDetail(cell) : canManage ? () => startCreate(cell) : undefined}
                      title={dayEvents.length > 0 ? 'Lihat semua event hari ini' : canManage ? 'Klik untuk menambah event' : undefined}
                      className={cn(
                        'min-h-[92px] rounded-md border p-1.5 transition-colors',
                        isToday ? 'border-primary bg-primary-soft/40' : 'border-line bg-card',
                        (canManage || dayEvents.length > 0) ? 'cursor-pointer hover:border-primary/40' : '',
                      )}
                    >
                      <p className={cn('mb-1 text-[11px] font-semibold', isToday ? 'text-primary' : 'text-ink-soft')}>{Number(cell.slice(8))}</p>
                      <div className="flex flex-col gap-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelected(event) }}
                            className={cn(
                              'rounded-sm border-l-[3px] bg-soft px-1 py-0.5 text-left text-[9px] leading-tight text-ink hover:bg-primary-soft',
                              categoryAccent(event.category),
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="shrink-0 font-bold">{event.product_code}</span>
                              <span className={cn('shrink-0 rounded-full px-1 py-0 text-[9px] font-semibold', categoryChip(event.category))}>{event.category}</span>
                            </span>
                          </button>
                        ))}
                        {dayEvents.length > 3 ? (
                          <button
                            type="button"
                            onClick={(clickEvent) => { clickEvent.stopPropagation(); setDayDetail(cell) }}
                            className="rounded-sm px-1 py-0.5 text-left text-[9px] font-semibold text-primary hover:bg-primary-soft"
                          >
                            +{dayEvents.length - 3} lainnya
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
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Agenda {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</h2>
          {events.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-soft">Belum ada event pada bulan ini.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {agendaEvents.map((event) => (
                <li key={event.id}>
                  <button type="button" onClick={() => setSelected(event)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-soft lg:flex-nowrap">
                    <span className="w-[122px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-ink">{displayDate(event.event_date)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{event.product_code} — {event.product_name}</span>
                    <span className="w-full break-words text-[12px] text-ink-soft lg:w-[42ch] lg:min-w-[260px] lg:shrink-0">{event.location}</span>
                    <span className="w-[46px] shrink-0 text-right text-[12px] text-ink-soft">{shortTime(event.start_time)}</span>
                    <Badge tone={categoryTone(event.category)}>{event.category}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={dayDetail !== null}
        title={dayDetail === null ? 'Event' : `Event ${displayDate(dayDetail)}`}
        onClose={() => setDayDetail(null)}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDayDetail(null)}>Tutup</Button>
            {canManage && dayDetail !== null ? (
              <Button
                variant="primary"
                onClick={() => { const date = dayDetail; setDayDetail(null); startCreate(date) }}
              >
                + Tambah Event
              </Button>
            ) : null}
          </div>
        }
      >
        {dayDetailEvents.length === 0 ? (
          <p className="text-ink-soft">Tidak ada event pada tanggal ini.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {dayDetailEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => { setDayDetail(null); setSelected(event) }}
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 py-2 text-left hover:bg-soft"
                >
                  <span className="w-[46px] shrink-0 text-[12px] font-semibold text-ink">{shortTime(event.start_time)}</span>
                  <Badge tone={categoryTone(event.category)}>{event.category}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{event.product_code} — {event.product_name}</span>
                  <span className="w-full truncate text-[12px] text-ink-soft sm:w-auto">{event.location}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={formOpen}
        title={editing === null ? 'Tambah Event' : 'Edit Event'}
        onClose={() => { if (!saving) setFormOpen(false) }}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Batal</Button>
            <Button variant="primary" loading={saving} onClick={() => void submitForm()}>Simpan</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Select id="event-product" label="Nama Produk" value={form.product_code} placeholder="Pilih produk" options={productOptions} onChange={(value) => setForm((current) => ({ ...current, product_code: value }))} disabled={saving} />
          <Select id="event-category" label="Jenis Acara" value={form.category} options={CATEGORY_OPTIONS} onChange={(value) => setForm((current) => ({ ...current, category: value }))} disabled={saving} />
          <TextInput id="event-date" label="Tanggal" type="date" value={form.event_date} onChange={(value) => setForm((current) => ({ ...current, event_date: value }))} disabled={saving} />
          <TextInput id="event-time" label="Jam Mulai" type="time" value={form.start_time} onChange={(value) => setForm((current) => ({ ...current, start_time: value }))} disabled={saving} />
          <TextInput id="event-location" label="Lokasi / Platform" value={form.location} onChange={(value) => setForm((current) => ({ ...current, location: value }))} maxLength={200} placeholder="mis. Hotel Solo / Zoom" disabled={saving} />
          {formError === null ? null : <p className="text-[12px] text-danger">{formError}</p>}
          {products.length === 0 ? <p className="text-[12px] text-ink-soft">Belum ada produk aktif. Tambahkan produk terlebih dahulu di Konfigurasi Produk.</p> : null}
        </div>
      </Modal>

      <Modal
        open={selected !== null}
        title="Detail Event"
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
          <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-[110px_1fr]">
            <dt className="text-ink-soft">Produk</dt><dd className="font-medium text-ink">{selected.product_code} — {selected.product_name}</dd>
            <dt className="text-ink-soft">Jenis Acara</dt><dd><Badge tone={categoryTone(selected.category)}>{selected.category}</Badge></dd>
            <dt className="text-ink-soft">Tanggal</dt><dd className="font-medium text-ink">{displayDate(selected.event_date)}</dd>
            <dt className="text-ink-soft">Jam Mulai</dt><dd className="font-medium text-ink">{shortTime(selected.start_time)} WIB</dd>
            <dt className="text-ink-soft">Lokasi / Platform</dt><dd className="break-words font-medium text-ink">{selected.location}</dd>
          </dl>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Event"
        onClose={() => { if (!saving) setDeleting(null) }}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" loading={saving} onClick={() => void confirmDelete()}>Hapus</Button>
          </div>
        }
      >
        <p>Hapus event <strong>{deleting?.product_name}</strong> ({deleting?.category}) pada {deleting ? displayDate(deleting.event_date) : ''}?</p>
      </Modal>
    </>
  )
}
