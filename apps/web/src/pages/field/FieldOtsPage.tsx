import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { Card } from '../../ui/Card'
import { OtsPanel } from '../scanner/OtsDrawer'

/** Layar OTS penuh di Tampilan Apps Lapangan (A30); isi sama dengan drawer OTS di web. */
export function FieldOtsPage() {
  const { profile } = useSession()
  return (
    <Card>
      <OtsPanel open canDelete={hasPermission(profile, 'action.delete_master')} />
    </Card>
  )
}
