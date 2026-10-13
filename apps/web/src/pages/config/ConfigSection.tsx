import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from '../../lib/api'
import { authorizedRequest } from '../../lib/session'
import { supabaseSelect } from '../../lib/supabase-rest'
import { useAsyncData } from '../../lib/useAsyncData'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { SearchInput, Select, TextInput, type SelectOption } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

/**
 * Satu bagian CRUD konfigurasi (PRD §62–§63).
 *
 * Pola yang sama dipakai kelima sumber daya, sehingga Perilaku "Tambah / Edit /
 * Nonaktifkan / Status" tidak berbeda-beda antar layar.
 *
 * Dua aturan yang dipegang:
 *   * **`Delete` berarti menonaktifkan**, bukan menghapus (01 §8, 03 §12).
 *     Baris tetap ada supaya order lama masih dapat dijelaskan; karena itu
 *     aksinya disebut "Nonaktifkan" dan barisnya tetap terlihat dengan status
 *     nonaktif — bukan hilang dari tabel.
 *   * Pengurutan/pencarian di sisi klien. Tabel konfigurasi adalah data acuan
 *     yang jumlahnya kecil dan sudah dibaca utuh untuk pilihan filter; aturan
 *     "jangan memuat seluruh database" (CLAUDE.md §14) menyasar data operasional
 *     yang tidak terbatas (Order, Presensi), bukan daftar kode yang berpuluh baris.
 */
export type ConfigRow = Record<string, unknown>

export type ConfigField = {
  key: string
  label: string
  type: 'text' | 'select' | 'number'
  placeholder?: string
  options?: readonly SelectOption[]
  help?: string
  /** Nilai awal untuk form tambah. */
  initial: string
}

export type ConfigSpec = {
  resource: 'products' | 'advertisers' | 'event-types' | 'sessions' | 'payment-fee-rules'
  title: string
  description: string
  tableName: string
  readColumns: string
  fields: readonly ConfigField[]
  columns: readonly TableColumn[]
  render: Record<string, (row: ConfigRow) => ReactNode>
  /** Kunci yang ditampilkan sebagai identitas utama baris. */
  identityKey: string
}

