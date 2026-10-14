// Loads a prebuilt Spine runtime script: 3.7 and 3.8 are not on npm, and the plugin ships their
// builds from the Spine Runtimes repository (vendor/). Each is a classic script that defines the
// global `spine`, with the WebGL classes in `spine.webgl`, and adds its classes to `spine` when it
// already exists, so a second script would mix its classes into the first one's. The scripts are
// therefore loaded one at a time, each with the global cleared first: every script creates a
// namespace of its own, and its code refers to that namespace, not to the global.

import { SpineError } from '../errors.ts'
import type { ClassicSpine } from './classic.ts'
import type { ReadAtlas } from './figure.ts'

/** What 3.7 and 3.8 add to the classic calls: an atlas that asks for its textures. */
export interface ScriptSpine extends ClassicSpine {
  TextureAtlas: new (text: string, textureLoader: (path: string) => unknown) => ReadAtlas['atlas']
}

interface Namespace {
  webgl: object
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Loads the script at `src`, relative to the page at the root of the package, and gives its core
 * and WebGL classes as one module.
 */
export function loadClassicScript(src: string, line: string): Promise<ScriptSpine> {
  const load = () =>
    new Promise<ScriptSpine>((resolve, reject) => {
      const scope = globalThis as unknown as { spine?: Namespace }
      scope.spine = undefined
      const script = document.createElement('script')
      script.src = src
      script.onload = () => {
        const namespace = scope.spine
        if (!namespace) return reject(new SpineError(`Spine ${line} 运行时无法加载。`))
        resolve({ ...namespace, ...namespace.webgl } as unknown as ScriptSpine)
      }
      script.onerror = () => reject(new SpineError(`Spine ${line} 运行时无法加载。`))
      document.head.append(script)
    })
  const result = queue.then(load, load)
  queue = result.catch(() => undefined)
  return result
}
