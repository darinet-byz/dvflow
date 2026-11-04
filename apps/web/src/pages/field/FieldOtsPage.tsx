import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { useFieldAppMode } from '../../lib/field-app'
import { PageHeader } from '../../layout/PageHeader'
import { Card } from '../../ui/Card'
import { OtsPanel } from '../scanner/OtsDrawer'

/**
 * Layar OTS penuh (web dan Tampilan Apps Lapangan, A30).
 *
 * Di web daftar menampilkan SEMUA tanggal dengan pencarian + filter tanggal;
 * di aplikasi lapangan header sudah disediakan FieldAppShell.
 */
export function FieldOtsPage() {
  const { profile } = useSession()
  const fieldMode = useFieldAppMode()
  return (
    <>
      {fieldMode ? null : <PageHeader title="Peserta OTS" description="Pendaftaran peserta bayar di lokasi." />}
      <Card>
        <OtsPanel open canDelete={hasPermission(profile, 'action.delete_master')} mode="all" />
      </Card>
    </>
  )
}
