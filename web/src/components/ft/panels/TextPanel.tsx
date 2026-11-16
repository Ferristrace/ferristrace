import { Markdown } from '@/lib/markdown'
import { Filled, PanelEmpty } from './Empty'
import type { PanelProps } from './types'

export function TextPanel({ panel }: PanelProps) {
  const content = panel.options.content?.trim() ?? ''
  if (content === '') return <PanelEmpty>This text panel is empty</PanelEmpty>
  return (
    <Filled className="overflow-auto">
      <Markdown source={content} minLevel={3} />
    </Filled>
  )
}
