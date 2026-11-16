import { createContext, useContext } from 'react'
import type { Range } from '@/components/ft/panels/types'
import type { Source, VariableDoc } from '@/data/dashboards'

export type EditorEnv = {
  fixture: boolean
  source: Source
  variables: VariableDoc[]
  range: Range
  sent: Record<string, string[]>
}

const NOTHING: EditorEnv = { fixture: false, source: 'server', variables: [], range: { fromNs: 0, toNs: 0 }, sent: {} }

const EnvContext = createContext<EditorEnv>(NOTHING)

export const EditorEnvProvider = EnvContext.Provider

export const useEditorEnv = (): EditorEnv => useContext(EnvContext)
