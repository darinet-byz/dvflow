import { useEffect, useMemo, useState } from 'react'
import { OTS_MAX_QUANTITY, OTS_UNIT_PRICE_OPTIONS } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { fetchOtsReferenceData, type OtsReferenceData } from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatMoney, formatTime } from '../../lib/format'
import { Button } from '../../ui/Button'
import { Combobox } from '../../ui/Combobox'
import { Select, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Drawer } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Pendaftaran peserta OTS — bayar di lokasi seminar (A29, disederhanakan di A34).
 *
 * Dibuat untuk meja registrasi yang ramai:
 *   * konteks acara (produk + batch + sesi + kota) diisi SEKALI per perangkat;
 *   * produk dicari lewat combobox, bukan dropdown 200 item;
 *   * peserta cukup nama, No HP, jumlah tiket, harga per tiket, dan metode;
 *   * total = harga per tiket x jumlah tiket, dihitung server saat disimpan;
 *   * simpan = order baru Paid + langsung check-in.
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
  quantity?: number
  gross_amount: number
  payment_method: string | null
  created_at: string
  collected_by: string | null
}

type OtsContext = {
  productCode: string
  batch: string
  session: string
  city: string
}

export const OTS_METHOD_OPTIONS = [
  { value: 'ots_tunai', label: 'Tunai' },
  { value: 'ots_transfer', label: 'Bank Transfer' },
  { value: 'ots_qris', label: 'QRIS' },
] as const
const METHOD_LABEL: Record<string, string> = Object.fromEntries(OTS_METHOD_OPTIONS.map((item) => [item.value, item.label]))
const METHOD_VALUES = OTS_METHOD_OPTIONS.map((item) => item.value) as readonly string[]

const STORAGE_CONTEXT = 'dvflow.ots.context'
const STORAGE_PRICE = 'dvflow.ots.price'
const STORAGE_METHOD = 'dvflow.ots.method'

const EMPTY_CONTEXT: OtsContext = { productCode: '', batch: '', session: '', city: '' }

function remember(key: string): string {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}
function store(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* penyimpanan diblokir: tetap jalan tanpa ingatan */ }
}

function initialContext(): OtsContext {
  try {
    const parsed = JSON.parse(remember(STORAGE_CONTEXT)) as Partial<OtsContext> | null
    if (parsed === null || typeof parsed !== 'object') return EMPTY_CONTEXT
    return {
      productCode: typeof parsed.productCode === 'string' ? parsed.productCode : '',
      batch: typeof parsed.batch === 'string' ? parsed.batch : '',
      session: typeof parsed.session === 'string' ? parsed.session : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
    }
  } catch {
    return EMPTY_CONTEXT
  }
}

function initialPrice(): number | null {
  const parsed = Number(remember(STORAGE_PRICE))
  return (OTS_UNIT_PRICE_OPTIONS as readonly number[]).includes(parsed) ? parsed : null
}

function initialMethod(): string {
  const saved = remember(STORAGE_METHOD)
  return METHOD_VALUES.includes(saved) ? saved : 'ots_tunai'
}

function isContextComplete(context: OtsContext): boolean {
  return context.productCode.trim() !== '' && context.batch.trim() !== '' && context.session.trim() !== '' && context.city.trim() !== ''
}

export function describeEvent(event: Pick<OtsEvent, 'product_code' | 'product_name' | 'batch' | 'session' | 'city'>): string {
  return [event.product_name ?? event.product_code, event.batch ? `Batch ${event.batch}` : null, event.session, event.city]
    .filter(Boolean)
    .join(' · ')
}

function priceLabel(value: number, legacy: boolean): string {
  if (legacy) return `Tersimpan ${formatMoney(value)}`
  if (value % 1000 === 0) return `${value / 1000}rb`
  return formatMoney(value)
}

export function OtsDrawer({ open, onClose, canDelete }: { open: boolean; onClose: () => void; canDelete: boolean }) {
  return (
    <Drawer open={open} title="Peserta OTS (Bayar di Lokasi)" onClose={onClose}>
      <OtsPanel open={open} canDelete={canDelete} />
    </Drawer>
  )
}

