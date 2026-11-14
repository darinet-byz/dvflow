import { useEffect, useMemo, useState } from 'react'
import {
  FOLLOW_UP_SLOTS,
  renderFollowUpTemplate,
  whatsAppSendUrl,
  type FollowUpTemplateValues,
} from '@dvflow/shared'
import { ApiError } from '../../lib/api'
import { participantAccessUrl } from '../../lib/access-link'
import { formatDateTime, formatText } from '../../lib/format'
import {
  fetchFollowUpContext,
  markFollowUpSlot,
  type FollowUpContext,
} from '../../lib/follow-up'
import type { OrderRow } from '../../lib/queries'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Follow Up Manual via WhatsApp (A76).
 *
 * Alurnya sengaja pendek: klik F1-F4 → preview → Kirim. Aplikasi TIDAK mengirim
 * pesan; tombol Kirim membuka `api.whatsapp.com/send` milik operator sehingga
 * pesan masih bisa diedit di WhatsApp. Warna hijau menandai bubble yang sudah
 * pernah dipakai untuk order ini (penanda, bukan riwayat).
 */
export function FollowUpModal({
  order,
  onClose,
}: {
  order: OrderRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const [data, setData] = useState<FollowUpContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setData(null)
    setSelected(null)
    setError(null)
    if (order === null) return

    let cancelled = false
    setLoading(true)
    fetchFollowUpContext(order.order_id)
      .then((context) => { if (!cancelled) setData(context) })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof ApiError ? failure.message : 'Gagal memuat data follow up.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [order?.order_id])

  const values = useMemo<FollowUpTemplateValues>(() => {
    if (order === null) return {}
    const info = data?.order
    return {
      nama: info?.name ?? order.name ?? '',
      order_id: order.order_id,
      produk: info?.product_name ?? order.product_name ?? '',
      pengiklan: info?.advertiser_name ?? order.advertiser_name ?? '',
      jenis: data?.event_type?.name ?? info?.event_type ?? order.event_type ?? '',
      batch: info?.batch ?? order.batch ?? '',
      sesi: info?.session ?? order.session ?? '',
      kota: info?.city ?? order.city ?? '',
      // OTS tidak punya tiket/link online.
      link: info?.is_ots === true ? '' : participantAccessUrl(order.order_id),
    }
  }, [order, data])

  const templates = data?.templates ?? []
  const selectedTemplate = templates.find((item) => item.slot === selected) ?? null
  const preview = selectedTemplate === null ? '' : renderFollowUpTemplate(selectedTemplate.body, values)
  const phone = data?.order.phone_wa ?? null
  const usedSlots = new Set((data?.marks ?? []).map((mark) => mark.slot))

  async function send(): Promise<void> {
    if (order === null || selected === null || phone === null || preview.trim() === '') return
    setSending(true)
    try {
      const opened = window.open(whatsAppSendUrl(phone, preview), '_blank', 'noopener,noreferrer')
      if (opened === null) {
        toast.show('Popup diblokir browser. Izinkan popup lalu klik Kirim lagi.', 'danger')
        return
      }

      const mark = await markFollowUpSlot(order.order_id, selected)
      setData((current) => current === null ? current : {
        ...current,
        marks: [...current.marks.filter((item) => item.slot !== mark.slot), {
          slot: mark.slot,
          used_at: mark.used_at,
          used_by_name: mark.used_by_name,
        }],
      })
      toast.show('WhatsApp dibuka. Pesan masih bisa diedit sebelum dikirim.', 'success')
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Gagal menandai follow up.', 'danger')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={order !== null}
      title={order === null ? 'Follow Up' : `Follow Up · ${formatText(order.name)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Tutup</Button>
          <Button
            variant="primary"
            loading={sending}
            disabled={selected === null || phone === null || preview.trim() === ''}
            onClick={() => void send()}
          >
            Kirim
          </Button>
        </>
      }
    >
      {loading ? <p className="text-ink-soft">Memuat template…</p> : null}
      {error === null ? null : <p className="text-[13px] text-danger">{error}</p>}

      {data === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-page p-2.5 text-[12px] text-ink-soft">
            <p>
              <span className="font-semibold text-ink">{formatText(data.order.product_name)}</span>
              {' · '}
              {data.event_type === null ? 'Jenis acara tidak dikenali' : data.event_type.name}
              {data.order.is_ots ? ' · OTS (tanpa link tiket)' : ''}
            </p>
            <p className="mt-0.5">
              Nomor WA: <span className="font-mono">{phone ?? formatText(data.order.phone)}</span>
              {phone === null ? ' — nomor tidak valid untuk WhatsApp' : ''}
            </p>
          </div>

          {data.event_type === null ? (
            <p className="text-[13px] text-warning">
              Jenis acara order ini tidak dapat ditentukan, jadi template tidak bisa dipilih.
            </p>
          ) : null}

          {data.event_type !== null && templates.length === 0 ? (
            <p className="text-[13px] text-ink-soft">
              Belum ada template untuk produk ini pada jenis acara tersebut.{' '}
              <a className="font-semibold text-primary hover:underline" href="/template-follow-up">Atur di Template Follow Up</a>.
            </p>
          ) : null}

          {templates.length === 0 ? null : (
            <div className="grid grid-cols-4 gap-2">
              {FOLLOW_UP_SLOTS.map((slot) => {
                const template = templates.find((item) => item.slot === slot)
                if (template === undefined) return null
                const used = usedSlots.has(slot)
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelected(slot)}
                    title={used ? 'Sudah pernah dipakai untuk order ini' : 'Belum dipakai'}
                    className={cn(
                      'rounded-md border px-2 py-3 text-[13px] font-semibold transition-colors',
                      used
                        ? 'border-success/40 bg-success-soft text-success'
                        : 'border-line bg-card text-ink hover:bg-soft',
                      selected === slot && 'ring-2 ring-primary ring-offset-1',
                    )}
                  >
                    F{slot}
                    {used ? <span aria-hidden="true"> ✓</span> : null}
                  </button>
                )
              })}
            </div>
          )}

          {selectedTemplate === null ? (
            <p className="text-[12px] text-ink-soft">Pilih F1–F4 untuk melihat preview pesan.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Preview F{selected}</span>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-page p-3 font-sans text-[13px] text-ink">
                {preview}
              </pre>
            </div>
          )}

          {data.template_updated === null ? null : (
            <p className="text-[11px] text-ink-soft">
              Template terakhir diubah {formatDateTime(data.template_updated.at)}
              {data.template_updated.by ? ` oleh ${data.template_updated.by}` : ''}.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
