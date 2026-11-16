import { TimeChart } from './TimeChart'
import type { Of, PanelProps } from './types'

export const AreaPanel = (props: PanelProps<Of<'series'>>) => <TimeChart mode="area" {...props} />
