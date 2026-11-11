import { useState } from 'react'
import {
  renderWaTemplate,
  validateWaTemplate,
  WA_TEMPLATE_PLACEHOLDERS,
  WA_TEMPLATE_MAX_LENGTH,
} from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, Textarea } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { WaOverview, WaTemplate } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'name', header: 'Nama Template', minWidth: 150 },
  { key: 'content', header: 'Isi Pesan', minWidth: 320 },
  { key: 'status', header: 'Status', minWidth: 90 },
  { key: 'actions', header: 'Aksi', minWidth: 130 },
]

const PREVIEW_VALUES = {
  mention: '628123456789',
  store_name: 'Toko Contoh',
  product_name: 'Kuliner Masteri',
  leads: 12,
  paid: 3,
  report_url: 'https://dvflow.pages.dev/report-spend?advertiserCode=01&productCode=KM',
}

type FormState = { id: string | null; name: string; content: string; isActive: boolean }
const EMPTY: FormState = { id: null, name: '', content: '', isActive: true }

export function TemplateSection({ overview, reload }: { overview: WaOverview; reload: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<WaTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  function openCreate() {
    setFailure(null)
    setForm({ ...EMPTY, content: 'Halo {{mention}}, laporan iklan {{store_name}} untuk produk {{product_name}} belum diisi.\nLeads kemarin: {{leads}}, Paid: {{paid}}.\nInput di sini: {{report_url}}' })
  }

  function openEdit(template: WaTemplate) {
    setFailure(null)
    setForm({ id: template.id, name: template.name, content: template.message_content, isActive: template.is_active })
  }

  function appendPlaceholder(placeholder: string) {
    setForm((current) => current === null ? current : { ...current, content: `${current.content}{{${placeholder}}}` })
  }

  async function save() {
    if (form === null || busy) return
    const validation = validateWaTemplate(form.content)
    if (!validation.ok) { setFailure(validation.message); return }
    if (form.name.trim() === '') { setFailure('Nama template wajib diisi.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(form.id === null ? '/api/wa-bot/templates' : `/api/wa-bot/templates/${form.id}`, {
        method: form.id === null ? 'POST' : 'PATCH',
        body: { name: form.name.trim(), message_content: form.content, is_active: form.isActive },
      })
      setForm(null)
      reload()
      toast.show('Template pesan disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Template gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (deleting === null || busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/wa-bot/templates/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      reload()
      toast.show('Template dihapus.', 'success')
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Template gagal dihapus.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Template Pesan</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">Gunakan placeholder agar isi pesan menyesuaikan pengiklan dan produk.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ Tambah Template</Button>
      </div>

      <DataTable columns={COLUMNS} maxRows={null}>
        {overview.templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell className="font-medium">{template.name}</TableCell>
            <TableCell>
              <p className="line-clamp-2 max-w-[420px] whitespace-pre-line text-[12px] text-ink-soft">{template.message_content}</p>
            </TableCell>
            <TableCell>
              <Badge tone={template.is_active ? 'success' : 'neutral'}>{template.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => openEdit(template)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(template)}>Hapus</Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      {overview.templates.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada template. Buat satu template pagi, siang, atau eskalasi.</p>
      ) : null}

      {form !== null ? (
        <section aria-label={form.id === null ? 'Tambah Template' : 'Edit Template'} className="mb-3 rounded-sm border border-line p-3">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{form.id === null ? 'Tambah Template' : 'Edit Template'}</h3>
          <div className="flex flex-col gap-3">
          <TextInput
            id="wa-template-name"
            label="Nama Template"
            value={form?.name ?? ''}
            maxLength={50}
            placeholder="Contoh: Template Pagi"
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, name: value })}
          />
          <Textarea
            id="wa-template-content"
            label="Isi Pesan"
            value={form?.content ?? ''}
            rows={8}
            maxLength={WA_TEMPLATE_MAX_LENGTH}
            disabled={busy}
            onChange={(value) => setForm((current) => current === null ? current : { ...current, content: value })}
          />
          <div className="flex flex-wrap gap-1.5">
            {WA_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                disabled={busy}
                onClick={() => appendPlaceholder(placeholder)}
                className="rounded-full bg-primary-soft px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
              >
                {`{{${placeholder}}}`}
              </button>
            ))}
          </div>
          <div className="rounded-sm border border-line bg-soft p-2.5">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Preview</p>
            <p className="whitespace-pre-line text-[12px] text-ink">{renderWaTemplate(form?.content ?? '', PREVIEW_VALUES)}</p>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form?.isActive ?? true}
              disabled={busy}
              onChange={(event) => setForm((current) => current === null ? current : { ...current, isActive: event.target.checked })}
            />
            Template aktif
          </label>
            {failure ? <p role="alert" className="text-[12px] text-danger">{failure}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={() => void save()}>Simpan</Button>
              <Button disabled={busy} onClick={() => setForm(null)}>Batal</Button>
            </div>
          </div>
        </section>
      ) : null}

      <Modal
        open={deleting !== null}
        title="Hapus Template"
        onClose={() => { if (!busy) setDeleting(null) }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Hapus</Button>
          </>
        }
      >
        <p>Hapus template <strong>{deleting?.name ?? '-'}</strong>? Template yang masih dipakai jadwal tidak dapat dihapus.</p>
      </Modal>
    </Card>
  )
}
