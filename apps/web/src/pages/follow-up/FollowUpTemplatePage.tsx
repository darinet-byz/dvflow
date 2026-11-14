import { useEffect, useMemo, useState } from 'react'
import {
  FOLLOW_UP_SLOTS,
  FOLLOW_UP_TEMPLATE_MAX_LENGTH,
  FOLLOW_UP_TEMPLATE_PLACEHOLDERS,
  renderFollowUpTemplate,
  type FollowUpTemplateValues,
} from '@dvflow/shared'
import { ApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import {
  fetchFollowUpTemplates,
  saveFollowUpTemplates,
  type FollowUpTemplateMatrix,
} from '../../lib/follow-up'
import { supabaseSelect } from '../../lib/supabase-rest'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { ErrorState } from '../../ui/Feedback'
import { Select, Textarea } from '../../ui/Field'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Template Follow Up Manual (A76).
 *
 * Satu set F1-F4 per PRODUK x JENIS ACARA, dipakai bersama semua pimpro/advertiser
 * yang membuka produk itu. Tidak ada label nama bubble: pemilik produk bebas
 * menentukan isi F1-F4. Slot kosong = bubble tidak muncul di modal Follow Up.
 */
type ProductRow = { code: string; name: string; active: boolean }

const EMPTY_SLOTS: Record<string, string> = { '1': '', '2': '', '3': '', '4': '' }

export function FollowUpTemplatePage() {
  const toast = useToast()
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [productCode, setProductCode] = useState('')
  const [matrix, setMatrix] = useState<FollowUpTemplateMatrix | null>(null)
  const [eventTypeCode, setEventTypeCode] = useState('')
  const [slots, setSlots] = useState<Record<string, string>>(EMPTY_SLOTS)
  const [previewSlot, setPreviewSlot] = useState<number>(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabaseSelect<ProductRow>('products', { order: 'code.asc' }, 'code,name,active')
      .then((rows) => {
        if (cancelled) return
        setProducts(rows)
        setProductCode((current) => current !== '' ? current : rows[0]?.code ?? '')
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Gagal memuat produk.')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (productCode === '') return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchFollowUpTemplates(productCode)
      .then((result) => {
        if (cancelled) return
        setMatrix(result)
        const nextEventType = result.event_types.find((item) => item.code === eventTypeCode && item.active)
          ?? result.event_types.find((item) => item.active)
          ?? result.event_types[0]
        setEventTypeCode(nextEventType?.code ?? '')
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof ApiError ? failure.message : 'Gagal memuat template.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productCode])

  const selectedEventType = matrix?.event_types.find((item) => item.code === eventTypeCode) ?? null

  useEffect(() => {
    if (matrix === null || selectedEventType === null) return
    const next = { ...EMPTY_SLOTS }
    for (const row of matrix.templates) {
      if (row.event_type_id === selectedEventType.id) next[String(row.slot)] = row.body
    }
    setSlots(next)
    setPreviewSlot(1)
  }, [matrix, selectedEventType?.id])

  const lastUpdated = useMemo(() => {
    if (matrix === null || selectedEventType === null) return null
    return matrix.templates
      .filter((row) => row.event_type_id === selectedEventType.id)
      .reduce<string | null>((current, row) => current === null || row.updated_at > current ? row.updated_at : current, null)
  }, [matrix, selectedEventType?.id])

  const sampleValues = useMemo<FollowUpTemplateValues>(() => ({
    nama: 'Budi Santoso',
    order_id: 'MTIX-283818331',
    produk: matrix?.product.name ?? 'Nama Produk',
    pengiklan: '01',
    jenis: selectedEventType?.name ?? 'Jenis Acara',
    batch: '60',
    sesi: 'S1',
    kota: 'Tegal',
    link: `${window.location.origin}/access/MTIX/283818331`,
  }), [matrix, selectedEventType?.name])

  async function save(): Promise<void> {
    if (productCode === '' || eventTypeCode === '') return
    setSaving(true)
    try {
      await saveFollowUpTemplates({ productCode, eventTypeCode, slots })
      const refreshed = await fetchFollowUpTemplates(productCode)
      setMatrix(refreshed)
      toast.show('Template Follow Up disimpan.', 'success')
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Gagal menyimpan template.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Template Follow Up"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Select
          id="follow-up-produk"
          label="Produk"
          value={productCode}
          placeholder="Pilih produk"
          options={(products ?? []).map((row) => ({ value: row.code, label: `${row.code} — ${row.name}` }))}
          onChange={setProductCode}
        />
        <Select
          id="follow-up-jenis"
          label="Jenis Acara"
          value={eventTypeCode}
          placeholder="Pilih jenis acara"
          options={(matrix?.event_types ?? []).map((row) => ({
            value: row.code,
            label: `${row.name}${row.active ? '' : ' (nonaktif)'}`,
          }))}
          onChange={setEventTypeCode}
        />
      </div>

      {error === null ? null : <ErrorState message={error} />}
      {loading ? <p className="text-[13px] text-ink-soft">Memuat template…</p> : null}

      {matrix === null || loading ? null : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <Card>
            <CardHeader title={`F1–F4 · ${selectedEventType?.name ?? '-'}`} />
            <div className="flex flex-col gap-3">
              {FOLLOW_UP_SLOTS.map((slot) => (
                <div key={slot} onFocus={() => setPreviewSlot(slot)}>
                  <Textarea
                    id={`follow-up-f${slot}`}
                    label={`F${slot}`}
                    value={slots[String(slot)] ?? ''}
                    rows={4}
                    maxLength={FOLLOW_UP_TEMPLATE_MAX_LENGTH}
                    placeholder={`Isi pesan F${slot}…`}
                    onChange={(value) => setSlots((current) => ({ ...current, [String(slot)]: value }))}
                  />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={saving} onClick={() => void save()}>
                  Simpan Template
                </Button>
                {lastUpdated === null ? null : (
                  <span className="text-[11px] text-ink-soft">Terakhir diubah {formatDateTime(lastUpdated)}</span>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={`Preview F${previewSlot}`} />
            <pre className="whitespace-pre-wrap break-words rounded-md border border-line bg-page p-3 font-sans text-[13px] text-ink">
              {renderFollowUpTemplate(slots[String(previewSlot)] ?? '', sampleValues) || `F${previewSlot} masih kosong.`}
            </pre>
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Placeholder</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {FOLLOW_UP_TEMPLATE_PLACEHOLDERS.map((name) => (
                  <span key={name} className={cn('rounded-sm border border-line bg-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-soft')}>
                    {`{${name}}`}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-soft">
                Slot kosong tidak muncul di modal Follow Up. Order OTS tidak punya nilai <code>{'{link}'}</code>.
              </p>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
