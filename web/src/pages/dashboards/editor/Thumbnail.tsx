import type { PanelKind } from '@/data/dashboards'

const BARS = [18, 30, 22, 36, 26, 14, 32]

const HIST = [4, 9, 17, 28, 34, 26, 15, 8, 4]

const HEAT = [0.1, 0.3, 0.6, 0.2, 0.5, 0.9, 0.4, 0.2, 0.7, 0.3, 0.15, 0.55, 0.25, 0.8, 0.35, 0.1, 0.4, 0.2, 0.65, 0.3]

function Shape({ kind }: { kind: PanelKind }) {
  switch (kind) {
    case 'time_series':
      return (
        <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="8,34 20,26 30,30 42,16 54,22 66,12 72,15" className="stroke-series" />
          <polyline points="8,38 20,35 30,36 42,30 54,32 66,27 72,29" className="stroke-series opacity-40" />
        </g>
      )
    case 'area':
      return (
        <g>
          <polygon points="8,40 8,32 20,24 30,28 42,14 54,20 66,10 72,13 72,40" className="fill-series opacity-25" />
          <polyline points="8,32 20,24 30,28 42,14 54,20 66,10 72,13" fill="none" strokeWidth="1.8" strokeLinejoin="round" className="stroke-series" />
        </g>
      )
    case 'bar':
      return (
        <g className="fill-series">
          {BARS.map((height, at) => (
            <rect key={at} x={9 + at * 9} y={40 - height} width="6" height={height} rx="1" />
          ))}
        </g>
      )
    case 'pie':
      return (
        <g fill="none" strokeWidth="12" transform="rotate(-90 40 24)">
          <circle cx="40" cy="24" r="12" strokeDasharray="38 76" className="stroke-series" />
          <circle cx="40" cy="24" r="12" strokeDasharray="22 76" strokeDashoffset="-38" className="stroke-series opacity-55" />
          <circle cx="40" cy="24" r="12" strokeDasharray="15 76" strokeDashoffset="-60" className="stroke-series opacity-25" />
        </g>
      )
    case 'scatter':
      return (
        <g className="fill-series">
          {[[14, 32], [22, 26], [28, 34], [36, 20], [42, 28], [50, 14], [58, 22], [64, 12], [68, 24]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" />
          ))}
        </g>
      )
    case 'histogram':
      return (
        <g className="fill-series">
          {HIST.map((height, at) => (
            <rect key={at} x={9 + at * 7} y={40 - height} width="6" height={height} />
          ))}
        </g>
      )
    case 'heatmap':
      return (
        <g className="fill-series">
          {HEAT.map((level, at) => (
            <rect key={at} x={10 + (at % 5) * 12} y={8 + Math.floor(at / 5) * 8} width="11" height="7" rx="1" opacity={level} />
          ))}
        </g>
      )
    case 'number':
      return (
        <text x="40" y="33" textAnchor="middle" fontSize="22" fontWeight="600" className="fill-series font-mono">
          128
        </text>
      )
    case 'table':
      return (
        <g fill="none" strokeWidth="1.2" className="stroke-border">
          <rect x="9" y="9" width="62" height="30" rx="2" />
          <line x1="9" y1="17" x2="71" y2="17" className="stroke-series" strokeWidth="1.8" />
          <line x1="9" y1="25" x2="71" y2="25" />
          <line x1="9" y1="32" x2="71" y2="32" />
          <line x1="30" y1="9" x2="30" y2="39" />
          <line x1="50" y1="9" x2="50" y2="39" />
        </g>
      )
    case 'list':
      return (
        <g>
          {[12, 21, 30].map((y) => (
            <g key={y}>
              <circle cx="13" cy={y} r="2" className="fill-series" />
              <rect x="20" y={y - 2} width="50" height="4" rx="2" className="fill-border" />
            </g>
          ))}
        </g>
      )
    case 'text':
      return (
        <g>
          <rect x="10" y="10" width="26" height="5" rx="2" className="fill-series" />
          <rect x="10" y="20" width="60" height="3" rx="1.5" className="fill-border" />
          <rect x="10" y="27" width="52" height="3" rx="1.5" className="fill-border" />
          <rect x="10" y="34" width="36" height="3" rx="1.5" className="fill-border" />
        </g>
      )
  }
}

export function Thumbnail({ kind }: { kind: PanelKind }) {
  return (
    <svg viewBox="0 0 80 48" aria-hidden className="h-12 w-20 shrink-0 rounded-md border bg-muted" data-thumbnail={kind}>
      <Shape kind={kind} />
    </svg>
  )
}
