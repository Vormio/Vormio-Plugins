// Loads a Spine runtime line in Node for the fixture tests. The 4.0 package imports its modules
// without file extensions, which Node does not resolve, so every npm line is bundled with esbuild
// first, as the plugin build does. 3.7 and 3.8 are the classic scripts the plugin ships: it runs in a context
// of its own, and its core and WebGL namespaces are merged as the plugin merges them.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import * as esbuild from 'esbuild'
import type * as Spine43 from 'spine-webgl-4.3'

/**
 * A runtime module, typed as 4.3; older lines lack some members, such as Physics before 4.2 and
 * getBoundsRect in 3.7 and 3.8, whose TextureAtlas takes a texture loader.
 */
export type Spine = typeof Spine43

const plugin = join(import.meta.dirname, '..')

export async function nodeRuntime(line: string): Promise<Spine> {
  if (line === '3.7' || line === '3.8') {
    const script = join(plugin, `../../vendor/spine-ts-${line}/spine-webgl.js`)
    const context = createContext({}) as { spine?: Spine & { webgl: object } }
    runInContext(await readFile(script, 'utf8'), context)
    return { ...context.spine!, ...context.spine!.webgl }
  }
  const result = await esbuild.build({
    stdin: { contents: `export * from 'spine-webgl-${line}'`, resolveDir: plugin },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    logLevel: 'error',
  })
  const code = Buffer.from(result.outputFiles[0]!.contents).toString('base64')
  return (await import(`data:text/javascript;base64,${code}`)) as Spine
}
