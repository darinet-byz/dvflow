import { useEffect, useMemo, useState } from 'react'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatMoney, formatTime } from '../../lib/format'
import { Button } from '../../ui/Button'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Drawer } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Pendaftaran peserta OTS — bayar di lokasi seminar (A29).
 *
 * Dibuat untuk meja registrasi yang ramai: tanpa mencari order Pending. Acara dan nominal
 * diingat per perangkat (satu meja = satu acara), jadi tiap peserta cukup nama + metode bayar.
 * Simpan = order baru Paid + langsung check-in (server: RPC save_ots_registration).
 */
export type OtsEvent = {
  key: string
  product_code: string
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  event_type: string
}

type OtsRow = {
  order_id: string
  name: string | null
  phone: string | null
  product_code: string | null
  product_name: string | null
  batch: string | null
  session: string | null
  city: string | null
  event_type: string | null
  gross_amount: number
  payment_method: string | null
  created_at: string
  collected_by: string | null
}

export const OTS_METHOD_OPTIONS = [
  { value: 'ots_tunai', label: 'Tunai' },
  { value: 'ots_transfer', label: 'Transfer' },
  { value: 'ots_qris', label: 'QRIS' },
] as const
const METHOD_LABEL: Record<string, string> = Object.fromEntries(OTS_METHOD_OPTIONS.map((item) => [item.value, item.label]))

const STORAGE_EVENT = 'dvflow.ots.event'
const STORAGE_AMOUNT = 'dvflow.ots.amount'

function remember(key: string): string {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}
function store(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* penyimpanan diblokir: tetap jalan tanpa ingatan */ }
}

export function describeEvent(event: Pick<OtsEvent, 'product_code' | 'product_name' | 'batch' | 'session' | 'city'>): string {
  return [event.product_name ?? event.product_code, event.batch ? `Batch ${event.batch}` : null, event.session, event.city]
    .filter(Boolean)
    .join(' · ')
}

