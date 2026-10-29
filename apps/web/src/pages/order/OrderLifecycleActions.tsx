import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { formatMoney, formatText } from '../../lib/format'
import { isOtsOrder } from '../../lib/access-link'
import type { AppStatus } from '../../lib/queries'
import { useConfigLists } from '../../lib/useConfigLists'
import { authorizedRequest } from '../../lib/session'
import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { Button } from '../../ui/Button'
import { TextInput, Select } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { useToast } from '../../ui/Toast'

/**
 * Aksi siklus hidup order (A58): Reschedule, Refund, dan Batalkan Refund.
 *
 * Tampilan hanya menyembunyikan tombol yang tidak relevan; aturan sebenarnya
 * (Paid, belum check-in, bukan OTS, refund penuh) ditegakkan ulang di RPC.
 */
export type LifecycleOrder = {
  order_id: string
  name?: string | null
  app_status: AppStatus
  product_parse_status?: 'valid' | 'invalid'
  event_type?: string | null
  product_name?: string | null
  gross_amount?: number
  quantity?: number
  batch?: string | null
  session?: string | null
  city?: string | null
  event_batch?: string | null
  event_session?: string | null
  event_city?: string | null
  rescheduled?: boolean
  has_attendance?: boolean
  total_activity?: number
}

type Dialog = 'reschedule' | 'refund' | 'cancel' | null

