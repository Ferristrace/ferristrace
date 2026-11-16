import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import './grid.css'
import { useEffect } from 'react'
import type { Mark, Range } from '@/components/ft/panels/types'
import type { LayoutItem, PanelDoc, Source } from '@/data/dashboards'
import { useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'
import { PanelCard } from '../PanelCard'
import { COLUMNS } from './grid'
import { PanelFrame, type FrameActions } from './PanelFrame'

const ROW_PX = 56

const GAP_PX = 12

const NO_ZOOM = () => undefined

type Props = {
  panels: PanelDoc[]
  layout: LayoutItem[]
  range: Range
  sent: Record<string, string[]>
  source: Source
  markers: Mark[]
  selected: string | null
  canDuplicate: boolean
  status: string
  onSelect: (id: string | null) => void
  onLayout: (layout: LayoutItem[]) => void
  actionsFor: (id: string) => FrameActions
}

function Item({ panel, props, narrow }: { panel: PanelDoc; props: Props; narrow: boolean }) {
  const selected = props.selected === panel.id
  return (
    <div className="flex h-full min-h-0 flex-col" data-item={panel.id}>
      <PanelFrame panel={panel} selected={selected} narrow={narrow} canDuplicate={props.canDuplicate} actions={props.actionsFor(panel.id)} />
      <div
        className={cn('min-h-0 flex-1 rounded-b-lg [&>section]:rounded-t-none', selected && '[&>section]:border-ring')}
        onClick={() => props.onSelect(panel.id)}
        onDoubleClick={() => props.actionsFor(panel.id).onEdit()}
      >
        <div inert className="h-full">
          <PanelCard panel={panel} range={props.range} sent={props.sent} source={props.source} markers={props.markers} onZoom={NO_ZOOM} />
        </div>
      </div>
    </div>
  )
}

export function GridEditor(props: Props) {
  const wide = useMedia('(min-width: 768px)')
  const { width, containerRef, mounted } = useContainerWidth()
  const byId = new Map(props.layout.map((item) => [item.panel, item]))
  const items: Layout = props.panels.flatMap((panel) => {
    const item = byId.get(panel.id)
    return item ? [{ i: panel.id, x: item.x, y: item.y, w: item.w, h: item.h }] : []
  })

  useEffect(() => {
    if (props.selected) document.querySelector(`[data-item="${CSS.escape(props.selected)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const commit = (layout: Layout) => props.onLayout(layout.map((one) => ({ panel: one.i, x: one.x, y: one.y, w: one.w, h: one.h })))

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{props.status}</p>
      {wide ? (
        <div ref={containerRef} className="ft-grid-host">
          {mounted ? (
            <ReactGridLayout
              className="ft-grid"
              width={width}
              layout={items}
              gridConfig={{ cols: COLUMNS, rowHeight: ROW_PX, margin: [GAP_PX, GAP_PX], containerPadding: [0, 0], maxRows: Infinity }}
              dragConfig={{ enabled: true, bounded: false, handle: '.panel-handle', threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              compactor={verticalCompactor}
              onDragStop={commit}
              onResizeStop={commit}
            >
              {props.panels.map((panel) => (
                <div key={panel.id}>
                  <Item panel={panel} props={props} narrow={false} />
                </div>
              ))}
            </ReactGridLayout>
          ) : null}
        </div>
      ) : (
        <ol aria-label="Panels" className="m-0 flex list-none flex-col gap-3 p-0">
          {props.panels.map((panel) => (
            <li key={panel.id} className="h-[260px]">
              <Item panel={panel} props={props} narrow />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
