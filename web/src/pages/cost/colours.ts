import { colourOf } from '@/components/ft/panels/geometry'
import type { Signal } from '@/data/usage'

export const SIGNAL_COLOUR: Record<Signal, string> = { spans: colourOf(0), logs: colourOf(1), metrics: colourOf(2) }
