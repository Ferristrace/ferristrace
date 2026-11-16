import { TimeChart } from './TimeChart'
import type { Of, PanelProps } from './types'

export const TimeSeriesPanel = (props: PanelProps<Of<'series'>>) => <TimeChart mode="line" {...props} />
