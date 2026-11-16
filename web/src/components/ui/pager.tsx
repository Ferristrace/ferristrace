import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { pageNumbers, pagesOf } from '@/lib/paging'
import { cn } from '@/lib/utils'

const SIZES = [10, 25, 50, 100]

const square = 'inline-flex size-[30px] cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-control text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-3.5'

export function Pager({ total, page, size, onPage, onSize, noun = 'rows', className }: { total: number; page: number; size: number; onPage: (page: number) => void; onSize?: (size: number) => void; noun?: string; className?: string }) {
  const pages = pagesOf(total, size)
  const first = total === 0 ? 0 : (page - 1) * size + 1
  const last = Math.min(total, page * size)
  return (
    <nav aria-label="Pages" className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-3 py-3 text-control text-muted-foreground md:justify-end', className)}>
      <span className="tabular">Showing {first.toLocaleString('en-US')}–{last.toLocaleString('en-US')} of {total.toLocaleString('en-US')} {noun}</span>
      {onSize ? (
        <label className="flex items-center gap-2">Rows per page
          <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-[30px] cursor-pointer rounded-md border border-input bg-card px-2 text-control text-foreground">
            {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      {pages > 1 ? (
        <span className="flex items-center gap-0.5">
          <button type="button" className={square} aria-label="First page" disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft aria-hidden /></button>
          <button type="button" className={square} aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden /></button>
          {pageNumbers(page, pages).map((n, i) => n === null
            ? <span key={`gap-${i}`} className="w-5 text-center" aria-hidden>…</span>
            : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} className={cn(square, 'tabular', n === page && 'border-line-strong bg-card font-semibold text-foreground')} onClick={() => onPage(n)}>{n}</button>)}
          <button type="button" className={square} aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}><ChevronRight aria-hidden /></button>
          <button type="button" className={square} aria-label="Last page" disabled={page === pages} onClick={() => onPage(pages)}><ChevronsRight aria-hidden /></button>
        </span>
      ) : null}
    </nav>
  )
}
