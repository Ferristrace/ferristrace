import { AreaPanel } from './AreaPanel'
import { BarPanel } from './BarPanel'
import { DataTablePanel } from './DataTablePanel'
import { PanelEmpty } from './Empty'
import { HeatmapPanel } from './HeatmapPanel'
import { HistogramPanel } from './HistogramPanel'
import { ListPanel } from './ListPanel'
import { NumberPanel } from './NumberPanel'
import { PiePanel } from './PiePanel'
import { ScatterPanel } from './ScatterPanel'
import { TextPanel } from './TextPanel'
import { TimeSeriesPanel } from './TimeSeriesPanel'
import type { PanelProps } from './types'

export { AreaPanel, BarPanel, DataTablePanel, HeatmapPanel, HistogramPanel, ListPanel, NumberPanel, PiePanel, ScatterPanel, TextPanel, TimeSeriesPanel }

function Mismatch({ want, got }: { want: string; got: string }) {
  return <PanelEmpty hint={`The server answered ${got} where this panel reads ${want}.`}>Unexpected result</PanelEmpty>
}

export function PanelBody(props: PanelProps) {
  const { panel, result } = props
  switch (panel.kind) {
    case 'text':
      return <TextPanel {...props} />
    case 'time_series':
      return result.kind === 'series' ? <TimeSeriesPanel {...props} result={result} /> : <Mismatch want="series" got={result.kind} />
    case 'area':
      return result.kind === 'series' ? <AreaPanel {...props} result={result} /> : <Mismatch want="series" got={result.kind} />
    case 'bar':
      return result.kind === 'series' ? <BarPanel {...props} result={result} /> : <Mismatch want="series" got={result.kind} />
    case 'pie':
      return result.kind === 'rows' ? <PiePanel {...props} result={result} /> : <Mismatch want="rows" got={result.kind} />
    case 'table':
      return result.kind === 'rows' ? <DataTablePanel {...props} result={result} /> : <Mismatch want="rows" got={result.kind} />
    case 'list':
      return result.kind === 'rows' ? <ListPanel {...props} result={result} /> : <Mismatch want="rows" got={result.kind} />
    case 'scatter':
      return result.kind === 'pairs' ? <ScatterPanel {...props} result={result} /> : <Mismatch want="pairs" got={result.kind} />
    case 'histogram':
      return result.kind === 'buckets' ? <HistogramPanel {...props} result={result} /> : <Mismatch want="buckets" got={result.kind} />
    case 'heatmap':
      return result.kind === 'heat' ? <HeatmapPanel {...props} result={result} /> : <Mismatch want="heat" got={result.kind} />
    case 'number':
      return result.kind === 'scalar' ? <NumberPanel {...props} result={result} /> : <Mismatch want="scalar" got={result.kind} />
  }
}
