// The binary fixtures are written by scripts/fixtures/spine-binary.ts, not by Spine; these tests
// check that each runtime in the package reads them as intended.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeRuntime, type Spine } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine/preview')

async function read(spine: Spine, name: string) {
  const atlas = new spine.TextureAtlas(await readFile(join(fixtures, `${name}.atlas`), 'utf8'))
  // The reader views the buffer from its start, so the bytes get a buffer of their own.
  const bytes = new Uint8Array(await readFile(join(fixtures, `${name}.skel`)))
  const loader = new spine.AtlasAttachmentLoader(atlas)
  return new spine.SkeletonBinary(loader).readSkeletonData(bytes)
}

const figures = [
  ['4.0', 'scout', '4.0.64'],
  ['4.1', 'squire', '4.1.24'],
  ['4.2', 'hero', '4.2.43'],
  ['4.3', 'knight', '4.3.13'],
] as const

for (const [line, name, version] of figures)
  test(`the ${line} runtime reads ${name}.skel: bones, slots, skins and animations`, async () => {
    const spine = await nodeRuntime(line)
    const data = await read(spine, name)
    assert.equal(data.version, version)
    assert.deepEqual(
      data.bones.map((bone) => bone.name),
      ['root', 'body', 'head', 'arm'],
    )
    assert.deepEqual(
      data.slots.map((slot) => slot.name),
      ['body', 'arm', 'head'],
    )
    assert.deepEqual(
      data.skins.map((skin) => skin.name),
      ['default', 'armored'],
    )
    assert.deepEqual(
      data.animations.map(({ name, duration }) => [name, duration]),
      [
        ['wave', 1],
        ['blink', 0.5],
      ],
    )
    const skeleton = new spine.Skeleton(data)
    // Lines before 4.2 have no physics and take no argument.
    if (spine.Physics) skeleton.updateWorldTransform(spine.Physics.none)
    else (skeleton.updateWorldTransform as () => void).call(skeleton)
    const bounds = skeleton.getBoundsRect()
    // The body (32 × 48), the head on top (32 × 32) and the arm reaching to the right (32 wide).
    assert.deepEqual(
      [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round),
      [-16, 0, 64, 80],
    )
  })

test('the truncated skeleton fails in the runtime', async () => {
  await assert.rejects(async () => read(await nodeRuntime('4.2'), 'truncated'))
})
