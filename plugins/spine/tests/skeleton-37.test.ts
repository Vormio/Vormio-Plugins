// Checks the analysis of Spine 3.7 skeleton JSON against what spine-ts 3.7, which the plugin ships
// for the previews, reads from the same file: the named objects, the skins and their attachments,
// and what bones, slots, constraints, attachments and animations refer to. The format description
// Esoteric publishes covers the current format only, so for 3.7 the runtime is the reference. Runs
// on the 3.7 fixture, and on Spine's own 3.7 examples when SPINE_37_EXAMPLES points at them (see
// preview-binary-37.test.ts; they may not be redistributed, so they are not in the repository).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import type { CompositionReport } from '@vormio/plugin-sdk'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'
import { nodeRuntime } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')
const examples = process.env.SPINE_37_EXAMPLES

/* The 3.7 classes come from an untyped script. */
type Graph = any

/** What a skeleton consists of and refers to, in a form both sides can be brought to. */
interface Summary {
  /** Names of the named lists, in order. */
  lists: Record<string, string[]>
  /** Each bone with its parent, each slot with its bone and setup attachment. */
  bones: string[]
  slots: string[]
  /** Each constraint with its bones and target. */
  constraints: string[]
  /** Each attachment as skin/slot/key with its kind, linked mesh parent and clipping end. */
  attachments: string[]
  /** What each animation's timelines change, apart from the draw order. */
  targets: string[]
  /** Slots each animation's draw order names. */
  drawOrder: string[]
}

const kindsByList: Record<string, string> = {
  bones: '骨骼',
  slots: '插槽',
  ik: 'IK 约束',
  transform: '变换约束',
  path: '路径约束',
  skins: '皮肤',
  events: '事件',
  animations: '动画',
}
/** A subresource's name without what the analysis adds in brackets (region, audio). */
const bare = (name: string) => name.replace(/（.*）$/, '')

