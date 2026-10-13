/**
 * Penggabung className sederhana.
 *
 * Cukup untuk kebutuhan komponen di sini, sehingga tidak perlu menambah
 * dependensi (`clsx`/`tailwind-merge`) hanya untuk menggabungkan string
 * (06 §12: jaga dependensi tetap minimal).
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ')
}
