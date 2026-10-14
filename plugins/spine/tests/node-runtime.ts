// Loads a Spine runtime line in Node for the fixture tests. The 4.0 package imports its modules
// without file extensions, which Node does not resolve, so every line is bundled with esbuild
// first, as the plugin build does.

import { join } from 'node:path'
import * as esbuild from 'esbuild'
import type * as Spine43 from 'spine-webgl-4.3'

/** A runtime module, typed as 4.3; older lines lack some members, such as Physics before 4.2. */
export type Spine = typeof Spine43

const plugin = join(import.meta.dirname, '..')

export async function nodeRuntime(line: string): Promise<Spine> {
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
