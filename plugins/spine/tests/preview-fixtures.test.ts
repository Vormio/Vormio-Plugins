// The skeleton fixtures are written by scripts/fixtures/spine.ts and spine-binary.ts, not by Spine;
// these tests check that each runtime in the package reads them as intended.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import * as spine42 from 'spine-webgl-4.2'
import * as spine43 from 'spine-webgl-4.3'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine/preview')
const runtimes = { '4.2': spine42, '4.3': spine43 } as const

async function read(line: keyof typeof runtimes, name: string, form: 'skel' | 'json' = 'skel') {
  const spine = runtimes[line] as unknown as typeof spine43
  const atlas = new spine.TextureAtlas(await readFile(join(fixtures, `${name}.atlas`), 'utf8'))
  const loader = new spine.AtlasAttachmentLoader(atlas)
  if (form === 'json') {
    const text = await readFile(join(fixtures, `${name}.json`), 'utf8')
    return { spine, data: new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(text)) }
  }
  // The reader views the buffer from its start, so the bytes get a buffer of their own.
  const bytes = new Uint8Array(await readFile(join(fixtures, `${name}.skel`))).buffer
  return { spine, data: new spine.SkeletonBinary(loader).readSkeletonData(bytes) }
}

for (const form of ['skel', 'json'] as const)
  for (const [line, name] of [
    ['4.2', 'hero'],
    ['4.3', 'knight'],
  ] as const)
    test(`the ${line} runtime reads ${name}.${form}: bones, slots, skins and animations`, async () => {
      const { spine, data } = await read(line, name, form)
      assert.equal(data.version, line === '4.2' ? '4.2.43' : '4.3.13')
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
      skeleton.updateWorldTransform(spine.Physics.none)
      const bounds = skeleton.getBoundsRect()
      // The body (32 × 48), the head on top (32 × 32) and the arm reaching to the right (32 wide).
      assert.deepEqual(
        [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round),
        [-16, 0, 64, 80],
      )
    })

test('the truncated skeleton fails in the runtime', async () => {
  await assert.rejects(read('4.2', 'truncated'))
})
