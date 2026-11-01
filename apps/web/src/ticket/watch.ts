/**
 * A19/A62: selama tiket belum check-in penuh, periksa ulang halaman yang sama (GET tanpa
 * efek samping) dan muat ulang begitu server menandai `data-checked-in="true"` —
 * QR berganti stempel "CHECK-IN BERHASIL" tanpa peserta menyegarkan manual.
 *
 * A62: tiket multi-tiket boleh hadir bertahap. Bila jumlah tiket hadir berubah
 * (mis. 1/2 -> 2/2) halaman juga dimuat ulang, supaya keterangan "Check-in
 * sebagian" dan sisa tiket ikut diperbarui. Tidak ada endpoint baru.
 */
export const CHECKIN_POLL_MS = 15_000

export function isCheckedInHtml(html: string): boolean {
  return html.includes('data-checked-in="true"')
}

/** Nilai `data-checkin-count` (mis. "1/2"), atau null bila tidak ada. */
export function readCheckinCount(html: string): string | null {
  const match = /data-checkin-count="([^"]*)"/.exec(html)
  return match?.[1] ?? null
}

export function watchCheckin(options: {
  url: string
  fetchPage: (url: string) => Promise<string>
  onCheckedIn: () => void
  /** Jumlah tiket hadir saat halaman pertama dibuka; perubahan memicu onChanged. */
  initialCount?: string | null
  onChanged?: () => void
  schedule?: (run: () => void, ms: number) => unknown
}): void {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms))
  const tick = async () => {
    try {
      const html = await options.fetchPage(options.url)
      if (isCheckedInHtml(html)) {
        options.onCheckedIn()
        return
      }
      const count = readCheckinCount(html)
      if (
        options.onChanged !== undefined &&
        options.initialCount != null &&
        count !== null &&
        count !== options.initialCount
      ) {
        options.onChanged()
        return
      }
    } catch {
      // Koneksi lapangan bisa putus; coba lagi pada putaran berikutnya.
    }
    schedule(() => void tick(), CHECKIN_POLL_MS)
  }
  schedule(() => void tick(), CHECKIN_POLL_MS)
}
