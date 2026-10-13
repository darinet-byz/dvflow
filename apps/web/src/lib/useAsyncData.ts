import { useCallback, useEffect, useState } from 'react'
import { ApiError, type ApiErrorCode } from './api'
import { SEARCH_DEBOUNCE_MS } from './filters'

/**
 * Pemuat data dengan keadaan loading/error.
 *
 * Menjaga tiga hal yang mudah salah:
 *   * hasil permintaan lama tidak pernah menimpa hasil yang lebih baru
 *     (pergantian filter cepat sering meninggalkan respons yang datang
 *     terlambat);
 *   * komponen yang sudah dilepas tidak mencoba memperbarui keadaan;
 *   * **kode** error tetap tersedia, bukan hanya pesannya. Halaman perlu
 *     membedakan "tidak punya akses" dari "gagal memuat", dan mencocokkan
 *     kalimat pesan adalah cara yang rapuh untuk itu.
 */
export type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  errorCode: ApiErrorCode | null
  reload: () => void
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ApiErrorCode | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setErrorCode(null)

    loader()
      .then((result) => {
        if (!active) return
        setData(result)
      })
      .catch((failure: unknown) => {
        if (!active) return
        setError(failure instanceof ApiError ? failure.message : 'Data tidak dapat dimuat.')
        setErrorCode(failure instanceof ApiError ? failure.code : 'INTERNAL_ERROR')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
    // `deps` sengaja disebar: pemanggil yang menentukan kapan data perlu dimuat
    // ulang (filter, sort, halaman), bukan dihitung di dalam hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, errorCode, reload }
}

/**
 * Tunda nilai selama `SEARCH_DEBOUNCE_MS` (01 §7).
 *
 * Dipakai kotak pencarian: mengetik "Ahmad" tidak boleh menjadi 5 permintaan.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
