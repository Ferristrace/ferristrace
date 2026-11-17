import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { MenuTitle } from './menus'
import { Spark } from './Spark'
import type { SparkStyle } from './sparkGeometry'

const STYLES: { value: SparkStyle; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'bars', label: 'Bars' },
]

export type Preview = { values: (number | null)[]; times: number[]; format: (value: number) => string } | null

export function AddChartColumn<M extends string>({ metrics, preview, onAdd, windowLabel }: { metrics: { value: M; label: string }[]; preview: (metric: M) => Preview; onAdd: (metric: M, style: SparkStyle) => void; windowLabel: string }) {
  const [open, setOpen] = useState(false)
  const [metric, setMetric] = useState<M>(metrics[0].value)
  const [style, setStyle] = useState<SparkStyle>('line')
  const shown = preview(metric)
  const label = metrics.find((one) => one.value === metric)?.label ?? metric
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="h-[34px] border-primary"><Plus aria-hidden />Add chart column</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-24px)] p-3">
        <MenuTitle>Add a chart column</MenuTitle>
        <label className="mb-1.5 block text-[11px] font-semibold text-faint-foreground" htmlFor="chart-metric">Metric</label>
        <NativeSelect id="chart-metric" value={metric} onChange={(event) => setMetric(event.target.value as M)} className="mb-3 h-9">
          {metrics.map((one) => <option key={one.value} value={one.value}>{one.label}</option>)}
        </NativeSelect>
        <div className="mb-1.5 text-[11px] font-semibold text-faint-foreground" id="chart-style">Style</div>
        <div role="group" aria-labelledby="chart-style" className="mb-3 flex overflow-hidden rounded-sm border border-line-strong">
          {STYLES.map((one) => (
            <button key={one.value} type="button" aria-pressed={one.value === style} onClick={() => setStyle(one.value)} className={cn('h-[30px] flex-1 cursor-pointer border-r border-line-strong text-control text-muted-foreground last:border-r-0 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', one.value === style && 'bg-accent-subtle text-foreground')}>{one.label}</button>
          ))}
        </div>
        <div className="mb-3 flex h-14 items-center justify-center rounded-sm border bg-card">
          {shown ? <Spark values={shown.values} times={shown.times} style={style} format={shown.format} label={`${label} preview`} /> : <span className="text-caption text-muted-foreground">No series loaded yet</span>}
        </div>
        <p className="m-0 mb-3 text-caption text-muted-foreground">Over the page window ({windowLabel}).</p>
        <div className="flex gap-2">
          <Button size="sm" className="h-[34px] flex-1" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" variant="primary" className="h-[34px] flex-1" onClick={() => { onAdd(metric, style); setOpen(false) }}>Add column</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
