import type { ReactNode } from 'react'

/**
 * Grafik garis ringan (SVG native).
 *
 * A46: halaman Performa membutuhkan dua grafik kecil (uang dan volume) tanpa
 * menambah library chart. Komponen ini hanya menggambar; pemanggil menentukan
 * seri, warna, dan format nilai. Tabel di halaman tetap menjadi fallback data
 * yang dapat dibaca pembaca layar.
 */

export type TrendSeries = {
  key: string
  label: string
  /** Warna hex dari token desain (styles.css). */
  color: string
  /** `null` = tidak ada data pada titik itu; garis diputus, bukan dianggap nol. */
  values: Array<number | null>
}

export type TrendChartProps = {
  labels: string[]
  series: TrendSeries[]
  /** Format tooltip dan angka data. */
  formatValue: (value: number) => string
  /** Format label sumbu Y; default sama dengan `formatValue`. */
  formatAxis?: (value: number) => string
  ariaLabel: string
  height?: number
  /** Tampilkan titik pada setiap data; otomatis dimatikan bila titik terlalu banyak. */
  showDots?: boolean
  /** Garis tipis dan transparan (dipakai grafik Performa). */
  soft?: boolean
}

const WIDTH = 640
const PADDING = { top: 14, right: 14, bottom: 30, left: 64 }

export function TrendChart({
  labels,
  series,
  formatValue,
  formatAxis,
  ariaLabel,
  height = 200,
  showDots,
  soft = false,
}: TrendChartProps) {
  const axisFormatter = formatAxis ?? formatValue
  const innerWidth = WIDTH - PADDING.left - PADDING.right
  const innerHeight = height - PADDING.top - PADDING.bottom
  const allValues = series.flatMap((item) => item.values).filter((value): value is number => value !== null && Number.isFinite(value))
  const rawMin = allValues.length === 0 ? 0 : Math.min(...allValues)
  const rawMax = allValues.length === 0 ? 0 : Math.max(...allValues)
  const min = Math.min(rawMin, 0)
  const max = Math.max(rawMax, 0)
  const span = max - min || 1
  const x = (index: number) => {
    if (labels.length <= 1) return PADDING.left + innerWidth / 2
    return PADDING.left + (index / (labels.length - 1)) * innerWidth
  }
  const y = (value: number) => PADDING.top + innerHeight - ((value - min) / span) * innerHeight
  const dots = showDots ?? labels.length <= 31
  const labelStep = Math.max(1, Math.ceil(labels.length / 6))
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((ratio) => {
          const value = min + span * ratio
          const lineY = y(value)
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={lineY}
                y2={lineY}
                stroke="#eceef4"
                strokeWidth={1}
              />
              <text x={PADDING.left - 8} y={lineY + 3} textAnchor="end" className="fill-ink-muted text-[10px]">
                {axisFormatter(value)}
              </text>
            </g>
          )
        })}

        {min < 0 ? (
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(0)}
            y2={y(0)}
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
          const points = item.values
            .map((value, index) => (value === null || !Number.isFinite(value) ? null : `${x(index)},${y(value)}`))
            .filter((point): point is string => point !== null)
          if (points.length === 0) return null
          return (
            <g key={item.key}>
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke={item.color}
                strokeWidth={soft ? 1.5 : 2.25}
                strokeOpacity={soft ? 0.7 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {dots
                ? item.values.map((value, index) => {
                    if (value === null || !Number.isFinite(value)) return null
                    return (
                      <circle key={`${item.key}-${index}`} cx={x(index)} cy={y(value)} r={soft ? 2 : 2.5} fill={item.color} fillOpacity={soft ? 0.7 : 1}>
                        <title>{`${item.label} · ${labels[index] ?? ''}: ${formatValue(value)}`}</title>
                      </circle>
                    )
                  })
                : null}
            </g>
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
