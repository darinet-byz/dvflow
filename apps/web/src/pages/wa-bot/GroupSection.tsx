import { useMemo, useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { WaGroup, WaOverview } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 180 },
  { key: 'group', header: 'ID Grup Fonnte', minWidth: 150 },
  { key: 'pic', header: 'PIC', minWidth: 160 },
  { key: 'status', header: 'Status', minWidth: 90 },
  { key: 'actions', header: 'Aksi', minWidth: 130 },
]

type FormState = {
  id: string | null
  advertiserId: string
  groupId: string
  phone: string
  picName: string
  isActive: boolean
}

const EMPTY: FormState = { id: null, advertiserId: '', groupId: '', phone: '', picName: '', isActive: true }

export function GroupSection({ overview, reload }: { overview: WaOverview; reload: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<WaGroup | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const mapped = useMemo(() => new Set(overview.groups.map((group) => group.advertiser_id)), [overview.groups])
  const advertiserOptions = overview.advertisers
    .filter((advertiser) => !mapped.has(advertiser.id) || advertiser.id === form?.advertiserId)
    .map((advertiser) => ({
      value: advertiser.id,
      label: `${advertiser.code} — ${advertiser.name}${advertiser.active ? '' : ' (nonaktif)'}`,
    }))

  function openCreate() {
    setFailure(null)
    setForm({ ...EMPTY })
  }

  function openEdit(group: WaGroup) {
    setFailure(null)
    setForm({
      id: group.id,
      advertiserId: group.advertiser_id,
      groupId: group.fonnte_group_id,
      phone: group.pic_phone,
      picName: group.pic_name ?? '',
      isActive: group.is_active,
    })
  }

  async function save() {
    if (form === null || busy) return
    if (form.advertiserId === '') { setFailure('Pilih pengiklan terlebih dahulu.'); return }
    if (form.groupId.trim() === '') { setFailure('ID grup Fonnte wajib diisi.'); return }
    if (form.phone.trim() === '') { setFailure('Nomor WA PIC wajib diisi.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(form.id === null ? '/api/wa-bot/groups' : `/api/wa-bot/groups/${form.id}`, {
        method: form.id === null ? 'POST' : 'PATCH',
        body: {
          advertiser_id: form.advertiserId,
          fonnte_group_id: form.groupId.trim(),
          pic_phone: form.phone.trim(),
          pic_name: form.picName.trim(),
          is_active: form.isActive,
        },
      })
      setForm(null)
      reload()
      toast.show('Grup WhatsApp disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Grup gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (deleting === null || busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/wa-bot/groups/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      reload()
      toast.show('Mapping grup dihapus.', 'success')
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
          <h2 className="text-[15px] font-semibold text-ink">Grup &amp; PIC</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">Satu pengiklan satu grup WhatsApp. Nomor PIC dipakai untuk tag mention.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ Tambah Grup</Button>
      </div>

      <DataTable columns={COLUMNS} maxRows={null}>
        {overview.groups.map((group) => (
          <TableRow key={group.id}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-ink">{group.advertiser_name ?? '-'}</span>
                <span className="text-[11px] text-ink-soft">{group.advertiser_code ?? '-'}</span>
              </div>
            </TableCell>
            <TableCell className="break-all">{group.fonnte_group_id}</TableCell>
            <TableCell>
              <div className="flex flex-col">
                <span>{group.pic_name ?? '-'}</span>
                <span className="text-[11px] text-ink-soft">{group.pic_phone}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge tone={group.is_active ? 'success' : 'neutral'}>{group.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => openEdit(group)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(group)}>Hapus</Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      {overview.groups.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada grup terdaftar. Tambahkan pengiklan, ID grup Fonnte, dan nomor PIC.</p>
      ) : null}

      <Modal
        open={form !== null}
        title={form?.id === null ? 'Tambah Grup WhatsApp' : 'Edit Grup WhatsApp'}
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
            id="wa-group-advertiser"
            label="Pengiklan"
            value={form?.advertiserId ?? ''}
            options={advertiserOptions}
            placeholder="Pilih pengiklan"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, advertiserId: value })}
          />
          <TextInput
            id="wa-group-id"
            label="ID Grup Fonnte"
            value={form?.groupId ?? ''}
            placeholder="Contoh: 12xxxxxxxxxxxxxxxx@g.us"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, groupId: value })}
          />
          <TextInput
            id="wa-group-phone"
            label="Nomor WA PIC"
            value={form?.phone ?? ''}
            placeholder="08xxx atau 628xxx"
            inputMode="tel"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, phone: value })}
          />
          <TextInput
            id="wa-group-pic-name"
            label="Nama PIC (opsional)"
            value={form?.picName ?? ''}
            maxLength={50}
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, picName: value })}
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form?.isActive ?? true}
              disabled={busy}
              onChange={(event) => setForm((current) => current === null ? current : { ...current, isActive: event.target.checked })}
            />
            Bot aktif untuk grup ini
          </label>
          {failure ? <p role="alert" className="text-[12px] text-danger">{failure}</p> : null}
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Mapping Grup"
        onClose={() => { if (!busy) setDeleting(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Hapus</Button>
          </>
        }
      >
        <p>
          Hapus grup untuk <strong>{deleting?.advertiser_name ?? '-'}</strong>? Riwayat pengiriman tetap tersimpan,
          tetapi pengingat berhenti untuk pengiklan ini.
        </p>
      </Modal>
    </Card>
  )
}
