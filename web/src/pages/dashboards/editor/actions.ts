import { download } from '@/auth/blob'
import { FIXTURE_ID } from '@/data/dashboards'
import { fileOf } from './draft'
import { fileNameOf, serialise } from './files'
import { fixtureDraft } from './fixtureStore'

function saveText(text: string, name: string): void {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportDashboard(id: string, name: string): Promise<void> {
  if (id === FIXTURE_ID) {
    const file = fileOf(fixtureDraft())
    saveText(serialise(file), fileNameOf(file.name))
    return
  }
  await download(`/api/v1/dashboards/${encodeURIComponent(id)}/export`, fileNameOf(name))
}
