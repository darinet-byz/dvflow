/**
 * Katalog error API (03 §1: `{ ok: false, error: { code, message } }`).
 *
 * Pesan berbahasa Indonesia dan TIDAK pernah memuat detail internal: tanpa
 * stack trace, tanpa pesan database mentah, tanpa SQL (03 §1, 04 §14).
 */
export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'SESSION_INVALID'
  | 'USER_DISABLED'
  | 'FORBIDDEN'
  | 'ORIGIN_NOT_ALLOWED'
  | 'INVALID_PAYLOAD'
  | 'INVALID_ARGUMENT'
  | 'WEAK_PASSWORD'
  | 'PASSWORD_MISMATCH'
  | 'USERNAME_TAKEN'
  | 'MASTER_ADMIN_CREATE_FORBIDDEN'
  | 'UNSUPPORTED_ORDER_STATUS'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PAID'
  | 'NOT_SEMINAR_ORDER'
  | 'CODE_TAKEN'
  | 'IDENTIFIER_TAKEN'
  | 'CODE_AMBIGUOUS'
  | 'RESOURCE_NOT_FOUND'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

export const ERROR_CATALOG: Record<ApiErrorCode, { status: number; message: string }> = {
  INVALID_CREDENTIALS: { status: 401, message: 'Username atau password salah.' },
  SESSION_INVALID: { status: 401, message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.' },
  USER_DISABLED: { status: 401, message: 'Akun ini dinonaktifkan.' },
  FORBIDDEN: { status: 403, message: 'Anda tidak memiliki akses untuk tindakan ini.' },
  ORIGIN_NOT_ALLOWED: { status: 403, message: 'Permintaan ditolak karena origin tidak diizinkan.' },
  INVALID_PAYLOAD: { status: 400, message: 'Data yang dikirim tidak valid.' },
  INVALID_ARGUMENT: { status: 400, message: 'Argumen tidak valid.' },
  WEAK_PASSWORD: { status: 400, message: 'Password minimal 8 karakter.' },
  PASSWORD_MISMATCH: { status: 400, message: 'Password baru dan konfirmasi tidak sama.' },
  USERNAME_TAKEN: { status: 409, message: 'Username sudah dipakai.' },
  MASTER_ADMIN_CREATE_FORBIDDEN: { status: 403, message: 'Pembuatan Master Admin tidak diizinkan.' },
  // 03 §3: status order tak dikenal TIDAK dipetakan diam-diam.
  UNSUPPORTED_ORDER_STATUS: { status: 422, message: 'Status order dari provider tidak didukung.' },
  // 03 §9: error check-in.
  ORDER_NOT_FOUND: { status: 404, message: 'Order tidak ditemukan.' },
  ORDER_NOT_PAID: { status: 403, message: 'Order belum dibayar. Check-in ditolak.' },
  NOT_SEMINAR_ORDER: { status: 409, message: 'Order ini bukan Seminar Offline.' },
  // 03 §12: konfigurasi.
  CODE_TAKEN: { status: 409, message: 'Kode sudah dipakai.' },
  IDENTIFIER_TAKEN: { status: 409, message: 'Identifier ini sudah punya rule aktif.' },
  CODE_AMBIGUOUS: {
    status: 409,
    message: 'Kombinasi kode produk, pengiklan, dan event type ini saling menaungi sehingga produk tidak dapat dipetakan dengan pasti.',
  },
  RESOURCE_NOT_FOUND: { status: 404, message: 'Data konfigurasi tidak ditemukan.' },
  NOT_FOUND: { status: 404, message: 'Endpoint tidak ditemukan.' },
  INTERNAL_ERROR: { status: 500, message: 'Terjadi kesalahan pada server.' },
}

/**
 * Kegagalan yang disengaja: membawa kode katalog, bukan pesan bebas.
 *
 * Handler melempar ini; router mengubahnya menjadi response JSON. Dengan begitu
 * tidak ada jalur di mana pesan error internal ikut terkirim ke klien.
 */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    /** Konteks untuk log server. TIDAK pernah dikirim ke klien. */
    readonly logContext?: string,
  ) {
    super(code)
    this.name = 'ApiFailure'
  }
}

/**
 * Pemetaan SQLSTATE kustom dari RPC (lihat header `0017_write_rpcs.sql`)
 * menjadi kode error API. Kode yang tidak dikenal menjadi INTERNAL_ERROR —
 * lebih baik 500 yang jujur daripada menebak arti kode asing.
 */
export const DB_SQLSTATE_TO_API_CODE: Record<string, ApiErrorCode> = {
  DF001: 'ORDER_NOT_FOUND',
  DF002: 'ORDER_NOT_PAID',
  DF003: 'NOT_SEMINAR_ORDER',
  DF004: 'INVALID_CREDENTIALS',
  DF005: 'USER_DISABLED',
  DF006: 'FORBIDDEN',
  DF007: 'WEAK_PASSWORD',
  DF008: 'MASTER_ADMIN_CREATE_FORBIDDEN',
  DF009: 'USERNAME_TAKEN',
  DF010: 'PASSWORD_MISMATCH',
  DF011: 'INVALID_ARGUMENT',
  DF014: 'INVALID_PAYLOAD',
  // Pelanggaran unique: kode konfigurasi dan identifier fee rule punya index unik
  // masing-masing, jadi hasilnya dipetakan berbeda supaya pesannya tepat.
  '23505': 'CODE_TAKEN',
}
