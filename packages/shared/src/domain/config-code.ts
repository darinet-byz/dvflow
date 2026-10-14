export type MasterCodeResource = 'products' | 'advertisers' | 'event-types' | 'sessions'

export const SESSION_CODES = ['ST', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const
export const MASTER_CODE_RULES: Record<MasterCodeResource, { pattern: RegExp; message: string }> = {
  products: { pattern: /^[A-Z]{4}$/, message: 'Kode produk harus tepat 4 huruf kapital.' },
  advertisers: { pattern: /^[0-9]{2}$/, message: 'Kode pengiklan harus tepat 2 digit angka.' },
  'event-types': { pattern: /^[A-Z]{2}$/, message: 'Kode tipe harus tepat 2 huruf kapital.' },
  sessions: { pattern: /^(ST|S[1-8])$/, message: 'Kode sesi hanya ST atau S1 sampai S8.' },
}

export function normalizeMasterCode(resource: MasterCodeResource, value: string): string | null {
  const code = value.trim().toUpperCase()
  return MASTER_CODE_RULES[resource].pattern.test(code) ? code : null
}
