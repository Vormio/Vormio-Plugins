// Checks the 3.7 binary reader against Spine's own 3.7 example exports, which carry each skeleton as
// both .skel and .json: the official spine-ts 3.7 SkeletonJson reads the JSON, our reader the binary,
// and the two skeleton data graphs must match. The examples may not be redistributed, so they are not
// in the repository; to run this test, point SPINE_37_EXAMPLES at the examples folder of the Spine
// Runtimes repository's 3.7 branch (one folder per example, its exports in export/) or at a copy
// that keeps the exports directly in each example's folder. Without it the test is skipped.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { readSkeletonBinary37 } from '../src/preview/binary-3.7.ts'
import { nodeRuntime } from './node-runtime.ts'

const examples = process.env.SPINE_37_EXAMPLES

/* The 3.7 classes come from an untyped script. */
type Graph = any

/** Properties that only one of the two forms carries, or that each reader fills differently. */
const ignored = new Set([
  // SkeletonJson leaves the skeleton unnamed; the binary reader names it ''.
  'SkeletonData.name',
  // Nonessential data for the editor: the examples' binary exports carry it and their JSON exports
  // do not, and spine-ts 3.7's SkeletonJson does not read mesh edges and sizes at all. The colours
  // are the ones the editor draws these attachments in (spineboy's bounding boxes are green).
  'SkeletonData.fps',
  'SkeletonData.imagesPath',
  'SkeletonData.audioPath',
  'MeshAttachment.edges',
  'MeshAttachment.width',
  'MeshAttachment.height',
  'BoundingBoxAttachment.color',
  'PathAttachment.color',
  'PointAttachment.color',
  'ClippingAttachment.color',
])
/** A counter every vertex attachment takes when created, so it depends on the order of reading. */
const counters = new Set(['id'])

/**
 * Where an example's two exports disagree, so neither reader is at fault: each entry names the
 * examples and the differences (`json ≠ binary`) it accepts, and must still occur, so that the list
 * cannot go stale.
 */
const exportDifferences: { examples: RegExp; difference: RegExp; reason: string }[] = [
  {
    examples: /^powerup-(ess|pro)\.skel$/,
    // Curve types: 1 is stepped, 0 linear. The official 3.8 readers find the same in the 3.8
    // powerup exports.
    difference: /^skeleton\.animations\[\d+\]\.timelines\[\d+\]\.curves\[\d+\]: 1 ≠ 0$/,
    reason: 'powerup: the JSON export steps 17 keys of the bounce animation, the binary export 3',
  },
]

/** A key for pairing timelines of an animation: their class and what they animate. */
function timelineKey(timeline: Graph): string {
  const target = [
    timeline.slotIndex,
    timeline.boneIndex,
    timeline.ikConstraintIndex,
    timeline.transformConstraintIndex,
    timeline.pathConstraintIndex,
    timeline.attachment?.name,
  ]
  return `${timeline.constructor.name}:${target.filter((each) => each !== undefined).join(':')}`
}

/** Lists in which the two readers may differ only in order, with the key to pair entries by. */
const unordered: Record<string, (item: Graph) => string> = {
  'SkeletonData.skins': (skin) => skin.name,
  'SkeletonData.events': (event) => event.name,
  'SkeletonData.animations': (animation) => animation.name,
  'Animation.timelines': timelineKey,
}

const isArrayLike = (value: unknown): value is ArrayLike<unknown> =>
  Array.isArray(value) || ArrayBuffer.isView(value)

/**
 * The differences between two data graphs, at most `limit`. The JSON export rounds its numbers
 * (positions to two decimals, scales to three) while the binary keeps float32, and values computed
 * from them carry the rounding along, enlarged by the attachment's size (a region's corners move by
 * its rotation's rounding times its width), so numbers match within 0.05 plus 0.1 % of their size.
 * Null and undefined match each other. Differences that `accepted` takes are left out.
 */
