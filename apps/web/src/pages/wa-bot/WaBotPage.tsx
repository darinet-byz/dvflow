import { useState } from 'react'
import { hasPermission } from '../../lib/roles'
import { authorizedRequest } from '../../lib/session'
import { useSession } from '../../lib/useSession'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { ConnectionSection } from './ConnectionSection'
import { LogSection } from './LogSection'
import { ProductSection } from './ProductSection'
import { ScheduleSection } from './ScheduleSection'
import { TemplateSection } from './TemplateSection'
import type { WaOverview } from './types'

const TABS = [
  { id: 'connection', label: 'Koneksi' },
  { id: 'products', label: 'Produk & Grup' },
  { id: 'templates', label: 'Template' },
  { id: 'schedules', label: 'Jadwal' },
  { id: 'logs', label: 'Riwayat' },
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * WA Admin Bot (Fitur 3.0).
 *
 * Konfigurasi grup berada di level produk. Seluruh data dibaca dari backend,
 * bukan RLS langsung: tabel log memuat isi pesan/nomor dan pengaturan memuat
 * token Fonnte terenkripsi. Permission `config.wa_bot` adalah gerbangnya,
 * ditegakkan server-side.
 */
export function WaBotPage() {
  const session = useSession()
  const canSend = hasPermission(session.profile, 'action.wa_bot_send')
  const { data, loading, error, reload } = useAsyncData(() => authorizedRequest<WaOverview>('/api/wa-bot'), [])
  const [tab, setTab] = useState<TabId>('connection')

  return (
    <>
      <PageHeader
        title="WA Admin Bot"
        description="Pengingat laporan iklan harian ke grup WhatsApp per produk. Jadwal dan pesan dibaca dalam WIB."
      />

      {error ? (
        <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} />
      ) : loading && !data ? (
        <SkeletonRows rows={5} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div role="tablist" aria-label="Bagian WA Admin Bot" className="flex flex-wrap gap-1.5">
            {TABS.map((item) => (
              <Button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                variant={tab === item.id ? 'primary' : 'secondary'}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          {tab === 'connection' ? <ConnectionSection overview={data} reload={reload} canSend={canSend} /> : null}
          {tab === 'products' ? <ProductSection overview={data} reload={reload} /> : null}
          {tab === 'templates' ? <TemplateSection overview={data} reload={reload} /> : null}
          {tab === 'schedules' ? <ScheduleSection overview={data} reload={reload} /> : null}
          {tab === 'logs' ? <LogSection overview={data} canSend={canSend} /> : null}
        </div>
      ) : null}
    </>
  )
}
