import type { ReactNode } from 'react'
import { ProductScopeContext, type ProductScope } from '../src/layout/ProductScope'
import { PRODUCT_SCOPE_TTL_MS } from '../src/lib/product-scope'

/**
 * Provider scope produk untuk tes halaman yang tidak merender AppShell.
 *
 * Tes halaman cukup menetapkan produk aktif tanpa memuat daftar produk atau
 * menjalankan timer 24 jam. Provider asli diuji terpisah di product-scope.test.
 */
export function testProductScope(code: string): ProductScope {
  const chosenAt = Date.now()
  return {
    code,
    chosen: true,
    chosenAt,
    expiresAt: chosenAt + PRODUCT_SCOPE_TTL_MS,
    options: code === '' ? [] : [{ value: code, label: code }],
    loading: false,
    error: null,
    reload: () => {},
    choose: () => {},
    selectedLabel: code === '' ? 'Semua Produk' : code,
  }
}

export function WithProductScope({ code, children }: { code: string; children: ReactNode }) {
  return <ProductScopeContext.Provider value={testProductScope(code)}>{children}</ProductScopeContext.Provider>
}
