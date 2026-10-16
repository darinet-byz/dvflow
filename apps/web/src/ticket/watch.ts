/**
 * A19: selama tiket belum check-in, periksa ulang halaman yang sama (GET tanpa efek samping)
 * dan muat ulang begitu server menandai `data-checked-in="true"` — QR berganti stempel
 * "CHECK-IN BERHASIL" tanpa peserta menyegarkan manual. Tidak ada endpoint baru.
 */
export const CHECKIN_POLL_MS = 15_000

export function isCheckedInHtml(html: string): boolean {
  return html.includes('data-checked-in="true"')
}

export function watchCheckin(options: {
  url: string
  fetchPage: (url: string) => Promise<string>
  onCheckedIn: () => void
  schedule?: (run: () => void, ms: number) => unknown
}): void {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms))
  const tick = async () => {
    try {
      if (isCheckedInHtml(await options.fetchPage(options.url))) {
        options.onCheckedIn()
        return
      }
    } catch {
      // Koneksi lapangan bisa putus; coba lagi pada putaran berikutnya.
    }
    schedule(() => void tick(), CHECKIN_POLL_MS)
  }
  schedule(() => void tick(), CHECKIN_POLL_MS)
}