export function OtsDrawer({ open, onClose, canDelete }: { open: boolean; onClose: () => void; canDelete: boolean }) {
  const toast = useToast()
  const [eventKey, setEventKey] = useState(() => remember(STORAGE_EVENT))
  const [amount, setAmount] = useState(() => remember(STORAGE_AMOUNT))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [method, setMethod] = useState<string>('ots_tunai')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const events = useAsyncData(() => (open ? authorizedRequest<{ events: OtsEvent[] }>('/api/ots/events') : Promise.resolve(null)), [open])
  const list = useAsyncData(() => (open ? authorizedRequest<{ rows: OtsRow[] }>('/api/ots') : Promise.resolve(null)), [open, refresh])

  const eventList = useMemo(() => events.data?.events ?? [], [events.data])
  const selected = eventList.find((item) => item.key === eventKey) ?? null
  // Acara tersimpan sudah tidak ada (mis. lewat 30 hari): kosongkan supaya petugas memilih ulang.
  useEffect(() => {
    if (events.data && eventKey !== '' && !eventList.some((item) => item.key === eventKey)) setEventKey('')
  }, [events.data, eventKey, eventList])

  function resetPerson() {
    setName('')
    setPhone('')
    setMethod('ots_tunai')
    setEditingId(null)
    setFailure(null)
  }

  async function save() {
    if (busy) return
    const parsedAmount = Number(amount.replace(/[^\d]/g, ''))
    if (selected === null) { setFailure('Pilih acara terlebih dahulu.'); return }
    if (name.trim() === '') { setFailure('Nama peserta wajib diisi.'); return }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setFailure('Nominal harus lebih dari 0.'); return }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/ots', {
        method: 'POST',
        body: {
          ...(editingId ? { order_id: editingId } : {}),
          name: name.trim(),
          phone: phone.trim(),
          product_code: selected.product_code,
          batch: selected.batch ?? '',
          session: selected.session ?? '',
          city: selected.city ?? '',
          event_type: selected.event_type,
          amount: parsedAmount,
          method,
        },
      })
      store(STORAGE_EVENT, selected.key)
      store(STORAGE_AMOUNT, String(parsedAmount))
      toast.show(editingId ? 'Data OTS diperbarui.' : 'OTS tersimpan · peserta hadir', 'success')
      resetPerson()
      setRefresh((value) => value + 1)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'OTS gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row: OtsRow) {
    const match = eventList.find((item) =>
      item.product_code === row.product_code && (item.batch ?? '') === (row.batch ?? '') &&
      (item.session ?? '') === (row.session ?? '') && (item.city ?? '') === (row.city ?? '') && item.event_type === row.event_type)
    if (match) setEventKey(match.key)
    setEditingId(row.order_id)
    setName(row.name ?? '')
    setPhone(row.phone ?? '')
    setAmount(String(Math.round(row.gross_amount)))
    setMethod(row.payment_method ?? 'ots_tunai')
    setFailure(null)
  }

  async function remove(row: OtsRow) {
    if (busy || !window.confirm(`Hapus pendaftaran OTS ${row.name ?? row.order_id}?`)) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/ots/${encodeURIComponent(row.order_id)}`, { method: 'DELETE' })
      toast.show('Pendaftaran OTS dihapus.', 'success')
      if (editingId === row.order_id) resetPerson()
      setRefresh((value) => value + 1)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Gagal menghapus OTS.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const rows = list.data?.rows ?? []
  const total = rows.reduce((sum, row) => sum + row.gross_amount, 0)

  return (
    <Drawer open={open} title="Peserta OTS (Bayar di Lokasi)" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="text-[12px] text-ink-soft">
          Untuk peserta yang membayar di lokasi. Simpan = tercatat Paid (1 tiket) dan langsung hadir. Tidak mengubah data OrderOnline.
        </p>
        {events.error ? <ErrorState message={events.error} action={<Button onClick={events.reload}>Coba lagi</Button>} /> : null}
        <Select
          id="ots-event"
          label="Acara"
          value={eventKey}
          placeholder={events.loading ? 'Memuat acara…' : 'Pilih acara seminar'}
          options={eventList.map((item) => ({ value: item.key, label: describeEvent(item) }))}
          disabled={busy}
          onChange={setEventKey}
        />
        <TextInput id="ots-name" label="Nama peserta" value={name} onChange={setName} disabled={busy} autoComplete="off" maxLength={200} />
        <TextInput id="ots-phone" label="No WA (opsional)" value={phone} onChange={setPhone} disabled={busy} inputMode="tel" autoComplete="off" maxLength={32} />
        <TextInput id="ots-amount" label="Nominal (Rp)" value={amount} onChange={setAmount} disabled={busy} inputMode="numeric" placeholder="150000" />
        <div>
          <p className="mb-1 text-[12px] font-semibold text-ink">Metode bayar</p>
          <div role="radiogroup" aria-label="Metode bayar" className="grid grid-cols-3 gap-2">
            {OTS_METHOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={method === option.value}
                disabled={busy}
                onClick={() => setMethod(option.value)}
                className={cn(
                  'h-10 rounded-sm border text-[13px] font-semibold',
                  method === option.value ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-card text-ink hover:bg-soft',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {failure ? <p role="alert" className="text-[12px] text-danger">{failure}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy}>
            {editingId ? 'Simpan perubahan' : 'Simpan & Check-in'}
          </Button>
          {editingId ? <Button disabled={busy} onClick={resetPerson}>Batal edit</Button> : null}
        </div>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">OTS hari ini</p>
          <p className="text-[12px] text-ink-soft">{rows.length} peserta · {formatMoney(total)}</p>
        </div>
        {list.error ? <ErrorState message={list.error} action={<Button onClick={list.reload}>Coba lagi</Button>} /> : null}
        {list.loading && list.data === null ? <SkeletonRows rows={3} /> : null}
        {list.data !== null && rows.length === 0 ? <p className="mt-2 text-[12px] text-ink-soft">Belum ada pendaftaran OTS hari ini.</p> : null}
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.order_id} className={cn('rounded-md border border-line p-2.5', editingId === row.order_id && 'border-primary')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{row.name ?? '-'}</p>
                  <p className="truncate text-[11px] text-ink-soft">{describeEvent({ ...row, product_code: row.product_code ?? '' })}</p>
                  <p className="text-[11px] text-ink-soft">
                    {formatMoney(row.gross_amount)} · {METHOD_LABEL[row.payment_method ?? ''] ?? row.payment_method} · {formatTime(row.created_at)}
                    {row.collected_by ? ` · ${row.collected_by}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" disabled={busy} onClick={() => startEdit(row)}>Edit</Button>
                  {canDelete ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(row)}>Hapus</Button> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  )
}
