import { useMemo } from 'react'
import { LineChart } from '@/components/ft/charts'
import type { FrameStatus } from '@/components/ft/ChartFrame'
import { axisLabels, formatValue } from '@/components/ft/panels/geometry'
import { ceiling, timeLabels } from '@/data/series'
import { ERROR_THRESHOLD, charted, useServiceSeries } from '@/data/services'
import type { ReleaseDetail } from '@/data/releases'
import { because } from '@/auth/client'
import { AROUND_RELEASE_MS, pointOf, releaseWindow } from './serviceView'

const axis = (hi: number, unit: string, blank: boolean): [string, string, string] => {
  if (blank) return ['', '', '']
  const [top, middle, bottom] = axisLabels([hi, hi / 2, 0], unit)
  return [top, middle, bottom]
}

const errorFormat = (value: number) => (value === 0 ? '0 %' : value < 1 ? `${value.toFixed(2)} %` : `${value.toFixed(1)} %`)

export function ReleaseAround({ release }: { release: ReleaseDetail }) {
  const when = useMemo(() => releaseWindow(release.firstSeenMs, Date.now()), [release.firstSeenMs])
  const { series, pending, failed } = useServiceSeries(release.service, '', when.windowMs, undefined, when.shiftMs)
  const lines = charted(series)
  const points = series?.points ?? []
  const first = points[0]?.atMs ?? when.fromMs
  const to = points.length ? points[points.length - 1].atMs + (series?.stepMs ?? 0) : when.toMs
  const labels = timeLabels(first, to)
  const times = points.map((point) => point.atMs)
  const at = series ? pointOf(release.firstSeenMs, first, series.stepMs) : 0
  const markers = at >= 0 && at <= points.length - 1 ? [{ at, label: release.version }] : []
  const errHi = Math.max(ceiling(lines.errorRate), ERROR_THRESHOLD * 2)
  const latencyHi = ceiling(lines.p95)
  const hours = Math.round(AROUND_RELEASE_MS / 3_600_000)
  const windowLabel = `${hours} h around ${release.version}`
  const status: FrameStatus | undefined = failed
    ? { kind: 'error', text: because(failed, 'The series could not be read.') }
    : pending
      ? { kind: 'loading', text: 'Reading the series…' }
      : points.length === 0
        ? { kind: 'empty', text: `No spans of ${release.service} around this release.` }
        : undefined
  const blank = status !== undefined
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
      <LineChart title="Error rate around the release" legend={`${release.service}, whole service · dashed: ${ERROR_THRESHOLD} % status page threshold`} values={lines.errorRate} windowLabel={windowLabel} status={status} markers={markers} threshold={ERROR_THRESHOLD} hi={errHi} yLabels={axis(errHi, '%', blank)} xLabels={labels} aria={`Error rate of ${release.service} around release ${release.version}`} times={times} format={errorFormat} />
      <LineChart title="p95 latency around the release" legend={`${release.service}, whole service`} values={lines.p95} windowLabel={windowLabel} status={status} markers={markers} hi={latencyHi} yLabels={axis(latencyHi, 'ms', blank)} xLabels={labels} aria={`p95 latency of ${release.service} around release ${release.version}`} times={times} format={(ms) => formatValue(ms, 'ms')} />
    </div>
  )
}
