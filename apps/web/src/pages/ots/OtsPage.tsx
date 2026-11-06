import { useState } from 'react'
import { hasPermission } from '../../lib/roles'
import { useFieldAppMode } from '../../lib/field-app'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { OtsPanel } from '../scanner/OtsDrawer'
import { OtsReportPanel } from './OtsReportPanel'

type Tab = 'registration' | 'transactions' | 'report'

/**
 * Menu OTS — pendaftaran, transaksi, dan laporan keuangan dalam satu tempat.
 *
 * OTS tetap tersimpan sebagai order sumber `ots`, sehingga peserta yang sama
 * tetap muncul di Presensi Acara dan Order. Menu ini bukan pemisahan data;
 * ia hanya rumah operasional dan laporan OTS.
 */
export function OtsPage() {
  const { profile } = useSession()
  const fieldMode = useFieldAppMode()
  const [tab, setTab] = useState<Tab>('transactions')
  const canDelete = hasPermission(profile, 'action.delete_master')

  // Tampilan lapangan memakai alur lama: Pendaftaran/Riwayat di dalam OtsPanel.
  if (fieldMode) {
    return (
      <Card>
        <OtsPanel open canDelete={canDelete} mode="all" />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="OTS"
        description="Pendaftaran bayar di lokasi, riwayat transaksi, dan laporan keuangan OTS."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Menu OTS">
        <Button role="tab" aria-selected={tab === 'registration'} variant={tab === 'registration' ? 'primary' : 'secondary'} onClick={() => setTab('registration')}>Pendaftaran</Button>
        <Button role="tab" aria-selected={tab === 'transactions'} variant={tab === 'transactions' ? 'primary' : 'secondary'} onClick={() => setTab('transactions')}>Transaksi</Button>
        <Button role="tab" aria-selected={tab === 'report'} variant={tab === 'report' ? 'primary' : 'secondary'} onClick={() => setTab('report')}>Laporan</Button>
      </div>

      {tab === 'registration' ? (
        <Card>
          <OtsPanel open canDelete={canDelete} mode="all" section="form" />
        </Card>
      ) : null}
      {tab === 'transactions' ? (
        <Card>
          <OtsPanel open canDelete={canDelete} mode="all" section="history" />
        </Card>
      ) : null}
      {tab === 'report' ? <OtsReportPanel /> : null}
    </>
  )
}
