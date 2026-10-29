import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Grafik garis ringan (SVG native).
 *
 * A46/A51/A56: halaman Performa membutuhkan grafik garis tanpa menambah library
 * chart. Komponen ini hanya menggambar; pemanggil menentukan seri, warna, sumbu,
 * dan format nilai. Tabel di halaman tetap menjadi fallback data yang dapat
 * dibaca pembaca layar.
 *
 * A56 menambah:
 *   * sumbu kanan (`axis: 'right'`) untuk seri dengan skala berbeda (mis. tiket);
 *   * tooltip hover berisi angka real, bukan hanya `<title>` pada titik;
 *   * garis diputus per segmen saat bucket `null`, tidak menyambung titik jauh;
 *   * area tipis di bawah garis (`showArea`).
 */

export type TrendSeries = {
  key: string
  label: string
  /** Warna hex dari token desain (styles.css). */
  color: string
  /** `null` = tidak ada data pada titik itu; garis diputus, bukan dianggap nol. */
  values: Array<number | null>
  /** Sumbu nilai seri. Default `left`; `right` untuk satuan berbeda (mis. jumlah tiket). */
  axis?: 'left' | 'right'
  /** Format tooltip khusus seri ini; default memakai `formatValue`. */
  format?: (value: number) => string
}

export type TrendChartProps = {
  labels: string[]
  series: TrendSeries[]
  /** Format tooltip dan angka data (fallback bila seri tidak punya `format`). */
  formatValue: (value: number) => string
  /** Format label sumbu Y kiri; default sama dengan `formatValue`. */
  formatAxis?: (value: number) => string
  /** Format label sumbu Y kanan; default sama dengan `formatValue`. */
  formatAxisRight?: (value: number) => string
  ariaLabel: string
  height?: number
  /** Tampilkan titik pada setiap data; otomatis dimatikan bila titik terlalu banyak. */
  showDots?: boolean
  /** Garis tipis dan transparan (dipakai grafik Performa). */
  soft?: boolean
  /** Isi area di bawah garis dengan warna seri (opasitas rendah). */
  showArea?: boolean
}

const WIDTH = 640
const PADDING = { top: 14, right: 14, bottom: 30, left: 64 }
/** Ruang tambahan di kanan bila ada seri bersumbu kanan. */
const RIGHT_AXIS_WIDTH = 48

type Domain = { min: number; max: number }
type Segment = Array<{ index: number; value: number }>

function domainOf(values: Array<number | null>): Domain {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (numbers.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...numbers, 0), max: Math.max(...numbers, 0) }
}

/** Bucket kosong memutus garis: satu polyline per rentang data yang berurutan. */
function segmentsOf(values: Array<number | null>): Segment[] {
  const segments: Segment[] = []
  let current: Segment = []
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push({ index, value })
  })
  if (current.length > 0) segments.push(current)
  return segments
}

