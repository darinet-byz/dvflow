import { useState } from 'react'

/**
 * Grafik perbandingan ringan (SVG native) untuk halaman Performa (A56).
 *
 * Satu kelompok per batch/produk:
 *   * bar untuk seri Rupiah (Spend, Omzet) pada sumbu kiri;
 *   * garis + titik untuk seri hitungan (Tiket) pada sumbu kanan.
 *
 * Dua sumbu dipakai karena Spend/Omzet (jutaan Rupiah) dan Tiket (satuan) tidak
 * mungkin dibaca di satu skala. Tanpa library chart, mengikuti batas teknis repo.
 */

export type ComparisonSeries = {
  key: string
  label: string
  color: string
  /** Sejajar dengan `labels`; `null` = tidak ada nilai. */
  values: Array<number | null>
  axis?: 'left' | 'right'
  type?: 'bar' | 'line'
  /** Format tooltip khusus seri ini; default memakai `formatValue`. */
  format?: (value: number) => string
}

export type ComparisonChartProps = {
  labels: string[]
  series: ComparisonSeries[]
  formatValue: (value: number) => string
  formatAxis?: (value: number) => string
  formatAxisRight?: (value: number) => string
  ariaLabel: string
  height?: number
  /** Jumlah label sumbu X maksimal; sisanya dilewati agar tidak berdesakan. */
  maxLabels?: number
}

const WIDTH = 640
const PADDING = { top: 14, right: 14, bottom: 38, left: 64 }
const RIGHT_AXIS_WIDTH = 48
const LABEL_MAX_CHARS = 14

type Domain = { min: number; max: number }

function domainOf(values: Array<number | null>): Domain {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (numbers.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...numbers, 0), max: Math.max(...numbers, 0) }
}

function truncateLabel(value: string): string {
  return value.length <= LABEL_MAX_CHARS ? value : `${value.slice(0, LABEL_MAX_CHARS - 1)}…`
}

export function ComparisonChart({
  labels,
  series,
  formatValue,
  formatAxis,
  formatAxisRight,
  ariaLabel,
  height = 230,
  maxLabels = 8,
}: ComparisonChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const barSeries = series.filter((item) => (item.type ?? 'bar') === 'bar')
  const lineSeries = series.filter((item) => item.type === 'line')
  const hasRight = lineSeries.length > 0
  const rightPadding = hasRight ? PADDING.right + RIGHT_AXIS_WIDTH : PADDING.right
  const innerWidth = WIDTH - PADDING.left - rightPadding
  const innerHeight = height - PADDING.top - PADDING.bottom

  const leftDomain = domainOf(barSeries.flatMap((item) => item.values))
  const rightDomain = domainOf(lineSeries.flatMap((item) => item.values))
  const spanOf = (domain: Domain) => domain.max - domain.min || 1
  const yOn = (domain: Domain, value: number) =>
    PADDING.top + innerHeight - ((value - domain.min) / spanOf(domain)) * innerHeight

  const bandWidth = labels.length === 0 ? innerWidth : innerWidth / labels.length
  const center = (index: number) => PADDING.left + bandWidth * (index + 0.5)
  const groupWidth = Math.min(bandWidth * 0.62, 64)
  const barWidth = barSeries.length === 0 ? 0 : groupWidth / barSeries.length
  const labelStep = Math.max(1, Math.ceil(labels.length / maxLabels))
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const axisFormatter = formatAxis ?? formatValue
  const rightFormatter = formatAxisRight ?? formatValue
  const active = hovered !== null && hovered >= 0 && hovered < labels.length ? hovered : null
  const seriesFormat = (item: ComparisonSeries) => item.format ?? formatValue

  if (labels.length === 0) return null

  return (
    <div className="relative min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={item.type === 'line' ? 'h-2 w-2 rounded-full' : 'h-2 w-2 rounded-xs'}
              style={{ backgroundColor: item.color }}
            />
            {item.label}
            {hasRight && item.axis === 'right' ? <span className="text-ink-muted">(kanan)</span> : null}
          </span>
        ))}
        <span className="ml-auto text-ink-muted">Arahkan kursor untuk melihat angka</span>
      </div>

      {active === null ? null : (
        <div className="pointer-events-none absolute right-2 top-7 z-10 min-w-[160px] rounded-md border border-line bg-card/95 px-2.5 py-2 shadow-card">
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

        {leftDomain.min < 0 ? (
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

        {barSeries.map((item, seriesIndex) => {
          const baseY = yOn(leftDomain, 0)
          return item.values.map((value, index) => {
            if (value === null || !Number.isFinite(value)) return null
            const valueY = yOn(leftDomain, value)
            const barX = center(index) - groupWidth / 2 + seriesIndex * barWidth
            return (
              <rect
                key={`${item.key}-${index}`}
                x={barX + 1}
                y={Math.min(valueY, baseY)}
                width={Math.max(barWidth - 2, 1)}
                height={Math.max(Math.abs(valueY - baseY), 0)}
                rx={2}
                fill={item.color}
                fillOpacity={0.85}
              >
                <title>{`${item.label} · ${labels[index] ?? ''}: ${seriesFormat(item)(value)}`}</title>
              </rect>
            )
          })
        })}

        {lineSeries.map((item) => {
          const points = item.values
            .map((value, index) =>
              value === null || !Number.isFinite(value) ? null : `${center(index)},${yOn(rightDomain, value)}`,
            )
            .filter((point): point is string => point !== null)
          return (
            <g key={item.key}>
              {points.length > 1 ? (
                <polyline
                  points={points.join(' ')}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {item.values.map((value, index) => {
                if (value === null || !Number.isFinite(value)) return null
                return (
                  <circle key={`${item.key}-${index}`} cx={center(index)} cy={yOn(rightDomain, value)} r={3} fill={item.color}>
                    <title>{`${item.label} · ${labels[index] ?? ''}: ${seriesFormat(item)(value)}`}</title>
                  </circle>
                )
              })}
            </g>
          )
        })}

        {labels.map((label, index) => {
          if (index % labelStep !== 0) return null
          return (
            <text
              key={`${label}-${index}`}
              x={center(index)}
              y={height - 10}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
            >
              {truncateLabel(label)}
            </text>
          )
        })}

        {labels.map((label, index) => (
          <rect
            key={`hover-${label}-${index}`}
            x={PADDING.left + bandWidth * index}
            y={PADDING.top}
            width={bandWidth}
            height={innerHeight}
            fill="transparent"
            onMouseEnter={() => setHovered(index)}
          />
        ))}
      </svg>
    </div>
  )
}
