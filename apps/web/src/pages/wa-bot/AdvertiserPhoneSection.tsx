import { useState } from 'react'
import { normalizeWhatsAppPhone } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput } from '../../ui/Field'
import { DataTable, TableCell, TableRow, type TableColumn } from '../../ui/Table'
import { useToast } from '../../ui/Toast'
import type { WaAdvertiserWithProducts, WaOverview } from './types'

const COLUMNS: readonly TableColumn[] = [
  { key: 'advertiser', header: 'Pengiklan', minWidth: 180 },
  { key: 'products', header: 'Produk', minWidth: 200 },
  { key: 'phone', header: 'Nomor WA', minWidth: 220 },
  { key: 'status', header: 'Status', minWidth: 100 },
  { key: 'actions', header: 'Aksi', minWidth: 100 },
]

function PhoneRow({ advertiser, reload }: { advertiser: WaAdvertiserWithProducts; reload: () => void }) {
  const toast = useToast()
  const [phone, setPhone] = useState(advertiser.wa_phone ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function save() {
    if (busy) return
    const normalized = normalizeWhatsAppPhone(phone)
    if (normalized === null) {
      setFailure('Nomor WA wajib format 628xxx (boleh diketik 08xxx).')
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(`/api/wa-bot/advertisers/${advertiser.id}`, {
        method: 'PATCH',
        body: { wa_phone: phone },
      })
      setPhone(normalized)
      reload()
      toast.show('Nomor WA pengiklan disimpan.', 'success')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Nomor gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-ink">{advertiser.name}</span>
          <span className="text-[11px] text-ink-soft">{advertiser.code}</span>
        </div>
      </TableCell>
      <TableCell>
        {advertiser.products.length === 0 ? (
          <span className="text-[12px] text-ink-soft">Belum ditugaskan</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {advertiser.products.map((product) => (
              <Badge key={product.code} tone="neutral">{product.code}</Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <TextInput
          id={`wa-phone-${advertiser.id}`}
          ariaLabel={`Nomor WA ${advertiser.name}`}
          value={phone}
          inputMode="tel"
          placeholder="08xxx atau 628xxx"
          disabled={busy}
          onChange={(value) => { setPhone(value); setFailure(null) }}
        />
        {failure ? <p role="alert" className="mt-1 text-[11px] text-danger">{failure}</p> : null}
      </TableCell>
      <TableCell>
        <Badge tone={advertiser.wa_phone ? 'success' : 'danger'}>
          {advertiser.wa_phone ? 'Terisi' : 'Belum ada'}
        </Badge>
      </TableCell>
      <TableCell>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Simpan</Button>
      </TableCell>
    </TableRow>
  )
}

export function AdvertiserPhoneSection({ overview, reload }: { overview: WaOverview; reload: () => void }) {
  const missing = overview.advertisers.filter((advertiser) => advertiser.active && !advertiser.wa_phone).length

  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-ink">Nomor WA Pengiklan</h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          Nomor ini dipakai untuk tag <code>@628xxx</code> di grup produk. Wajib diisi untuk semua pengiklan aktif.
        </p>
      </div>

      {missing > 0 ? (
        <p className="mb-3 rounded-sm border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-[12px] text-ink">
          {missing} pengiklan aktif belum punya nomor WA.
        </p>
      ) : (
        <p className="mb-3 rounded-sm border border-success/40 bg-success-soft px-2.5 py-1.5 text-[12px] text-ink">
          Semua pengiklan aktif sudah punya nomor WA.
        </p>
      )}

      <DataTable columns={COLUMNS} maxRows={null}>
        {overview.advertisers.map((advertiser) => (
          <PhoneRow key={advertiser.id} advertiser={advertiser} reload={reload} />
        ))}
      </DataTable>
      {overview.advertisers.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-soft">Belum ada pengiklan. Tambahkan di Konfigurasi Produk.</p>
      ) : null}
    </Card>
  )
}
