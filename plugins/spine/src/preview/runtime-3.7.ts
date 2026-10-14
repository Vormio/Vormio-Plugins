// The Spine 3.7 runtime; loaded only for 3.7 data. Its script comes from vendor/spine-ts-3.7 (see
// classic-script.ts). spine-ts 3.7 has no binary reader, so binary skeletons go through the port in
// binary-3.7.ts. Otherwise it is used as 3.8 is: the classic calls, an atlas that asks for its page
// textures while it is read, and pages drawn as premultiplied.

import { readSkeletonBinary37 } from './binary-3.7.ts'
import { classicDifferences } from './classic.ts'
import { loadClassicScript } from './classic-script.ts'
import { createRuntime, type Spine } from './figure.ts'

const spine = await loadClassicScript('runtimes/spine-webgl-3.7.js', '3.7')

export const runtime = createRuntime('3.7', spine as unknown as Spine, {
  ...classicDifferences(spine),
  readAtlas: (text, texture) => ({
    atlas: new spine.TextureAtlas(text, (name) => texture(name, true)),
    pma: true,
  }),
  readBinary: (loader, bytes) => readSkeletonBinary37(spine, loader, bytes),
})