/** Isi pendaftaran OTS: dipakai drawer (web) dan layar penuh `/ots` (Tampilan Apps Lapangan, A30). */
export function OtsPanel({ open, canDelete }: { open: boolean; canDelete: boolean }) {
  const toast = useToast()
  const [context, setContext] = useState<OtsContext>(initialContext)
  const [showContext, setShowContext] = useState(() => !isContextComplete(initialContext()))
  const [pickerVersion, setPickerVersion] = useState(0)
  // `deskPrice` = harga meja yang diingat untuk peserta berikutnya. `unitPrice` bisa
  // berbeda saat mengedit OTS lama yang nominalnya di luar 4 preset.
  const [deskPrice, setDeskPrice] = useState<number | null>(initialPrice)
  const [unitPrice, setUnitPrice] = useState<number | null>(deskPrice)
  const [legacyPrice, setLegacyPrice] = useState<number | null>(null)
  const [method, setMethod] = useState<string>(initialMethod)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [quantityText, setQuantityText] = useState('1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const references = useAsyncData<OtsReferenceData>(
    () => (open ? fetchOtsReferenceData() : Promise.resolve({ products: [], sessions: [] })),
    [open],
  )
  const events = useAsyncData<{ events: OtsEvent[] }>(
    () => (open ? authorizedRequest<{ events: OtsEvent[] }>('/api/ots/events') : Promise.resolve({ events: [] })),
    [open],
  )
  const list = useAsyncData<{ rows: OtsRow[] }>(
    () => (open ? authorizedRequest<{ rows: OtsRow[] }>('/api/ots') : Promise.resolve({ rows: [] })),
    [open, refresh],
  )

  const products = references.data?.products ?? []
  const sessions = references.data?.sessions ?? []
  // A34: OTS hanya untuk seminar offline. Endpoint tetap mengembalikan Hybrid untuk
  // aplikasi lama; form baru menyaringnya supaya konteks tidak salah jenis acara.
  const eventList = useMemo(
    () => (events.data?.events ?? []).filter((event) => event.event_type === 'Seminar Offline'),
    [events.data],
  )
  const productNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const product of products) map.set(product.code, product.name)
    for (const event of eventList) if (event.product_code && event.product_name) map.set(event.product_code, event.product_name)
    return map
  }, [products, eventList])

  const pickerOptions = useMemo(() => [
    ...eventList.map((event) => ({
      value: `event|${event.key}`,
      label: describeEvent(event),
      group: 'Acara terakhir',
    })),
    ...products.map((product) => ({
      value: `product|${product.code}`,
      label: `${product.code} — ${product.name}`,
      group: 'Produk',
    })),
  ], [eventList, products])

  // Simpan konteks/harga/metode per perangkat supaya peserta berikutnya tidak mengisi ulang.
  useEffect(() => { store(STORAGE_CONTEXT, JSON.stringify(context)) }, [context])
  useEffect(() => { if (deskPrice !== null) store(STORAGE_PRICE, String(deskPrice)) }, [deskPrice])
  useEffect(() => { store(STORAGE_METHOD, method) }, [method])

  // Saat drawer dibuka, arahkan fokus ke tempat yang paling mungkin dipakai.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      document.getElementById(isContextComplete(context) ? 'ots-name' : 'ots-picker')?.focus()
    }, 50)
    return () => window.clearTimeout(timer)
    // Sengaja hanya saat open: jangan memindahkan fokus ketika operator sedang mengetik konteks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sessionOptions = useMemo(() => {
    const options = sessions.map((session) => ({ value: session.code, label: `${session.code} — ${session.name}` }))
    if (context.session !== '' && !options.some((option) => option.value === context.session)) {
      options.push({ value: context.session, label: `${context.session} (tersimpan)` })
    }
    return options
  }, [sessions, context.session])

  const priceOptions = useMemo(() => {
    const base = [...(OTS_UNIT_PRICE_OPTIONS as readonly number[])]
    if (legacyPrice !== null && !base.includes(legacyPrice)) base.push(legacyPrice)
    return base
  }, [legacyPrice])

  const quantity = Number(quantityText)
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= OTS_MAX_QUANTITY
  const total = unitPrice === null || !validQuantity ? null : unitPrice * quantity

  function focusName(): void {
    window.setTimeout(() => document.getElementById('ots-name')?.focus(), 0)
  }

  function resetPerson(nextPrice: number | null = deskPrice): void {
    setName('')
    setPhone('')
    setQuantityText('1')
    setEditingId(null)
    setLegacyPrice(null)
    setUnitPrice(nextPrice)
    setFailure(null)
  }

  function choosePicker(value: string): void {
    if (value.startsWith('event|')) {
      const event = eventList.find((item) => item.key === value.slice('event|'.length))
      if (event) {
        const nextContext = {
          productCode: event.product_code,
          batch: event.batch ?? '',
          session: event.session ?? '',
          city: event.city ?? '',
        }
        setContext(nextContext)
        // Kalau data acara lama belum lengkap, biarkan field terbuka agar bisa dilengkapi.
        setShowContext(!isContextComplete(nextContext))
        if (isContextComplete(nextContext)) focusName()
      }
    } else if (value.startsWith('product|')) {
      const code = value.slice('product|'.length)
      setContext((current) => (
        current.productCode === code
          ? current
          : { productCode: code, batch: '', session: '', city: '' }
      ))
      setShowContext(true)
    }
    setPickerVersion((version) => version + 1)
  }

  function changeQuantity(next: number): void {
    setQuantityText(String(Math.min(OTS_MAX_QUANTITY, Math.max(1, next))))
  }

  async function save(): Promise<void> {
    if (busy) return
    setFailure(null)
    if (!isContextComplete(context)) {
      setShowContext(true)
      setFailure('Lengkapi acara meja terlebih dahulu: produk, batch, sesi, dan kota.')
      return
    }
    if (name.trim() === '') { setFailure('Nama peserta wajib diisi.'); return }
    if (phone.trim() === '') { setFailure('No HP wajib diisi.'); return }
    if (!validQuantity) { setFailure(`Jumlah tiket harus bilangan bulat 1–${OTS_MAX_QUANTITY}.`); return }
    if (unitPrice === null) { setFailure('Pilih harga per tiket.'); return }

    setBusy(true)
    try {
      await authorizedRequest('/api/ots', {
        method: 'POST',
        body: {
          ...(editingId ? { order_id: editingId } : {}),
          name: name.trim(),
          phone: phone.trim(),
          product_code: context.productCode,
          batch: context.batch.trim(),
          session: context.session.trim(),
          city: context.city.trim(),
          quantity,
          unit_price: unitPrice,
          method,
        },
      })
      const ticketText = quantity === 1 ? '1 tiket' : `${quantity} tiket`
      const amountText = formatMoney((total ?? 0))
      toast.show(editingId ? 'Data OTS diperbarui.' : `OTS tersimpan · ${ticketText} · ${amountText} · peserta hadir`, 'success')
      const nextDeskPrice = unitPrice !== null && (OTS_UNIT_PRICE_OPTIONS as readonly number[]).includes(unitPrice) ? unitPrice : deskPrice
      if (nextDeskPrice !== deskPrice) setDeskPrice(nextDeskPrice)
      resetPerson(nextDeskPrice)
      if (isContextComplete(context)) setShowContext(false)
      focusName()
      setRefresh((value) => value + 1)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'OTS gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row: OtsRow): void {
    const rowQuantity = Math.max(1, Number(row.quantity ?? 1))
    const savedUnit = Math.round((Number(row.gross_amount) / rowQuantity) * 100) / 100
    setContext({
      productCode: row.product_code ?? '',
      batch: row.batch ?? '',
      session: row.session ?? '',
      city: row.city ?? '',
    })
    setEditingId(row.order_id)
    setName(row.name ?? '')
    setPhone(row.phone ?? '')
    setQuantityText(String(rowQuantity))
    setUnitPrice(savedUnit)
    setLegacyPrice((OTS_UNIT_PRICE_OPTIONS as readonly number[]).includes(savedUnit) ? null : savedUnit)
    setMethod(METHOD_VALUES.includes(row.payment_method ?? '') ? (row.payment_method as string) : 'ots_tunai')
    setShowContext(true)
    setFailure(null)
    focusName()
  }

  async function remove(row: OtsRow): Promise<void> {
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
  const totalToday = rows.reduce((sum, row) => sum + row.gross_amount, 0)
  const contextReady = isContextComplete(context)
  const selectedProductName = context.productCode === '' ? '' : productNames.get(context.productCode) ?? context.productCode
  const contextSummary = contextReady
    ? [selectedProductName, `Batch ${context.batch}`, context.session, context.city].filter(Boolean).join(' · ')
    : 'Acara meja belum lengkap'

  return (
    <>
      <div className="rounded-md border border-line bg-soft p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Meja</p>
            <p className="truncate text-[13px] font-semibold text-ink">{contextSummary}</p>
          </div>
          <Button size="sm" onClick={() => setShowContext((value) => !value)} disabled={busy}>
            {showContext ? 'Tutup' : 'Ubah acara'}
          </Button>
        </div>

        {showContext ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <Combobox
              key={pickerVersion}
              id="ots-picker"
              label="Cari produk atau acara"
              value=""
              options={pickerOptions}
              onChange={choosePicker}
              disabled={busy}
              placeholder={references.loading ? 'Memuat produk…' : 'Ketik nama atau kode produk'}
              emptyMessage="Tidak ada produk/acara yang cocok."
              maxResults={10}
            />
            {references.error ? <ErrorState message={references.error} action={<Button onClick={references.reload}>Coba lagi</Button>} /> : null}
            {events.error ? <p className="text-[11px] text-ink-soft">Daftar acara terakhir tidak dapat dimuat; pilih produk secara manual.</p> : null}
            <p className="text-[12px] text-ink">
              Produk:{' '}
              {context.productCode === '' ? (
                <span className="text-ink-soft">belum dipilih</span>
              ) : (
                <strong>{selectedProductName} <span className="font-normal text-ink-soft">({context.productCode})</span></strong>
              )}
            </p>
            <TextInput
              id="ots-batch"
              label="Batch"
              value={context.batch}
              onChange={(value) => setContext((current) => ({ ...current, batch: value }))}
              disabled={busy || context.productCode === ''}
              placeholder="mis. 392"
              maxLength={32}
            />
            <Select
              id="ots-session"
              label="Sesi"
              value={context.session}
              placeholder={references.loading ? 'Memuat sesi…' : 'Pilih sesi'}
              options={sessionOptions}
              disabled={busy || context.productCode === ''}
              onChange={(value) => setContext((current) => ({ ...current, session: value }))}
            />
            <TextInput
              id="ots-city"
              label="Kota"
              value={context.city}
              onChange={(value) => setContext((current) => ({ ...current, city: value }))}
              disabled={busy || context.productCode === ''}
              placeholder="mis. Solo"
              maxLength={100}
            />
            {contextReady ? (
              <p className="text-[11px] text-ink-soft">Konteks meja tersimpan di perangkat ini. Tekan Tutup untuk mulai mendaftarkan peserta.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="text-[12px] text-ink-soft">
          Simpan = tercatat Paid dan langsung hadir. Tidak mengubah data OrderOnline.
        </p>
        <TextInput id="ots-name" label="Nama peserta" value={name} onChange={setName} disabled={busy} autoComplete="off" maxLength={200} />
        <TextInput id="ots-phone" label="No HP" value={phone} onChange={setPhone} disabled={busy} inputMode="tel" autoComplete="off" maxLength={32} />

        <div>
          <p className="mb-1 text-[12px] font-semibold text-ink">Jumlah tiket</p>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || !validQuantity || quantity <= 1} onClick={() => changeQuantity(quantity - 1)} aria-label="Kurangi jumlah tiket">−</Button>
            <input
              id="ots-quantity"
              aria-label="Jumlah tiket"
              inputMode="numeric"
              value={quantityText}
              disabled={busy}
              onChange={(event) => setQuantityText(event.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              onBlur={() => setQuantityText(validQuantity ? String(quantity) : '1')}
              className="h-9 w-20 rounded-sm border border-line bg-card px-3 text-center text-[13px] text-ink focus:border-primary focus:outline-none disabled:bg-soft"
            />
            <Button size="sm" disabled={busy || quantity >= OTS_MAX_QUANTITY} onClick={() => changeQuantity(validQuantity ? quantity + 1 : 1)} aria-label="Tambah jumlah tiket">+</Button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-[12px] font-semibold text-ink">Harga per tiket</p>
          <div role="radiogroup" aria-label="Harga per tiket" className="flex flex-wrap gap-2">
            {priceOptions.map((price) => {
              const isLegacy = legacyPrice !== null && price === legacyPrice && !(OTS_UNIT_PRICE_OPTIONS as readonly number[]).includes(price)
              return (
                <button
                  key={price}
                  type="button"
                  role="radio"
                  aria-checked={unitPrice === price}
                  disabled={busy}
                  onClick={() => { setUnitPrice(price); setDeskPrice(price) }}
                  className={cn(
                    'min-h-10 flex-1 rounded-sm border px-2 text-[12px] font-semibold',
                    unitPrice === price ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-card text-ink hover:bg-soft',
                    isLegacy && 'min-w-full',
                  )}
                >
                  {priceLabel(price, isLegacy)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-md border border-line bg-soft px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Total bayar</p>
          <p className="text-[22px] font-bold text-ink">{total === null ? '-' : formatMoney(total)}</p>
          {unitPrice !== null && validQuantity ? (
            <p className="text-[11px] text-ink-soft">{formatMoney(unitPrice)} × {quantity} tiket</p>
          ) : null}
        </div>

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
                  'min-h-10 rounded-sm border px-2 text-[12px] font-semibold',
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
          <Button type="submit" variant="primary" loading={busy} className="flex-1 sm:flex-none">
            {editingId ? 'Simpan perubahan' : 'Simpan & Check-in'}
          </Button>
          {editingId ? <Button disabled={busy} onClick={() => resetPerson()}>Batal edit</Button> : null}
        </div>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">OTS hari ini</p>
          <p className="text-[12px] text-ink-soft">{rows.length} peserta · {formatMoney(totalToday)}</p>
        </div>
        {list.error ? <ErrorState message={list.error} action={<Button onClick={list.reload}>Coba lagi</Button>} /> : null}
        {list.loading && list.data === null ? <SkeletonRows rows={3} /> : null}
        {list.data !== null && rows.length === 0 ? <p className="mt-2 text-[12px] text-ink-soft">Belum ada pendaftaran OTS hari ini.</p> : null}
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => {
            const rowQuantity = Math.max(1, Number(row.quantity ?? 1))
            const rowUnit = Number(row.gross_amount) / rowQuantity
            return (
              <li key={row.order_id} className={cn('rounded-md border border-line p-2.5', editingId === row.order_id && 'border-primary')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{row.name ?? '-'}</p>
                    <p className="truncate text-[11px] text-ink-soft">{describeEvent({ ...row, product_code: row.product_code ?? '' })}</p>
                    <p className="text-[11px] text-ink-soft">
                      {rowQuantity > 1
                        ? `${rowQuantity} tiket × ${formatMoney(rowUnit)} = ${formatMoney(row.gross_amount)}`
                        : formatMoney(row.gross_amount)}
                      {' · '}{METHOD_LABEL[row.payment_method ?? ''] ?? row.payment_method} · {formatTime(row.created_at)}
                      {row.collected_by ? ` · ${row.collected_by}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" disabled={busy} onClick={() => startEdit(row)}>Edit</Button>
                    {canDelete ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(row)}>Hapus</Button> : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