function compare(
  json: Graph,
  binary: Graph,
  accepted: (difference: string) => boolean,
  limit = 20,
): string[] {
  const differences: string[] = []
  const differ = (difference: string): void => {
    if (!accepted(difference)) differences.push(difference)
  }
  const seen = new Map<object, object>()
  const visit = (a: Graph, b: Graph, path: string, owner: string): void => {
    if (differences.length >= limit) return
    // A draw order key without changes: SkeletonJson leaves it null, the binary reader writes the
    // setup order. Both mean the setup order.
    if (a === null && isArrayLike(b) && /\.drawOrders\[\d+\]$/.test(path))
      if (Array.from(b).every((slot, index) => slot === index)) return
    if ((a === null || a === undefined) && (b === null || b === undefined)) return
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > 0.05 + Math.abs(a) * 1e-3) differ(`${path}: ${a} ≠ ${b}`)
      return
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      if (a !== b) differ(`${path}: ${String(a)} ≠ ${String(b)}`)
      return
    }
    if (seen.get(a) === b) return
    seen.set(a, b)
    if (isArrayLike(a) || isArrayLike(b)) {
      if (!isArrayLike(a) || !isArrayLike(b)) return void differ(`${path}: array and not array`)
      if (a.length !== b.length) return void differ(`${path}: length ${a.length} ≠ ${b.length}`)
      const key = unordered[`${owner}.${path.slice(path.lastIndexOf('.') + 1)}`]
      const left = key ? [...(a as Graph[])].sort((x, y) => key(x).localeCompare(key(y))) : a
      const right = key ? [...(b as Graph[])].sort((x, y) => key(x).localeCompare(key(y))) : b
      for (let i = 0; i < left.length; i++) visit(left[i], right[i], `${path}[${i}]`, owner)
      return
    }
    const type = a.constructor?.name ?? 'Object'
    if (type !== (b.constructor?.name ?? 'Object'))
      return void differ(`${path}: ${type} ≠ ${b.constructor?.name}`)
    for (const property of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (ignored.has(`${type}.${property}`) || counters.has(property)) continue
      visit(a[property], b[property], `${path}.${property}`, type)
    }
  }
  visit(json, binary, 'skeleton', 'SkeletonData')
  return differences
}

/** Each example skeleton with its JSON export and the atlas it uses. */
async function skeletons(root: string) {
  const found: { name: string; skel: string; json: string; atlas: string }[] = []
  for (const project of (await readdir(root, { withFileTypes: true })).filter((e) =>
    e.isDirectory(),
  )) {
    const folder = [join(root, project.name, 'export'), join(root, project.name)].find(existsSync)!
    for (const file of (await readdir(folder)).filter((each) => each.endsWith('.skel'))) {
      const base = file.slice(0, -'.skel'.length)
      const atlas = [`${base}.atlas`, `${project.name}.atlas`]
        .map((each) => join(folder, each))
        .find((each) => existsSync(each))
      const json = join(folder, `${base}.json`)
      if (atlas && existsSync(json))
        found.push({ name: file, skel: join(folder, file), json, atlas })
    }
  }
  return found
}

test(
  'the 3.7 binary reader matches the official JSON reader on the Spine 3.7 examples',
  { skip: examples ? false : 'set SPINE_37_EXAMPLES to a folder of the Spine 3.7 examples' },
  async (t) => {
    const spine = (await nodeRuntime('3.7')) as Graph
    // Page sizes come from the textures in 3.7; any size will do for comparing the two readers.
    const texture = {
      setFilters() {},
      setWraps() {},
      getImage: () => ({ width: 1024, height: 1024 }),
    }
    const list = await skeletons(examples!)
    assert.ok(list.length > 0, `no skeletons with a JSON export and an atlas in ${examples}`)
    t.diagnostic(`${list.length} skeletons: ${list.map(({ name }) => name).join(', ')}`)
    const failures: string[] = []
    const unseen = new Set(exportDifferences)
    for (const { name, skel, json, atlas } of list) {
      const text = await readFile(atlas, 'utf8')
      const fromJson = new spine.SkeletonJson(
        new spine.AtlasAttachmentLoader(new spine.TextureAtlas(text, () => texture)),
      ).readSkeletonData(JSON.parse(await readFile(json, 'utf8')))
      const fromBinary = readSkeletonBinary37(
        spine,
        new spine.AtlasAttachmentLoader(new spine.TextureAtlas(text, () => texture)),
        new Uint8Array(await readFile(skel)),
      )
      const known = exportDifferences.filter(({ examples }) => examples.test(name))
      const differences = compare(fromJson, fromBinary, (difference) => {
        const entry = known.find((each) => each.difference.test(difference))
        if (entry) unseen.delete(entry)
        return entry !== undefined
      })
      if (differences.length) failures.push(`${name}:\n  ${differences.join('\n  ')}`)
    }
    assert.deepEqual(failures, [], `${list.length} skeletons compared`)
    const stale = [...unseen].filter(({ examples }) => list.some(({ name }) => examples.test(name)))
    assert.deepEqual(
      stale.map(({ reason }) => reason),
      [],
      'accepted export differences that no longer occur',
    )
  },
)
