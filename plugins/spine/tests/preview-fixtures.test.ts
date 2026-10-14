// The skeleton fixtures are written by scripts/fixtures/spine.ts and spine-binary.ts, not by Spine;
// these tests check that each runtime in the package reads them as intended, in binary and JSON.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { readSkeletonBinary37 } from '../src/preview/binary-3.7.ts'
import { nodeRuntime, type Spine } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine/preview')

/** 3.7 and 3.8 ask for each page texture while reading the atlas, and take the page size from it. */
type Atlas38 = new (text: string, loader: () => unknown) => InstanceType<Spine['TextureAtlas']>
const texture = { setFilters() {}, setWraps() {}, getImage: () => ({ width: 72, height: 72 }) }

async function read(
  spine: Spine,
  line: string,
  name: string,
  form: 'skel' | 'json' = 'skel',
): Promise<InstanceType<Spine['SkeletonData']>> {
  const text = await readFile(join(fixtures, `${name}.atlas`), 'utf8')
  const atlas =
    line === '3.7' || line === '3.8'
      ? new (spine.TextureAtlas as unknown as Atlas38)(text, () => texture)
      : new spine.TextureAtlas(text)
  const loader = new spine.AtlasAttachmentLoader(atlas)
  if (form === 'json') {
    const json = JSON.parse(await readFile(join(fixtures, `${name}.json`), 'utf8')) as object
    return new spine.SkeletonJson(loader).readSkeletonData(json)
  }
  // The reader views the buffer from its start, so the bytes get a buffer of their own.
  const bytes = new Uint8Array(await readFile(join(fixtures, `${name}.skel`)))
  // spine-ts 3.7 has no binary reader; the plugin reads 3.7 binary data with its own port.
  if (line === '3.7') return readSkeletonBinary37(spine, loader, bytes)
  return new spine.SkeletonBinary(loader).readSkeletonData(bytes)
}

const figures = [
  ['3.7', 'wizard', '3.7.94'],
  ['3.8', 'ranger', '3.8.99'],
  ['4.0', 'scout', '4.0.64'],
  ['4.1', 'squire', '4.1.24'],
  ['4.2', 'hero', '4.2.43'],
  ['4.3', 'knight', '4.3.13'],
] as const

for (const form of ['skel', 'json'] as const)
  for (const [line, name, version] of figures) {
    test(`the ${line} runtime reads ${name}.${form}: bones, slots, skins and animations`, async () => {
      // Arrays are copied into this realm for comparing: 3.7 and 3.8 run in contexts of their own.
      const spine = await nodeRuntime(line)
      const data = await read(spine, line, name, form)
      assert.equal(data.version, version)
      assert.deepEqual(
        Array.from(data.bones, (bone) => bone.name),
        ['root', 'body', 'head', 'arm'],
      )
      assert.deepEqual(
        Array.from(data.slots, (slot) => slot.name),
        ['body', 'arm', 'head'],
      )
      assert.deepEqual(
        Array.from(data.skins, (skin) => skin.name),
        ['default', 'armored'],
      )
      assert.deepEqual(
        Array.from(data.animations, ({ name, duration }) => [name, duration]),
        [
          ['wave', 1],
          ['blink', 0.5],
        ],
      )
      const skeleton = new spine.Skeleton(data)
      // Lines before 4.2 have no physics and take no argument.
      if (spine.Physics) skeleton.updateWorldTransform(spine.Physics.none)
      else (skeleton.updateWorldTransform as () => void).call(skeleton)
      const offset = new spine.Vector2()
      const size = new spine.Vector2()
      skeleton.getBounds(offset, size, [])
      // The body (32 × 48), the head on top (32 × 32) and the arm reaching to the right (32 wide).
      assert.deepEqual([offset.x, offset.y, size.x, size.y].map(Math.round), [-16, 0, 64, 80])
    })
  }

test('the truncated skeleton fails in the runtime', async () => {
  await assert.rejects(async () => read(await nodeRuntime('4.2'), '4.2', 'truncated'))
})

test('the 3.7 binary reader fails on a skeleton cut off anywhere', async () => {
  const spine = await nodeRuntime('3.7')
  const text = await readFile(join(fixtures, 'wizard.atlas'), 'utf8')
  const loader = new spine.AtlasAttachmentLoader(
    new (spine.TextureAtlas as unknown as Atlas38)(text, () => texture),
  )
  const whole = new Uint8Array(await readFile(join(fixtures, 'wizard.skel')))
  for (let length = 0; length < whole.length; length++)
    assert.throws(
      () => readSkeletonBinary37(spine, loader, whole.slice(0, length)),
      `${length} bytes`,
    )
})
