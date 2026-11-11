import { useState } from 'react'
import { formatWaDays, WA_DAY_LABELS } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { WaOverview, WaSchedule } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'time', header: 'Jam (WIB)', minWidth: 100 },
  { key: 'template', header: 'Template', minWidth: 150 },
  { key: 'days', header: 'Hari', minWidth: 180 },
  { key: 'rule', header: 'Aturan', minWidth: 210 },
  { key: 'status', header: 'Status', minWidth: 90 },
  { key: 'actions', header: 'Aksi', minWidth: 130 },
]

type FormState = {
  id: string | null
  time: string
  templateId: string
  days: number[]
  onlyIfMissing: boolean
  isActive: boolean
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const EMPTY: FormState = { id: null, time: '09:00', templateId: '', days: [...ALL_DAYS], onlyIfMissing: true, isActive: true }

export function ScheduleSection({ overview, reload }: { overview: WaOverview; reload: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<WaSchedule | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const templateOptions = overview.templates.map((template) => ({
    value: template.id,
    label: `${template.name}${template.is_active ? '' : ' (nonaktif)'}`,
  }))

  function openCreate() {
    setFailure(null)
    setForm({ ...EMPTY })
  }

  function openEdit(schedule: WaSchedule) {
    setFailure(null)
    setForm({
      id: schedule.id,
      time: schedule.execution_time.slice(0, 5),
      templateId: schedule.template_id,
      days: [...schedule.days],
      onlyIfMissing: schedule.only_if_missing_report,
      isActive: schedule.is_active,
    })
  }

  function toggleDay(day: number) {
    setForm((current) => {
      if (current === null) return current
      const days = current.days.includes(day)
        ? current.days.filter((item) => item !== day)
        : [...current.days, day].sort((left, right) => left - right)
      return { ...current, days }
    })
  }

  async function save() {
    if (form === null || busy) return
    if (form.templateId === '') { setFailure('Pilih template pesan terlebih dahulu.'); return }
    if (form.days.length === 0) { setFailure('Pilih minimal satu hari pengiriman.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(form.id === null ? '/api/wa-bot/schedules' : `/api/wa-bot/schedules/${form.id}`, {
        method: form.id === null ? 'POST' : 'PATCH',
        body: {
          execution_time: form.time,
          template_id: form.templateId,
          days: form.days,
          only_if_missing_report: form.onlyIfMissing,
          is_active: form.isActive,
        },
      })
      setForm(null)
      reload()
      toast.show('Jadwal pengingat disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Jadwal gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (deleting === null || busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/wa-bot/schedules/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      reload()
      toast.show('Jadwal dihapus.', 'success')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Jadwal gagal dihapus.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Jadwal Pengingat</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            Jam dibaca sebagai WIB. Pengingat hanya untuk produk yang punya leads kemarin.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ Tambah Jadwal</Button>
      </div>

      <DataTable columns={COLUMNS} maxRows={null}>
        {overview.schedules.map((schedule) => (
          <TableRow key={schedule.id}>
            <TableCell className="font-semibold tabular-nums">{schedule.execution_time.slice(0, 5)}</TableCell>
            <TableCell>{schedule.template_name ?? '-'}</TableCell>
            <TableCell className="text-[12px]">{formatWaDays(schedule.days)}</TableCell>
            <TableCell className="text-[12px]">
              {schedule.only_if_missing_report ? 'Kirim jika laporan D-1 belum diisi' : 'Selalu kirim untuk produk beraktivitas'}
            </TableCell>
            <TableCell>
              <Badge tone={schedule.is_active ? 'success' : 'neutral'}>{schedule.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => openEdit(schedule)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(schedule)}>Hapus</Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      {overview.schedules.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada jadwal. Contoh: 09:00 Template Pagi, 20:00 Template Eskalasi.</p>
      ) : null}

      <Modal
        open={form !== null}
        title={form?.id === null ? 'Tambah Jadwal' : 'Edit Jadwal'}
        onClose={() => { if (!busy) setForm(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setForm(null)}>Batal</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>Simpan</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextInput
            id="wa-schedule-time"
            label="Jam Eksekusi (WIB)"
            type="time"
            value={form?.time ?? '09:00'}
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, time: value })}
          />
          <Select
            id="wa-schedule-template"
            label="Template Pesan"
            value={form?.templateId ?? ''}
            options={templateOptions}
            placeholder="Pilih template"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, templateId: value })}
          />
          <div>
            <p className="mb-1 text-[12px] font-semibold text-ink-soft">Hari Pengiriman</p>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day) => (
                <label key={day} className="flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={form?.days.includes(day) ?? false}
                    disabled={busy}
                    onChange={() => toggleDay(day)}
                  />
                  {WA_DAY_LABELS[day]}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form?.onlyIfMissing ?? true}
              disabled={busy}
              onChange={(event) => setForm((current) => current === null ? current : { ...current, onlyIfMissing: event.target.checked })}
            />
            Kirim hanya jika laporan D-1 untuk produk tersebut belum diisi
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form?.isActive ?? true}
              disabled={busy}
              onChange={(event) => setForm((current) => current === null ? current : { ...current, isActive: event.target.checked })}
            />
            Jadwal aktif
          </label>
          {failure ? <p role="alert" className="text-[12px] text-danger">{failure}</p> : null}
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Jadwal"
        onClose={() => { if (!busy) setDeleting(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Hapus</Button>
          </>
        }
      >
        <p>Hapus jadwal jam <strong>{deleting?.execution_time.slice(0, 5) ?? '-'}</strong>? Riwayat pengiriman tetap tersimpan.</p>
      </Modal>
    </Card>
  )
}
