import { ManualSearch, OutcomeCard, useCheckin } from '../scanner/ScanQrPage'

/**
 * Cari Peserta (A30): pencarian manual + check-in untuk Tampilan Apps Lapangan.
 * Logika & validasi sama persis dengan Manual Search di halaman Scan (server tetap memutuskan).
 */
export function CariPesertaPage() {
  const { outcome, busy, runCheckin } = useCheckin()
  return (
    <div className="flex flex-col gap-3">
      <ManualSearch onCheckin={(orderId) => void runCheckin(orderId, 'manual')} busy={busy} />
      {outcome !== null || busy ? <OutcomeCard outcome={outcome} busy={busy} /> : null}
    </div>
  )
}