export function TrendChart({
  labels,
  series,
  formatValue,
  formatAxis,
  formatAxisRight,
  ariaLabel,
  height = 200,
  showDots,
  soft = false,
  showArea = false,
}: TrendChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const leftSeries = series.filter((item) => (item.axis ?? 'left') === 'left')
  const rightSeries = series.filter((item) => item.axis === 'right')
  const hasRight = rightSeries.length > 0
  const rightPadding = hasRight ? PADDING.right + RIGHT_AXIS_WIDTH : PADDING.right
  const innerWidth = WIDTH - PADDING.left - rightPadding
  const innerHeight = height - PADDING.top - PADDING.bottom

  const leftDomain = domainOf(leftSeries.flatMap((item) => item.values))
  const rightDomain = domainOf(rightSeries.flatMap((item) => item.values))
  const spanOf = (domain: Domain) => domain.max - domain.min || 1

  const x = (index: number) => {
    if (labels.length <= 1) return PADDING.left + innerWidth / 2
    return PADDING.left + (index / (labels.length - 1)) * innerWidth
  }
  const yOn = (domain: Domain, value: number) =>
    PADDING.top + innerHeight - ((value - domain.min) / spanOf(domain)) * innerHeight

  const dots = showDots ?? labels.length <= 31
  const labelStep = Math.max(1, Math.ceil(labels.length / 7))
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const axisFormatter = formatAxis ?? formatValue
  const rightFormatter = formatAxisRight ?? formatValue
  const active = hovered !== null && hovered >= 0 && hovered < labels.length ? hovered : null
  const seriesFormat = (item: TrendSeries) => item.format ?? formatValue

  return (
    <div className="relative min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
            {hasRight && item.axis === 'right' ? <span className="text-ink-muted">(kanan)</span> : null}
          </span>
        ))}
        <span className="ml-auto text-ink-muted">Arahkan kursor untuk melihat angka</span>
      </div>

      {active === null ? null : (
        <div className="pointer-events-none absolute right-2 top-7 z-10 min-w-[150px] rounded-md border border-line bg-card/95 px-2.5 py-2 shadow-card" data-testid="trend-chart-tooltip">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{labels[active]}</p>
          {series.map((item) => {
            const value = item.values[active] ?? null
            return (
              <p key={item.key} className="mt-1 flex items-center justify-between gap-3 text-[11px] text-ink">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
                <span className="font-semibold">{value === null ? '-' : seriesFormat(item)(value)}</span>
              </p>
            )
          })}
        </div>
      )}

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((ratio) => {
          const value = leftDomain.min + spanOf(leftDomain) * ratio
          const lineY = yOn(leftDomain, value)
          return (
            <g key={`grid-${ratio}`}>
              <line
                x1={PADDING.left}
                x2={WIDTH - rightPadding}
                y1={lineY}
                y2={lineY}
                stroke="#eceef4"
                strokeWidth={1}
              />
              <text x={PADDING.left - 8} y={lineY + 3} textAnchor="end" className="fill-ink-muted text-[10px]">
                {axisFormatter(value)}
              </text>
              {hasRight ? (
                <text
                  x={WIDTH - rightPadding + 8}
                  y={lineY + 3}
                  textAnchor="start"
                  className="fill-ink-muted text-[10px]"
                >
                  {rightFormatter(rightDomain.min + spanOf(rightDomain) * ratio)}
                </text>
              ) : null}
            </g>
          )
        })}

        {leftDomain.min < 0 || rightDomain.min < 0 ? (
          <line
            x1={PADDING.left}
            x2={WIDTH - rightPadding}
            y1={yOn(leftDomain, 0)}
            y2={yOn(leftDomain, 0)}
            stroke="#c9ccd8"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ) : null}

        {labels.map((label, index) => {
          if (index % labelStep !== 0) return null
          return (
            <text
              key={`${label}-${index}`}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
              className="fill-ink-muted text-[10px]"
            >
              {label}
            </text>
          )
        })}

        {series.map((item) => {
          const domain = (item.axis ?? 'left') === 'right' ? rightDomain : leftDomain
          const baseY = yOn(domain, 0)
          return segmentsOf(item.values).map((segment, segmentIndex) => {
            const points = segment.map((point) => `${x(point.index)},${yOn(domain, point.value)}`).join(' ')
            return (
              <g key={`${item.key}-${segmentIndex}`}>
                {showArea && item.axis !== 'right' ? (
                  <path
                    d={`M ${x(segment[0]!.index)},${baseY} L ${points.split(' ').join(' L ')} L ${x(segment[segment.length - 1]!.index)},${baseY} Z`}
                    fill={item.color}
                    fillOpacity={0.08}
                    stroke="none"
                  />
                ) : null}
                <polyline
                  points={points}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={soft ? 1.5 : 2.25}
                  strokeOpacity={soft ? 0.7 : 1}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })
        })}

        {series.map((item) => {
          const domain = (item.axis ?? 'left') === 'right' ? rightDomain : leftDomain
          return item.values.map((value, index) => {
            if (value === null || !Number.isFinite(value)) return null
            if (!dots) return null
            return (
              <circle
                key={`${item.key}-${index}`}
                cx={x(index)}
                cy={yOn(domain, value)}
                r={soft ? 2 : 2.5}
                fill={item.color}
                fillOpacity={soft ? 0.7 : 1}
              >
                <title>{`${item.label} · ${labels[index] ?? ''}: ${seriesFormat(item)(value)}`}</title>
              </circle>
            )
          })
        })}

        {/* Area hover paling atas: menangkap pointer per bucket tanpa menghalangi
            pembaca layar (SVG tetap satu gambar dengan aria-label). */}
        {labels.map((label, index) => {
          const bandStart = index === 0 ? 0 : (x(index - 1) + x(index)) / 2
          const bandEnd = index === labels.length - 1 ? WIDTH : (x(index) + x(index + 1)) / 2
          return (
            <rect
              key={`hover-${label}-${index}`}
              x={bandStart}
              y={PADDING.top}
              width={Math.max(0, bandEnd - bandStart)}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
            />
          )
        })}
      </svg>
    </div>
  )
}

/** Legenda kecil untuk dipakai di luar grafik bila diperlukan. */
export function TrendLegend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">{children}</div>
}