export function ConfigSection({ spec }: { spec: ConfigSpec }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ConfigRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<ConfigRow | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsyncData(
    () => supabaseSelect<ConfigRow>(spec.tableName, {}, spec.readColumns),
    [spec.tableName],
  )

  const rows = useMemo(() => {
    const all = data ?? []
    const term = search.trim().toLowerCase()
    const filtered =
      term === ''
        ? all
        : all.filter((row) =>
            Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(term)),
          )

    // Aktif lebih dulu, lalu menurut identitas — daftar panjang tetap terbaca.
    return [...filtered].sort((left, right) => {
      const activeDiff = Number(right['active'] === true) - Number(left['active'] === true)
      if (activeDiff !== 0) return activeDiff
      return String(left[spec.identityKey]).localeCompare(String(right[spec.identityKey]), 'id')
    })
  }, [data, search, spec.identityKey])

  async function submit(formValues: Record<string, string>, target: ConfigRow | null): Promise<void> {
    setBusy(true)

    // Field angka dikirim sebagai angka; string kosong dibiarkan kosong supaya
    // server yang menolaknya dengan pesan yang jelas, bukan diam-diam menjadi 0.
    const body: Record<string, unknown> = {}
    for (const field of spec.fields) {
      const raw = formValues[field.key] ?? ''
      body[field.key] = field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw
    }

    try {
      if (target === null) {
        await authorizedRequest(`/api/config/${spec.resource}`, { method: 'POST', body })
        toast.show(`${spec.title} ditambahkan.`, 'success')
      } else {
        await authorizedRequest(`/api/config/${spec.resource}/${String(target['id'])}`, {
          method: 'PATCH',
          body,
        })
        toast.show(`${spec.title} diperbarui.`, 'success')
      }

      setAdding(false)
      setEditing(null)
      reload()
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Perubahan tidak dapat disimpan.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(row: ConfigRow): Promise<void> {
    setBusy(true)
    try {
      await authorizedRequest(`/api/config/${spec.resource}/${String(row['id'])}`, { method: 'DELETE' })
      toast.show(`${spec.title} dinonaktifkan.`, 'success')
      setConfirming(null)
      reload()
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Tidak dapat menonaktifkan.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(row: ConfigRow): Promise<void> {
    setBusy(true)
    try {
      await authorizedRequest(`/api/config/${spec.resource}/${String(row['id'])}`, {
        method: 'PATCH',
        body: { active: true },
      })
      toast.show(`${spec.title} diaktifkan kembali.`, 'success')
      reload()
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Tidak dapat mengaktifkan.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <CardHeader title={spec.title} description={spec.description} />
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <SearchInput
            id={`config-search-${spec.resource}`}
            value={search}
            onChange={setSearch}
            placeholder="Cari nama atau kode"
          />
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Tambah
          </Button>
        </div>
      </div>

      {error === null ? null : (
        <div className="p-4">
          <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
        </div>
      )}

      {loading && data === null ? (
        <div className="p-4">
          <SkeletonRows rows={4} />
        </div>
      ) : (
        <>
          <DataTable columns={[...spec.columns, { key: 'actions', header: 'Aksi' }]} exportConfig={{ filename: spec.resource, loadRows: () => rows, disabled: loading || error !== null }}>
            {rows.map((row) => (
              <TableRow key={String(row['id'])}>
                {spec.columns.map((column) => (
                  <TableCell key={column.key} align={column.align}>
                    {spec.render[column.key]?.(row) ?? String(row[column.key] ?? '-')}
                  </TableCell>
                ))}
                <TableCell align="right">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                    {row['active'] === true ? (
                      <Button size="sm" variant="danger" onClick={() => setConfirming(row)}>
                        Nonaktifkan
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reactivate(row)}>
                        Aktifkan
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>

          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-ink-soft">
              {search.trim() === '' ? 'Belum ada data.' : 'Tidak ada yang cocok dengan pencarian.'}
            </p>
          ) : null}
        </>
      )}

      <ConfigForm
        open={adding || editing !== null}
        spec={spec}
        target={editing}
        busy={busy}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSubmit={(values) => void submit(values, editing)}
      />

      <Modal
        open={confirming !== null}
        title={`Nonaktifkan ${spec.title}`}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button onClick={() => setConfirming(null)}>Batal</Button>
            <Button variant="danger" loading={busy} onClick={() => confirming !== null && void deactivate(confirming)}>
              Nonaktifkan
            </Button>
          </>
        }
      >
        <p>
          Baris ini tidak dihapus, hanya dinonaktifkan: ia tidak lagi ditawarkan pada pemilih dan
          generator, tetapi order lama yang memakainya tetap dapat dijelaskan.
        </p>
      </Modal>
    </Card>
  )
}

/**
 * Form tambah/edit di dalam modal.
 *
 * Modal, bukan form panjang di halaman (PRD §62), dan bentuknya sama untuk
 * kelima sumber daya: nama + kode (+ kolom khusus bila ada, mis. `kind` untuk
 * event type atau tipe/nilai untuk fee rule).
 *
 * Nilai form adalah keadaan terkendali (controlled), bukan `FormData`: nilai
 * awal harus berasal dari baris yang sedang diedit, dan mengubahnya harus
 * terlihat langsung di layar.
 */
function ConfigForm({
  open,
  spec,
  target,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  spec: ConfigSpec
  target: ConfigRow | null
  busy: boolean
  onClose: () => void
  onSubmit: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(spec, target))

  // Form diisi ulang setiap kali modal dibuka atau baris yang diedit berganti.
  useEffect(() => {
    setValues(initialValues(spec, target))
  }, [open, target, spec])

  return (
    <Modal
      open={open}
      title={target === null ? `Tambah ${spec.title}` : `Edit ${spec.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" type="submit" form={`config-form-${spec.resource}`} loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form
        id={`config-form-${spec.resource}`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(values)
        }}
      >
        {spec.fields.map((field) => {
          const value = values[field.key] ?? ''
          const update = (next: string): void => setValues((current) => ({ ...current, [field.key]: next }))

          if (field.type === 'select') {
            return (
              <div key={field.key}>
                <Select
                  id={`config-${spec.resource}-${field.key}`}
                  label={field.label}
                  value={value}
                  options={field.options ?? []}
                  onChange={update}
                />
                {field.help === undefined ? null : (
                  <p className="mt-1 text-[11px] text-ink-muted">{field.help}</p>
                )}
              </div>
            )
          }

          return (
            <div key={field.key}>
              <TextInput
                id={`config-${spec.resource}-${field.key}`}
                label={field.label}
                value={value}
                placeholder={field.placeholder}
                onChange={update}
              />
              {field.help === undefined ? null : (
                <p className="mt-1 text-[11px] text-ink-muted">{field.help}</p>
              )}
            </div>
          )
        })}
      </form>
    </Modal>
  )
}

function initialValues(spec: ConfigSpec, target: ConfigRow | null): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of spec.fields) {
    const current = target?.[field.key]
    values[field.key] = current === undefined || current === null ? field.initial : String(current)
  }
  return values
}
