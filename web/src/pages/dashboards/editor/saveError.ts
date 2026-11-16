import { ApiError } from '@/auth/client'

export type SaveFailure = { kind: 'name' | 'invalid' | 'forbidden' | 'unavailable' | 'network' | 'other'; message: string }

export function describeSave(error: unknown): SaveFailure {
  if (!(error instanceof ApiError)) return { kind: 'network', message: 'The server did not answer, so nothing was saved. Your changes are still here.' }
  const body = error.body.trim()
  switch (error.status) {
    case 409:
      return { kind: 'name', message: 'A dashboard with that name already exists in this project.' }
    case 422:
      return { kind: 'invalid', message: body === '' ? 'The server refused this dashboard.' : `The server refused this dashboard: ${body}` }
    case 401:
    case 403:
    case 404:
      return { kind: 'forbidden', message: 'Not saved: you can not edit this dashboard. It may have been deleted, or it belongs to a project you are not a member of. Your changes are still here.' }
    case 413:
      return { kind: 'invalid', message: 'The server refused this dashboard: the document is too large.' }
    case 503:
      return { kind: 'unavailable', message: 'The dashboard store can not be reached right now. Nothing was saved, and your changes are still here.' }
    default:
      return { kind: 'other', message: body === '' || body.startsWith('<') ? 'The dashboard could not be saved. Your changes are still here.' : `The dashboard could not be saved: ${body}` }
  }
}

export const cannotWrite = (failure: SaveFailure): boolean => failure.kind === 'forbidden'
