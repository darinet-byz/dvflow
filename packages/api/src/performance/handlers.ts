import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import { requirePermission } from '../permissions'
import type { RouteContext } from '../router'

/**
 * A83: KPI tiket global per bulan untuk halaman Performa.
 *
 * Satu angka untuk semua pengiklan. Dibaca browser lewat RLS; penulisan lewat
 * backend supaya validasi dan jejak `updated_by` tidak bisa dilewati.
 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_TARGET = 1_000_000

type KpiRow = { period_month: string; target_tickets: number; updated_at: string }

/** GET /api/performance/kpi?month=YYYY-MM */
export async function getPerformanceKpi(context: RouteContext): Promise<Response> {
  await requirePermission(context, 'operasional.analytics')
  const month = (context.url.searchParams.get('month') ?? '').trim()
  if (!MONTH_PATTERN.test(month)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Bulan KPI harus format YYYY-MM.')
  }

  const [row] = await context.db.selectRows<KpiRow>(
    'performance_kpi_targets',
    { period_month: `eq.${month}-01` },
    'period_month,target_tickets,updated_at',
  )

  return ok({
    month,
    target_tickets: row?.target_tickets ?? null,
    updated_at: row?.updated_at ?? null,
  })
}

/** PUT /api/performance/kpi — { month: "YYYY-MM", target_tickets: number } */
export async function savePerformanceKpi(context: RouteContext): Promise<Response> {
  const actor = await requirePermission(context, 'operasional.analytics')
  const body = await readJsonObject(context.request)
  const month = (readString(body, 'month') ?? '').trim()
  const target = body['target_tickets']

  if (!MONTH_PATTERN.test(month)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Bulan KPI harus format YYYY-MM.')
  }
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > MAX_TARGET) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, `KPI harus bilangan bulat 1–${MAX_TARGET.toLocaleString('id-ID')}.`)
  }

  const periodMonth = `${month}-01`
  const [existing] = await context.db.selectRows<{ period_month: string }>(
    'performance_kpi_targets',
    { period_month: `eq.${periodMonth}` },
    'period_month',
  )

  if (existing === undefined) {
    await context.db.insertRow('performance_kpi_targets', {
      period_month: periodMonth,
      target_tickets: target,
      updated_by: actor.id,
      updated_at: context.now.toISOString(),
    }, 'period_month')
  } else {
    await context.db.updateRows(
      'performance_kpi_targets',
      { period_month: `eq.${periodMonth}` },
      {
        target_tickets: target,
        updated_by: actor.id,
        updated_at: context.now.toISOString(),
      },
    )
  }

  return ok({ month, target_tickets: target })
}
