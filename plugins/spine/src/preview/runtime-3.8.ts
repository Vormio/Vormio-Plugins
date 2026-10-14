// The Spine 3.8 runtime; loaded only for 3.8 data. It is not on npm: the plugin ships the build from
// the Spine Runtimes repository (vendor/spine-ts-3.8) as runtimes/spine-webgl-3.8.js, a classic
// script that defines the global `spine`, with the WebGL classes in `spine.webgl`. Its calls are the
// classic ones (classic.ts), except that an atlas asks for its page textures while it is read, and
// that 3.8 atlases do not say whether their pages are premultiplied: like Spine's own 3.8 player,
// the plugin draws them as premultiplied.

import { SpineError } from '../errors.ts'
import { classicDifferences, type ClassicSpine } from './classic.ts'
import { createRuntime, type ReadAtlas, type Spine } from './figure.ts'

interface Spine38 extends ClassicSpine {
  TextureAtlas: new (text: string, textureLoader: (path: string) => unknown) => ReadAtlas['atlas']
}

interface Global38 extends Spine38 {
  webgl: object
}

/** Loads the script once and gives its core and WebGL classes as one module. */
function loadScript(): Promise<Spine38> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    // Relative to the page, which is at the root of the package.
    script.src = 'runtimes/spine-webgl-3.8.js'
    script.onload = () => {
      const global = (globalThis as unknown as { spine: Global38 }).spine
      resolve({ ...global, ...global.webgl })
    }
    script.onerror = () => reject(new SpineError('Spine 3.8 运行时无法加载。'))
    document.head.append(script)
  })
}

const spine = await loadScript()

export const runtime = createRuntime('3.8', spine as unknown as Spine, {
  ...classicDifferences(spine),
  readAtlas: (text, texture) => ({
    atlas: new spine.TextureAtlas(text, (name) => texture(name, true)),
    pma: true,
  }),
})
