import { TriangleAlert } from 'lucide-react'
import { Alert } from '@/components/ui/misc'
import type { SaveFailure } from './saveError'

export function SaveNotice({ failure }: { failure: SaveFailure | null }) {
  if (!failure) return null
  return (
    <div data-failure={failure.kind}>
      <Alert variant="destructive" icon={<TriangleAlert aria-hidden />}>
        <span className="break-words">{failure.message}</span>
      </Alert>
    </div>
  )
}
