import { fetchConfigLists, type ConfigLists } from './queries'
import { useAsyncData } from './useAsyncData'

/**
 * Daftar konfigurasi untuk pilihan filter.
 *
 * Dimuat sekali per pemasangan halaman: konfigurasi berubah jarang, dan
 * memuatnya ulang pada setiap perubahan filter hanya menambah permintaan tanpa
 * menambah kebenaran.
 */
export function useConfigLists(): { lists: ConfigLists | null; error: string | null } {
  const { data, error } = useAsyncData(fetchConfigLists, [])
  return { lists: data, error }
}
