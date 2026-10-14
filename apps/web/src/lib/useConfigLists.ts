import { fetchConfigLists, type ConfigLists } from './queries'
import { useAsyncData } from './useAsyncData'

/**
 * Daftar konfigurasi untuk pilihan filter.
 *
 * Dimuat sekali per pemasangan halaman: konfigurasi berubah jarang, dan
 * memuatnya ulang pada setiap perubahan filter hanya menambah permintaan tanpa
 * menambah kebenaran.
 */
export function useConfigLists(refreshToken = 0): { lists: ConfigLists | null; error: string | null } {
  // `refreshToken` memuat ulang daftar saat halaman yang sama baru saja mengubah konfigurasi.
  const { data, error } = useAsyncData(fetchConfigLists, [refreshToken])
  return { lists: data, error }
}
