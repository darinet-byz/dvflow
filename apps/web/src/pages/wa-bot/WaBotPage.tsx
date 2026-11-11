import { hasPermission } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { useSession } from '../../lib/useSession'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { GroupSection } from './GroupSection'
import { LogSection } from './LogSection'
import { ScheduleSection } from './ScheduleSection'
import { TemplateSection } from './TemplateSection'
import { TokenSection } from './TokenSection'
import type { WaOverview } from './types'

/**
 * WA Admin Bot (Fitur 3.0).
 *
 * Seluruh data dibaca dari backend, bukan RLS langsung: tabel log memuat isi
 * pesan/nomor dan pengaturan memuat token Fonnte terenkripsi. Permission
 * `config.wa_bot` adalah gerbangnya, ditegakkan server-side.
 */
export function WaBotPage() {
  const session = useSession()
  const canSend = hasPermission(session.profile, 'action.wa_bot_send')
  const { data, loading, error, reload } = useAsyncData(() => authorizedRequest<WaOverview>('/api/wa-bot'), [])

  return (
    <>
      <PageHeader
        title="WA Admin Bot"
        description="Pengingat laporan iklan harian via grup WhatsApp Fonnte. Jadwal dan pesan dibaca dalam WIB."
      />

      {error ? (
        <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
      ) : loading && !data ? (
        <SkeletonRows rows={5} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <TokenSection overview={data} reload={reload} canSend={canSend} />
          <GroupSection overview={data} reload={reload} />
          <TemplateSection overview={data} reload={reload} />
          <ScheduleSection overview={data} reload={reload} />
          <LogSection overview={data} canSend={canSend} />
        </div>
      ) : null}
    </>
  )
}
