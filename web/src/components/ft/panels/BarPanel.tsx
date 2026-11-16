import { TimeChart } from './TimeChart'
import type { Of, PanelProps } from './types'

export const BarPanel = (props: PanelProps<Of<'series'>>) => <TimeChart mode="bar" {...props} />
