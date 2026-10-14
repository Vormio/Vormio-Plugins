// The Spine 3.8 runtime; loaded only for 3.8 data. Its script comes from vendor/spine-ts-3.8 (see
// classic-script.ts). Its calls are the classic ones (classic.ts), except that an atlas asks for its
// page textures while it is read, and that 3.8 atlases do not say whether their pages are
// premultiplied: like Spine's own 3.8 player, the plugin draws them as premultiplied.

import { classicDifferences } from './classic.ts'
import { loadClassicScript } from './classic-script.ts'
import { createRuntime, type Spine } from './figure.ts'

const spine = await loadClassicScript('runtimes/spine-webgl-3.8.js', '3.8')

export const runtime = createRuntime('3.8', spine as unknown as Spine, {
  ...classicDifferences(spine),
  readAtlas: (text, texture) => ({
    atlas: new spine.TextureAtlas(text, (name) => texture(name, true)),
    pma: true,
  }),
})