export function OrderLifecycleActions({
  order,
  onChanged,
}: {
  order: LifecycleOrder
  onChanged: () => void
}) {
  const profile = useSession().profile
  const toast = useToast()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveBatch = order.event_batch ?? order.batch ?? ''
  const effectiveSession = order.event_session ?? order.session ?? ''
  const effectiveCity = order.event_city ?? order.city ?? ''
  const [batch, setBatch] = useState(effectiveBatch)
  const [session, setSession] = useState(effectiveSession)
  const [city, setCity] = useState(effectiveCity)
  const [reason, setReason] = useState('')

  const checkedIn = order.has_attendance === true || (order.total_activity ?? 0) > 0
  const canReschedule =
    hasPermission(profile, 'action.reschedule') &&
    order.app_status === 'Paid' &&
    order.product_parse_status !== 'invalid' &&
    order.event_type != null &&
    !checkedIn &&
    !isOtsOrder(order.order_id)
  const canRefund = hasPermission(profile, 'action.refund') && order.app_status === 'Paid'
  const canCancelRefund = hasPermission(profile, 'action.refund') && order.app_status === 'Refund'

  function open(next: Exclude<Dialog, null>): void {
    setError(null)
    setReason('')
    setBatch(effectiveBatch)
    setSession(effectiveSession)
    setCity(effectiveCity)
    setDialog(next)
  }

  async function submit(): Promise<void> {
    if (busy || dialog === null) return
    if (dialog === 'reschedule' && (session.trim() === '' || city.trim() === '')) {
      setError('Sesi dan kota tujuan wajib diisi.')
      return
    }
    if (dialog === 'refund' && reason.trim() === '') {
      setError('Alasan refund wajib diisi.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (dialog === 'reschedule') {
        await authorizedRequest(`/api/orders/${encodeURIComponent(order.order_id)}/reschedule`, {
          method: 'POST',
          body: { batch: batch.trim(), session: session.trim(), city: city.trim(), reason: reason.trim() },
        })
        toast.show('Peserta berhasil di-reschedule.', 'success')
      } else if (dialog === 'refund') {
        await authorizedRequest(`/api/orders/${encodeURIComponent(order.order_id)}/refund`, {
          method: 'POST',
          body: { reason: reason.trim() },
        })
        toast.show('Order ditandai Refund.', 'success')
      } else {
        await authorizedRequest(`/api/orders/${encodeURIComponent(order.order_id)}/refund/cancel`, {
          method: 'POST',
          body: { reason: reason.trim() },
        })
        toast.show('Refund dibatalkan; order kembali ke status sebelumnya.', 'success')
      }
      setDialog(null)
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Tindakan gagal. Silakan coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  if (!canReschedule && !canRefund && !canCancelRefund) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canReschedule ? (
          <Button size="sm" onClick={() => open('reschedule')}>
            Reschedule
          </Button>
        ) : null}
        {canRefund ? (
          <Button size="sm" variant="danger" onClick={() => open('refund')}>
            Refund
          </Button>
        ) : null}
        {canCancelRefund ? (
          <Button size="sm" onClick={() => open('cancel')}>
            Batalkan Refund
          </Button>
        ) : null}
      </div>

      <Modal
        open={dialog !== null}
        title={
          dialog === 'reschedule'
            ? 'Reschedule Peserta'
            : dialog === 'refund'
              ? 'Tandai Order Refund'
              : 'Batalkan Refund'
        }
        onClose={() => {
          if (!busy) setDialog(null)
        }}
        footer={
          <>
            <Button onClick={() => setDialog(null)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant={dialog === 'refund' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void submit()}
            >
              {dialog === 'reschedule' ? 'Simpan Reschedule' : dialog === 'refund' ? 'Tandai Refund' : 'Batalkan Refund'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-line bg-page p-2.5 text-[12px] text-ink-soft">
            <strong className="text-ink">{order.order_id}</strong>
            {order.name ? ` · ${formatText(order.name)}` : ''}
            {order.product_name ? ` · ${formatText(order.product_name)}` : ''}
          </p>

          {dialog === 'reschedule' ? (
            <>
              <RescheduleFields
                session={session}
                city={city}
                batch={batch}
                onSession={setSession}
                onCity={setCity}
                onBatch={setBatch}
              />
              <TextInput
                id="reschedule-reason"
                label="Alasan (opsional)"
                value={reason}
                onChange={setReason}
                placeholder="mis. pindah domisili"
                maxLength={300}
              />
              <p className="text-[12px] text-ink-soft">
                Presensi, tiket/QR, dan link Zoom akan mengikuti acara tujuan. Omzet dan laporan iklan tetap
                tercatat pada batch/sesi/kota asal. Hanya untuk peserta Paid yang belum check-in.
              </p>
            </>
          ) : null}

          {dialog === 'refund' ? (
            <>
              <dl className="grid grid-cols-2 gap-2 rounded-md border border-line bg-page p-2.5 text-[12px]">
                <div>
                  <dt className="text-ink-soft">Nominal refund</dt>
                  <dd className="font-semibold text-ink">{formatMoney(order.gross_amount ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Jumlah tiket</dt>
                  <dd className="font-semibold text-ink">{order.quantity ?? 1}</dd>
                </div>
              </dl>
              <TextInput
                id="refund-reason"
                label="Alasan refund"
                value={reason}
                onChange={setReason}
                placeholder="mis. peserta membatalkan"
                maxLength={500}
              />
              <p className="text-[12px] text-danger">
                Order akan menjadi Refund: keluar dari Paid, tiket, omzet, dan laporan Paid; peserta tidak
                dapat membuka tiket/Zoom. Refund bersifat penuh per order.
              </p>
            </>
          ) : null}

          {dialog === 'cancel' ? (
            <>
              <p className="text-[12px] text-ink-soft">
                Order akan kembali ke status provider terakhir dan dihitung lagi pada laporan Paid. Riwayat
                refund tetap tersimpan.
              </p>
              <TextInput
                id="cancel-refund-reason"
                label="Alasan pembatalan (opsional)"
                value={reason}
                onChange={setReason}
                placeholder="mis. salah menandai order"
                maxLength={500}
              />
            </>
          ) : null}

          {error === null ? null : <p className="text-[12px] text-danger">{error}</p>}
        </div>
      </Modal>
    </>
  )
}

/**
 * Field tujuan reschedule dipisah supaya daftar sesi hanya dimuat saat modal
 * reschedule benar-benar dibuka (drawer refund-only tidak perlu request itu).
 */
function RescheduleFields({
  session,
  city,
  batch,
  onSession,
  onCity,
  onBatch,
}: {
  session: string
  city: string
  batch: string
  onSession: (value: string) => void
  onCity: (value: string) => void
  onBatch: (value: string) => void
}) {
  const { lists } = useConfigLists()
  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          id="reschedule-session"
          label="Sesi tujuan"
          value={session}
          placeholder="Pilih sesi"
          options={lists?.sessions ?? []}
          onChange={onSession}
        />
        <TextInput
          id="reschedule-city"
          label="Kota tujuan"
          value={city}
          onChange={onCity}
          placeholder="mis. Bandung"
          maxLength={100}
        />
      </div>
      <TextInput
        id="reschedule-batch"
        label="Batch (opsional)"
        value={batch}
        onChange={onBatch}
        placeholder="Kosongkan untuk memakai batch saat ini"
        maxLength={32}
      />
    </>
  )
}