function fromReport(report: CompositionReport): Summary {
  const byKey = new Map(report.subresources.map((each) => [each.key, each]))
  const name = (key: string) => bare(byKey.get(key)!.name)
  /** References within the skeleton by source and role; the inferred atlas has no source. */
  const refs = (from: string, role: string) =>
    report.references.flatMap((each) =>
      each.from === from && each.role === role && each.key !== undefined
        ? [{ key: each.key, evidence: each.evidence }]
        : [],
    )
  const ofList = (list: string) =>
    report.subresources.filter((each) => each.key.startsWith(`${list}/`)).map((each) => each.key)
  /** skin/slot/key of an attachment. */
  const place = (key: string) =>
    `${name(byKey.get(key)!.parent!)}/${name(refs(key, '所在插槽')[0]!.key)}/${name(key)}`
  const lists = Object.fromEntries(
    Object.keys(kindsByList).map((list) => [list, ofList(list).map((key) => byKey.get(key)!.name)]),
  )
  const constraints = ['ik', 'transform', 'path'].flatMap((list) =>
    ofList(list).map(
      (key) =>
        `${list} ${name(key)}: ${refs(key, '约束骨骼').map((each) => name(each.key))} → ${refs(key, '约束目标').map((each) => name(each.key))}`,
    ),
  )
  const attachments = ofList('attachments').map((key) => {
    const parent = refs(key, '父网格').map((each) => ` ← ${place(each.key)}`)
    const end = refs(key, '结束插槽').map((each) => ` … ${name(each.key)}`)
    return `${place(key)}: ${byKey.get(key)!.kind}${parent.join('')}${end.join('')}`
  })
  const targets: string[] = []
  const drawOrder: string[] = []
  for (const key of ofList('animations'))
    for (const ref of refs(key, '动画目标')) {
      const collection = ref.key.slice(0, ref.key.indexOf('/'))
      const target = collection === 'attachments' ? place(ref.key) : name(ref.key)
      if (/\/(drawOrder|draworder)\//.test(ref.evidence ?? ''))
        drawOrder.push(`${name(key)} → ${target}`)
      else targets.push(`${name(key)} → ${collection} ${target}`)
    }
  return {
    lists,
    bones: ofList('bones').map((key) => {
      const parent = byKey.get(key)!.parent
      return `${name(key)} ← ${parent ? name(parent) : '-'}`
    }),
    slots: ofList('slots').map((key) => {
      const setup = refs(key, '初始附件').map((each) => name(each.key))
      return `${name(key)}: ${name(refs(key, '所在骨骼')[0]!.key)}, ${setup[0] ?? '-'}`
    }),
    constraints,
    attachments: attachments.sort(),
    targets: [...new Set(targets)].sort(),
    drawOrder: [...new Set(drawOrder)].sort(),
  }
}

function fromRuntime(spine: Graph, data: Graph): Summary {
  const names = (items: Graph[]) => Array.from(items, (each: Graph) => each.name as string)
  const located = new Map<Graph, string>()
  const attachments: string[] = []
  const kindOf = (attachment: Graph) =>
    attachment instanceof spine.RegionAttachment
      ? '区域附件'
      : attachment instanceof spine.MeshAttachment
        ? attachment.getParentMesh()
          ? '链接网格附件'
          : '网格附件'
        : attachment instanceof spine.BoundingBoxAttachment
          ? '包围盒附件'
          : attachment instanceof spine.PathAttachment
            ? '路径附件'
            : attachment instanceof spine.PointAttachment
              ? '点附件'
              : attachment instanceof spine.ClippingAttachment
                ? '裁剪附件'
                : '附件'
  for (const skin of data.skins)
    Array.from(skin.attachments as Graph[]).forEach((byKey, slot) => {
      for (const [key, attachment] of Object.entries(byKey ?? {}))
        located.set(attachment, `${skin.name}/${data.slots[slot].name}/${key}`)
    })
  for (const [attachment, place] of located) {
    const parent = attachment instanceof spine.MeshAttachment ? attachment.getParentMesh() : null
    const end = attachment instanceof spine.ClippingAttachment ? attachment.endSlot : null
    attachments.push(
      `${place}: ${kindOf(attachment)}${parent ? ` ← ${located.get(parent)}` : ''}${end ? ` … ${end.name}` : ''}`,
    )
  }
  const targets: string[] = []
  const drawOrder: string[] = []
  for (const animation of data.animations)
    for (const timeline of animation.timelines) {
      const to = (collection: string, target: string) =>
        targets.push(`${animation.name} → ${collection} ${target}`)
      if (timeline instanceof spine.DeformTimeline)
        to('attachments', located.get(timeline.attachment)!)
      else if (timeline instanceof spine.EventTimeline)
        for (const event of timeline.events) to('events', event.data.name)
      else if (timeline instanceof spine.DrawOrderTimeline) {
        // The runtime keeps the resulting orders; a slot named in the offsets is one that moved.
        for (const order of timeline.drawOrders)
          Array.from((order ?? []) as number[]).forEach((slot, position) => {
            if (slot !== position) drawOrder.push(`${animation.name} → ${data.slots[slot].name}`)
          })
      } else if (timeline.boneIndex !== undefined) to('bones', data.bones[timeline.boneIndex].name)
      else if (timeline.slotIndex !== undefined) to('slots', data.slots[timeline.slotIndex].name)
      else if (timeline.ikConstraintIndex !== undefined)
        to('ik', data.ikConstraints[timeline.ikConstraintIndex].name)
      else if (timeline.transformConstraintIndex !== undefined)
        to('transform', data.transformConstraints[timeline.transformConstraintIndex].name)
      else if (timeline.pathConstraintIndex !== undefined)
        to('path', data.pathConstraints[timeline.pathConstraintIndex].name)
      else assert.fail(`timeline ${timeline.constructor.name} not compared`)
    }
  const defaultSkin = data.defaultSkin
  return {
    lists: {
      bones: names(data.bones),
      slots: names(data.slots),
      ik: names(data.ikConstraints),
      transform: names(data.transformConstraints),
      path: names(data.pathConstraints),
      skins: names(data.skins),
      events: Array.from(data.events as Graph[], (event) =>
        event.audioPath ? `${event.name}（音频 ${event.audioPath}）` : event.name,
      ),
      animations: names(data.animations),
    },
    bones: Array.from(
      data.bones as Graph[],
      (bone) => `${bone.name} ← ${bone.parent?.name ?? '-'}`,
    ),
    slots: Array.from(data.slots as Graph[], (slot, index) => {
      const setup =
        slot.attachmentName && defaultSkin?.getAttachment(index, slot.attachmentName)
          ? slot.attachmentName
          : '-'
      return `${slot.name}: ${slot.boneData.name}, ${setup}`
    }),
    constraints: [
      ...Array.from(data.ikConstraints as Graph[], (each) => ['ik', each] as const),
      ...Array.from(data.transformConstraints as Graph[], (each) => ['transform', each] as const),
      ...Array.from(data.pathConstraints as Graph[], (each) => ['path', each] as const),
    ].map(([list, each]) => `${list} ${each.name}: ${names(each.bones)} → ${each.target.name}`),
    attachments: attachments.sort(),
    targets: [...new Set(targets)].sort(),
    drawOrder: [...new Set(drawOrder)].sort(),
  }
}

/**
 * The runtime's reading of `text`. Attachments are made without an atlas: the analysis does not
 * look at regions. A region attachment computes its corners from its region, so it gets a stand-in.
 */
function readWithRuntime(spine: Graph, text: string) {
  const region = {
    originalWidth: 1,
    originalHeight: 1,
    offsetX: 0,
    offsetY: 0,
    width: 1,
    height: 1,
  }
  const loader = {
    newRegionAttachment: (_skin: unknown, name: string) =>
      Object.assign(new spine.RegionAttachment(name), { region }),
    newMeshAttachment: (_skin: unknown, name: string) => new spine.MeshAttachment(name),
    newBoundingBoxAttachment: (_skin: unknown, name: string) =>
      new spine.BoundingBoxAttachment(name),
    newPathAttachment: (_skin: unknown, name: string) => new spine.PathAttachment(name),
    newPointAttachment: (_skin: unknown, name: string) => new spine.PointAttachment(name),
    newClippingAttachment: (_skin: unknown, name: string) => new spine.ClippingAttachment(name),
  }
  return new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(text))
}

