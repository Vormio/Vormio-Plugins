// A stand-in for the Vormio host, close enough to run the plugin pages in Chromium: package files on
// one origin with the host's page CSP, input files on another origin with CORS, and companion reads
// limited to the manifest's companionFormats as the host limits them. It does not reproduce the
// host's sandbox, partitions or read verification; Vormio-Core's own tests cover those.

import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import type { PluginInput } from '@vormio/plugin-sdk'

/** The CSP Vormio-Core 0.0.2 sends with every plugin file, with `vormio-input:` as `input`. */
function pageCsp(input: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${input}`,
    `media-src 'self' blob: ${input}`,
    `connect-src 'self' blob: data: ${input}`,
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

export interface MockHost {
  pluginOrigin: string
  /** Binds `path` (inside the fixtures folder) like the host binds an observed version. */
  input(path: string): Promise<PluginInput>
  /** `<status> <path>` of every input request, in order. */
  requests: string[]
  close(): Promise<void>
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.statusCode = 500
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

export async function startHost(
  pluginDirectory: string,
  inputDirectory: string,
): Promise<MockHost> {
  const manifest = JSON.parse(await readFile(join(pluginDirectory, 'manifest.json'), 'utf8')) as {
    contributions: Record<string, { companionFormats?: string[] }[]>
  }
  // The host checks each page against its own contribution; one set for all pages is close enough
  // for these tests, where a plugin's pages declare the same companions or none.
  const companionFormats = new Set(
    Object.values(manifest.contributions).flatMap((list) =>
      list.flatMap((each) => each.companionFormats ?? []),
    ),
  )
  const bindings = new Map<string, string>()
  const requests: string[] = []

  const inputs = await listen(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.setHeader('Access-Control-Allow-Headers', 'Range')
      return void response.end()
    }
    const [, token = '', ...segments] = new URL(request.url ?? '/', 'http://input').pathname.split(
      '/',
    )
    const main = bindings.get(token)
    let path: string
    try {
      path = segments.map(decodeURIComponent).join('/')
    } catch {
      path = ''
    }
    const status = await (async () => {
      if (!main) return 410
      if (!path || path.split('/').includes('..')) return 400
      if (path !== main && !companionFormats.has(extname(path).slice(1).toLowerCase())) return 403
      const info = await stat(join(inputDirectory, path)).catch(() => undefined)
      return info?.isFile() ? 200 : 404
    })()
    if (status !== 200) {
      requests.push(`${status} ${path}`)
      response.statusCode = status
      return void response.end()
    }
    const data = await readFile(join(inputDirectory, path))
    response.setHeader('Content-Type', 'application/octet-stream')
    response.setHeader('Accept-Ranges', 'bytes')
    // A single byte range, as the host serves it.
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
    if (range) {
      const start = Number(range[1])
      const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1)
      requests.push(`206 ${path} ${start}-${end}`)
      response.statusCode = 206
      response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`)
      return void response.end(data.subarray(start, end + 1))
    }
    requests.push(`200 ${path}`)
    response.end(data)
  })

  const packageFiles = await listen(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://package').pathname.slice(1))
    const data = path.includes('..')
      ? undefined
      : await readFile(join(pluginDirectory, path)).catch(() => undefined)
    if (!data) {
      response.statusCode = 404
      return void response.end()
    }
    response.setHeader('Content-Type', mimeTypes[extname(path)] ?? 'application/octet-stream')
    response.setHeader('Content-Security-Policy', pageCsp(inputs.origin))
    response.setHeader('Cache-Control', 'no-store')
    response.end(data)
  })

  const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))
  return {
    pluginOrigin: packageFiles.origin,
    requests,
    async input(path) {
      const token = randomBytes(8).toString('hex')
      bindings.set(token, path)
      const name = path.slice(path.lastIndexOf('/') + 1)
      return {
        url: `${inputs.origin}/${token}/${path.split('/').map(encodeURIComponent).join('/')}`,
        name,
        extension: extname(name).slice(1).toLowerCase(),
        size: (await stat(join(inputDirectory, path))).size,
      }
    },
    async close() {
      inputs.server.closeAllConnections()
      packageFiles.server.closeAllConnections()
      await Promise.all([close(inputs.server), close(packageFiles.server)])
    },
  }
}
