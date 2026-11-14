import { useEffect, useState } from 'react'
import { toWhatsAppNumber, whatsAppSendUrl } from '@dvflow/shared'
import { ApiError } from './api'
import { fetchFollowUpContext, fetchFollowUpSummaries, markFollowUpSlot } from './follow-up'
import { useToast } from '../ui/Toast'

/**
 * Aksi Follow Up bersama untuk kartu Order dan Presensi (A78).
 *
 * Satu tempat untuk: ringkasan bubble per halaman (satu request), preview lewat
 * template, dan WhatsApp kosong untuk slot yang belum punya template.
 */
export type FollowUpTarget = {
  order_id: string
  name?: string | null
  phone?: string | null
  product_name?: string | null
  advertiser_name?: string | null
  event_type?: string | null
  batch?: string | null
  session?: string | null
  city?: string | null
}

export type FollowUpSummaryView = {
  slots: number[]
  used: number[]
  quantity: number | null
}

export function useFollowUpActions(orderIds: readonly string[], enabled: boolean) {
  const toast = useToast()
  const [summaries, setSummaries] = useState<Map<string, FollowUpSummaryView>>(new Map())
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [target, setTarget] = useState<FollowUpTarget | null>(null)
  const [initialSlot, setInitialSlot] = useState<number | null>(null)

  const idsKey = orderIds.join(',')

  useEffect(() => {
    if (!enabled) return
    const ids = idsKey === '' ? [] : idsKey.split(',')
    if (ids.length === 0) {
      setSummaries(new Map())
      return
    }

    let cancelled = false
    fetchFollowUpSummaries(ids)
      .then((result) => {
        if (cancelled) return
        setSummaries(new Map((result.orders ?? []).map((row) => [row.order_id, {
          slots: row.slots ?? [],
          used: row.used ?? [],
          quantity: row.quantity ?? null,
        }])))
      })
      .catch(() => {
        // Warna boleh belum akurat; klik bubble tetap memakai fallback per order.
        if (!cancelled) setSummaries(new Map())
      })
    return () => { cancelled = true }
  }, [enabled, idsKey])

  function markUsed(orderId: string, slot: number): void {
    setSummaries((previous) => {
      const next = new Map(previous)
      const current = next.get(orderId) ?? { slots: [], used: [], quantity: null }
      next.set(orderId, {
        ...current,
        used: [...new Set([...current.used, slot])].sort((left, right) => left - right),
      })
      return next
    })
  }

  async function openEmptyChat(order: FollowUpTarget, slot: number, phone: string): Promise<void> {
    const opened = window.open(whatsAppSendUrl(phone, ''), '_blank', 'noopener,noreferrer')
    if (opened === null) {
      toast.show('Popup diblokir browser. Izinkan popup lalu coba lagi.', 'danger')
      return
    }
    setBusyOrderId(order.order_id)
    try {
      await markFollowUpSlot(order.order_id, slot)
      markUsed(order.order_id, slot)
      toast.show(`F${slot} dibuka tanpa template. Pesan bisa ditulis langsung di WhatsApp.`, 'success')
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Gagal menandai follow up.', 'danger')
    } finally {
      setBusyOrderId(null)
    }
  }

  /** Buka modal tanpa slot terpilih (tombol FU di tabel/drawer desktop). */
  function open(order: FollowUpTarget): void {
    setTarget(order)
    setInitialSlot(null)
  }

  async function handleBubble(order: FollowUpTarget, slot: number): Promise<void> {
    const phone = toWhatsAppNumber(order.phone)
    if (phone === null) {
      toast.show('Nomor WA tidak valid untuk WhatsApp.', 'danger')
      return
    }

    const summary = summaries.get(order.order_id)
    if (summary !== undefined) {
      if (summary.slots.includes(slot)) {
        setTarget(order)
        setInitialSlot(slot)
        return
      }
      await openEmptyChat(order, slot, phone)
      return
    }

    // Ringkasan halaman belum ada (gagal dimuat): tentukan dari order ini saja.
    setBusyOrderId(order.order_id)
    try {
      const context = await fetchFollowUpContext(order.order_id)
      if (context.templates.some((item) => item.slot === slot)) {
        setTarget(order)
        setInitialSlot(slot)
      } else {
        await openEmptyChat(order, slot, phone)
      }
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Gagal memuat template follow up.', 'danger')
    } finally {
      setBusyOrderId(null)
    }
  }

  function onMarked(slot: number): void {
    if (target !== null) markUsed(target.order_id, slot)
  }

  function closeModal(): void {
    setTarget(null)
    setInitialSlot(null)
  }

  return { summaries, busyOrderId, target, initialSlot, open, handleBubble, onMarked, closeModal }
}
