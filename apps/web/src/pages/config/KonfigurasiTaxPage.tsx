import { useEffect, useMemo, useState } from 'react'
import { calculateFees, type EpaymentFeeType, type FeeType } from '@dvflow/shared'
import { PageHeader } from '../../layout/PageHeader'
import { ApiError } from '../../lib/api'
import { hasAllProductAccess, hasPermission } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { useSession } from '../../lib/useSession'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput } from '../../ui/Field'
import { ErrorState } from '../../ui/Feedback'
import { useToast } from '../../ui/Toast'
import { ConfigSection } from './ConfigSection'
import { FEE_RULE_SPEC, feeColumnsFromParts } from './specs'

/**
 * Konfigurasi Tax (PRD §74–§80, §164; A15).
 *
 * Per metode pembayaran: E-payment Fee, E-payment Fee Tax, dan centang Platform Fee.
 * PLATFORM FEE (%) adalah satu tarif global dari OrderOnline, dikenakan ke nominal order
 * Paid yang metode bayarnya dicentang.
 *
 * Identifier adalah kunci pencocokan exact dengan webhook (01 §11). Mengubah atau
 * menonaktifkan aturan TIDAK mengubah order historis: order menyimpan snapshotnya (01 §12).
 */
const EXAMPLE_GROSS = 100_000

export function KonfigurasiTaxPage() {
  const { profile } = useSession()
  const toast = useToast()
  const canEdit = hasPermission(profile, 'config.tax') && hasAllProductAccess(profile)
  const { data, error, reload } = useAsyncData(
    () => authorizedRequest<{ percent: number }>('/api/config/platform-fee'),
    [],
  )
  const savedPercent = data?.percent ?? 0
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setDraft(String(data.percent)) }, [data])

  async function savePlatformFee(): Promise<void> {
    setSaving(true)
    try {
      await authorizedRequest('/api/config/platform-fee', { method: 'PUT', body: { percent: draft.trim() === '' ? '' : Number(draft) } })
      toast.show('Platform Fee disimpan. Berlaku untuk order yang dibayar berikutnya.', 'success')
      reload()
    } catch (failure) {
      toast.show(failure instanceof ApiError ? failure.message : 'Platform Fee gagal disimpan.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  // Contoh perhitungan di bawah form memakai rumus yang sama dengan server (shared/calculateFees).
  const spec = useMemo(() => ({
    ...FEE_RULE_SPEC,
    preview: (values: Record<string, string>) => <FeeExample values={values} platformFeePercent={savedPercent} />,
  }), [savedPercent])

  return (
    <>
      <PageHeader
        title="Konfigurasi Tax"
      />

      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-primary">Platform Fee</p>
            <div className="flex items-end gap-2">
              <div className="w-32">
                <TextInput id="platform-fee-percent" label="Persen (%)" value={draft} onChange={setDraft} placeholder="mis. 2" disabled={!canEdit} />
              </div>
              {canEdit ? (
                <Button variant="primary" onClick={() => void savePlatformFee()} loading={saving} disabled={draft === String(savedPercent)}>
                  Simpan
                </Button>
              ) : null}
            </div>
          </div>
          {error ? <div className="mt-3"><ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /></div> : null}
        </Card>


        <ConfigSection spec={spec} />
      </div>
    </>
  )
}

function FeeExample({ values, platformFeePercent }: { values: Record<string, string>; platformFeePercent: number }) {
  const num = (raw: string | undefined) => (raw === undefined || raw.trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw))
  const percent = num(values['fee_percent']) ?? 0
  const flat = num(values['fee_flat']) ?? 0
  const taxType = (values['epayment_tax_type'] || null) as FeeType | null
  const taxValue = num(values['epayment_tax_value'])
  // Rumus dan pemetaan sama dengan yang dikirim ke server (feeColumnsFromParts -> calculateFees).
  const columns = feeColumnsFromParts(percent, flat)

  const result = calculateFees(EXAMPLE_GROSS, {
    fee_type: columns['fee_type'] as EpaymentFeeType,
    fee_value: Number(columns['fee_value']),
    fee_flat_value: Number(columns['fee_flat_value']),
    platform_fee_applies: values['platform_fee_applies'] === 'true',
    epayment_tax_type: taxType && taxValue !== null ? taxType : null,
    epayment_tax_value: taxType && taxValue !== null ? taxValue : null,
  }, { platformFeePercent, isPaid: true })
  const rp = (n: number) => `Rp${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
  const rows: Array<[string, string]> = [
    ['Nominal order (Paid)', rp(EXAMPLE_GROSS)],
    [`− E-payment Fee${percent > 0 || flat > 0 ? ` (${[percent > 0 ? `${percent.toLocaleString('id-ID')}%` : '', flat > 0 ? rp(flat) : ''].filter(Boolean).join(' + ')})` : ''}`, rp(result.epayment_fee)],
    ['− E-payment Fee Tax', rp(result.epayment_fee_tax)],
    [`− Platform Fee (${platformFeePercent.toLocaleString('id-ID')}%)`, rp(result.platform_fee)],
  ]

  return (
    <div className="rounded-lg border border-line bg-soft px-3 py-2.5 text-[12px]" data-testid="fee-example">
      <p className="mb-1.5 font-semibold text-ink">Contoh perhitungan</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-ink-soft">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
        <dt className="mt-1 border-t border-line pt-1 font-semibold text-ink">Net</dt>
        <dd className="mt-1 border-t border-line pt-1 text-right font-semibold tabular-nums text-ink">{rp(result.net_amount)}</dd>
      </dl>
    </div>
  )
}
