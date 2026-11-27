import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type ViteDevServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(tmpdir(), 'ferristrace-web-tests', String(process.pid))

let started: Promise<ViteDevServer> | null = null

const server = (): Promise<ViteDevServer> => {
  started ??= createServer({
    root,
    cacheDir,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return started
}

export async function load<T = Record<string, unknown>>(file: string): Promise<T> {
  const vite = await server()
  return (await vite.ssrLoadModule(`/src/${file}`)) as T
}

export async function stop(): Promise<void> {
  if (started) await (await started).close()
  started = null
  await rm(cacheDir, { recursive: true, force: true })
}

export const html = (element: ReactElement): string => renderToStaticMarkup(element)

export { createElement }
