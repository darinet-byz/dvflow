/**
 * Binding environment backend (04 §13, 06 §4).
 *
 * Semuanya SECRET backend. Tidak satu pun boleh muncul di bundle frontend
 * (`.env.example` hanya memuat `VITE_*`).
 */
export type Env = {
  /** Base64-encoded 32-byte AES key for integration credentials. */
  INTEGRATION_ENCRYPTION_KEY?: string
  /** URL project Supabase, mis. `https://xxxx.supabase.co`. */
  SUPABASE_URL: string
  /** Service key. Hanya backend (04 §5). */
  SUPABASE_SECRET_KEY: string
  /** Private key ES256 dalam PKCS#8 PEM. */
  APP_JWT_PRIVATE_KEY: string
  /** `kid` yang sama dengan signing key yang di-trust Supabase (A3). */
  APP_JWT_KEY_ID: string
  /**
   * Secret path webhook OrderOnline (01 §20). Bila tidak diset, seluruh
   * permintaan webhook ditolak 404 — gagal-tertutup.
   */
  ORDERONLINE_WEBHOOK_SECRET?: string
  /**
   * `"true"` untuk mengizinkan destination webinar non-HTTPS (mis. localhost) —
   * hanya untuk pengembangan. Default `false` (05 §F08).
   */
  ALLOW_INSECURE_WEBINAR_DESTINATION?: string
  /** `"true"` untuk mengizinkan master_admin membuat master_admin (default false). */
  ALLOW_MASTER_ADMIN_CREATE_MASTER?: string
  /** Daftar origin tambahan yang diizinkan, dipisah koma (opsional). */
  APP_ALLOWED_ORIGINS?: string
}
