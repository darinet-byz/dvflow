import { useState } from 'react'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { AdCalendarTab } from './AdCalendarTab'
import { EventCalendarTab } from './EventCalendarPage'

/**
 * A80: satu menu Kalender dengan dua tab.
 *
 * - Kalender Event: jadwal Seminar/Webinar/Workshop (A79).
 * - Kalender Iklan: deadline tayang iklan per batch pengiklan.
 */
export function CalendarPage() {
  const [tab, setTab] = useState<'event' | 'ad'>('event')

  return (
    <>
      <PageHeader
        title="Kalender"
        description="Jadwal event dan deadline tayang iklan dalam satu tempat."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Jenis kalender">
        <Button
          role="tab"
          aria-selected={tab === 'event'}
          variant={tab === 'event' ? 'primary' : 'secondary'}
          onClick={() => setTab('event')}
        >
          Kalender Event
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'ad'}
          variant={tab === 'ad' ? 'primary' : 'secondary'}
          onClick={() => setTab('ad')}
        >
          Kalender Iklan
        </Button>
      </div>

      {tab === 'event' ? <EventCalendarTab /> : <AdCalendarTab />}
    </>
  )
}