async function compareWithRuntime(text: string, where: string) {
  const spine = (await nodeRuntime('3.7')) as Graph
  const report = analyzeSkeleton(readSkeletonJson(text), basename(where))
  assert.deepEqual(report.diagnostics, [], where)
  assert.ok(!report.partial, where)
  const analysis = fromReport(report)
  const runtime = fromRuntime(spine, readWithRuntime(spine, text))
  // The analysis reports the slots named in draw order offsets, unless another timeline of the
  // animation already refers to them; the runtime keeps only the orders they lead to, in which the
  // slots in between move as well.
  assert.ok(
    analysis.drawOrder.every((each) => runtime.drawOrder.includes(each)),
    `${where}: draw order ${analysis.drawOrder} not in ${runtime.drawOrder}`,
  )
  assert.deepEqual({ ...analysis, drawOrder: [] }, { ...runtime, drawOrder: [] }, where)
  return analysis
}

test('the analysis of the 3.7 fixture matches what spine-ts 3.7 reads', async () => {
  const analysis = await compareWithRuntime(
    await readFile(join(fixtures, 'legacy/druid.json'), 'utf8'),
    'legacy/druid.json',
  )
  // Every kind of attachment, a linked mesh in the second skin, every kind of timeline.
  assert.equal(analysis.attachments.length, 12)
  assert.ok(analysis.attachments.includes('robed/cape/cape: 链接网格附件 ← default/cape/cape'))
  assert.ok(analysis.targets.includes('cast → path vine-path'))
  assert.deepEqual(analysis.drawOrder, ['cast → arm', 'walk → staff'])
})

test(
  'the analysis of the Spine 3.7 examples matches what spine-ts 3.7 reads',
  { skip: examples ? false : 'set SPINE_37_EXAMPLES to a folder of the Spine 3.7 examples' },
  async (t) => {
    const files: string[] = []
    for (const project of (await readdir(examples!, { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    )) {
      const folder = [join(examples!, project.name, 'export'), join(examples!, project.name)].find(
        existsSync,
      )!
      for (const file of (await readdir(folder)).filter((each) => each.endsWith('.json')))
        files.push(join(folder, file))
    }
    assert.ok(files.length > 0, `no skeleton JSON in ${examples}`)
    t.diagnostic(`${files.length} skeletons`)
    for (const file of files) await compareWithRuntime(await readFile(file, 'utf8'), file)
  },
)
