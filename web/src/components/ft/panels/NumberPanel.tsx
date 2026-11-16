import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { formatValue, thresholdTone, type Thresholds } from './geometry'
import type { Of, PanelProps } from './types'

const TONE = { neutral: 'text-foreground', warn: 'text-warning-text', critical: 'text-destructive-text' }

export function NumberPanel({ panel, result, thresholds }: PanelProps<Of<'scalar'>> & { thresholds?: Thresholds }) {
  if (result.value === null) return <PanelEmpty />
  const { options } = panel
  const tone = thresholdTone(result.value, thresholds)
  const unit = options.unit?.trim() ?? ''
  const text = formatValue(result.value, '', options.decimals)
  return (
    <Filled className="items-center justify-center gap-1">
      <span role="img" aria-label={`${panel.title || 'Value'}: ${text}${unit ? ` ${unit}` : ''}`} className={cn('font-mono text-[40px] font-semibold leading-[48px]', TONE[tone])}>
        {text}
        {unit ? <span className="ml-1.5 text-heading font-medium text-muted-foreground">{unit}</span> : null}
      </span>
      {tone !== 'neutral' ? <span className={cn('text-caption', TONE[tone])}>{tone === 'critical' ? 'Above the critical threshold' : 'Above the warning threshold'}</span> : null}
    </Filled>
  )
}
