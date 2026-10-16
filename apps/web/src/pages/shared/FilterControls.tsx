import { Select, TextInput } from '../../ui/Field'
import type { CommonFilters } from '../../lib/filters'
import { DateRangeField } from './DateRangeField'
import type { ConfigLists } from '../../lib/queries'

/**
 * Kontrol filter bersama (PRD §34, §41, §47, §108).
 *
 * Aturan yang dipegang:
 *   * Produk, pengiklan, event type, dan sesi selalu berupa PILIHAN dari
 *     konfigurasi — tidak diketik bebas dan tidak pernah di-hardcode
 *     (CLAUDE.md §4). Hanya konfigurasi aktif yang ditawarkan (05 §D02).
 *   * Batch, kota, dan payment method berupa teks: nilainya berasal dari order,
 *     dan dokumen tidak menentukan sumber daftar pilihannya.
 *   * Semua kontrol setinggi 36px tanpa label visual, supaya toolbar tetap
 *     rendah (PRD §46); labelnya tetap ada untuk pembaca layar.
 */
export type FilterControlsProps<T extends CommonFilters> = {
  filters: T
  lists: ConfigLists | null
  update: (key: keyof T, value: string) => void
  disabled?: boolean
}

const CONTROL_WIDTH = 'w-[190px]'

export function ProductFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <Select
      id="filter-produk"
      ariaLabel="Filter produk"
      className={CONTROL_WIDTH}
      value={props.filters.productCode}
      placeholder="Semua produk"
      disabled={props.disabled === true}
      options={props.lists?.products ?? []}
      onChange={(value) => props.update('productCode' as keyof T, value)}
    />
  )
}

export function AdvertiserFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <Select
      id="filter-pengiklan"
      ariaLabel="Filter pengiklan"
      className={CONTROL_WIDTH}
      value={props.filters.advertiserCode}
      placeholder="Semua pengiklan"
      disabled={props.disabled === true}
      options={props.lists?.advertisers ?? []}
      onChange={(value) => props.update('advertiserCode' as keyof T, value)}
    />
  )
}

export function EventTypeFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <Select
      id="filter-jenis"
      ariaLabel="Filter seminar atau webinar"
      className={CONTROL_WIDTH}
      value={props.filters.eventType}
      placeholder="Seminar & Webinar"
      disabled={props.disabled === true}
      // NAMA, bukan kode: itulah isi kolom `orders.event_type` (K7).
      options={props.lists?.eventTypeNames ?? []}
      onChange={(value) => props.update('eventType' as keyof T, value)}
    />
  )
}

export function SessionFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <Select
      id="filter-sesi"
      ariaLabel="Filter sesi"
      className={CONTROL_WIDTH}
      value={props.filters.session}
      placeholder="Semua sesi"
      disabled={props.disabled === true}
      options={props.lists?.sessions ?? []}
      onChange={(value) => props.update('session' as keyof T, value)}
    />
  )
}

/** Satu field tanggal: preset + kalender (tanpa mengetik). Nilai tetap dateFrom/dateTo. */
export function DateRangeFilters<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <DateRangeField
      className={CONTROL_WIDTH}
      from={props.filters.dateFrom}
      to={props.filters.dateTo}
      disabled={props.disabled === true}
      onChange={(range) => {
        props.update('dateFrom' as keyof T, range.from)
        props.update('dateTo' as keyof T, range.to)
      }}
    />
  )
}

export function BatchFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <TextInput
      id="filter-batch"
      ariaLabel="Filter batch"
      className={CONTROL_WIDTH}
      value={props.filters.batch}
      disabled={props.disabled === true}
      placeholder="Batch (mis. 392)"
      onChange={(value) => props.update('batch' as keyof T, value)}
    />
  )
}

export function CityFilter<T extends CommonFilters>(props: FilterControlsProps<T>) {
  return (
    <TextInput
      id="filter-kota"
      ariaLabel="Filter kota"
      className={CONTROL_WIDTH}
      value={props.filters.city}
      disabled={props.disabled === true}
      placeholder="Kota (mis. Solo)"
      onChange={(value) => props.update('city' as keyof T, value)}
    />
  )
}
