import { LayoutDashboard } from 'lucide-react'
import { EmptyState } from '@/components/ft/bits'

export const needsProject = (project: string | undefined, fixture: boolean): boolean => !fixture && !project

export function PickProject({ what = 'its dashboards' }: { what?: string }) {
  return <EmptyState icon={<LayoutDashboard />} title="Pick a project">Dashboards belong to a project. Choose one in the top bar to see {what}.</EmptyState>
}
