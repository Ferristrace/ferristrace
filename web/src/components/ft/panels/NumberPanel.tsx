import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { formatValue, isScaledUnit, thresholdTone, type Thresholds } from './geometry'
import type { Of, PanelProps } from './types'

const TONE = { neutral: 'text-foreground', warn: 'text-warning-text', critical: 'text-destructive-text' }

export function NumberPanel({ panel, result, thresholds }: PanelProps<Of<'scalar'>> & { thresholds?: Thresholds }) {
  if (result.value === null) return <PanelEmpty />
  const { options } = panel
  const tone = thresholdTone(result.value, thresholds)
  const unit = options.unit?.trim() ?? ''
  const joined = isScaledUnit(unit)
  const text = formatValue(result.value, joined ? unit : '', options.decimals)
  const size = text.length > 12 ? 'text-[24px] leading-[30px]' : text.length > 9 ? 'text-[30px] leading-[38px]' : text.length > 6 ? 'text-[36px] leading-[44px]' : 'text-[40px] leading-[48px]'
  return (
    <Filled className="items-center justify-center gap-1">
      <span role="img" aria-label={`${panel.title || 'Value'}: ${text}${unit && !joined ? ` ${unit}` : ''}`} className={cn('max-w-full break-words text-center font-mono font-semibold', size, TONE[tone])}>
        {text}
        {unit && !joined ? <span className="ml-1.5 text-heading font-medium text-muted-foreground">{unit}</span> : null}
      </span>
      {tone !== 'neutral' ? <span className={cn('text-caption', TONE[tone])}>{tone === 'critical' ? 'Above the critical threshold' : 'Above the warning threshold'}</span> : null}
    </Filled>
  )
}
