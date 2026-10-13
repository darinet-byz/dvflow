import { createHandler, type Api, type Env } from '@dvflow/api'

/**
 * Entry Cloudflare Worker.
 *
 * Seluruh logika ada di `@dvflow/api`; berkas ini hanya mengikat binding
 * platform. Dipakai saat aplikasi punya domain sendiri; sebelum itu, jalur
 * produksinya adalah Pages Functions (`functions/api/[[path]].ts`) supaya
 * backend dan frontend berada di satu origin (STATE.md K2).
 *
 * Handler di-cache per objek `env`: `env` stabil selama satu isolate hidup,
 * sehingga kunci JWT yang sudah diimpor tidak perlu diimpor ulang pada setiap
 * permintaan.
 */
const handlers = new WeakMap<Env, Api>()

function handlerFor(env: Env): Api {
  let handler = handlers.get(env)
  if (handler === undefined) {
    handler = createHandler(env)
    handlers.set(env, handler)
  }
  return handler
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handlerFor(env)(request)
  },
}
