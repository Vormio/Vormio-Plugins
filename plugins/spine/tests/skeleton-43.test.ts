// Checks the analysis of Spine 4.3 skeleton JSON against what spine-core 4.3, which the plugin ships
// for the previews, reads from the same file. 4.3 keeps every constraint in one `constraints` list
// with a `type`, adds slider constraints and draw order folders, and renames some fields; the format
// description Esoteric publishes may lag behind, so the runtime is the reference, as for 3.7
// (skeleton-37.test.ts). Runs on the fixtures written in 4.3.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import type { CompositionReport } from '@vormio/plugin-sdk'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'
import { nodeRuntime } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')

/* The runtime's data classes, read through plain property access. */
type Graph = any

const lists = {
  bones: '骨骼',
  slots: '插槽',
  ik: 'IK 约束',
  transform: '变换约束',
  path: '路径约束',
  physics: '物理约束',
  slider: '滑块约束',
  skins: '皮肤',
  events: '事件',
  animations: '动画',
} as const
const constraintLists = ['ik', 'transform', 'path', 'physics', 'slider'] as const

/** What a skeleton consists of and refers to, in a form both sides can be brought to. */
interface Summary {
  lists: Record<string, string[]>
  bones: string[]
  slots: string[]
  /** Each constraint with its bones, its target and, for a slider, its animation. */
  constraints: string[]
  /** The bones and constraints each skin contains. */
  skins: string[]
  /** Each attachment as skin/slot/key with its kind, linked mesh parent and clipping end. */
  attachments: string[]
  /** What each animation's timelines change, apart from the draw order. */
  targets: string[]
  /** Slots each animation's draw order folders reorder. */
  folders: string[]
}

/** A subresource's name without what the analysis adds in brackets (region, audio). */
const bare = (name: string) => name.replace(/（.*）$/, '')

function fromReport(report: CompositionReport): Summary {
  const byKey = new Map(report.subresources.map((each) => [each.key, each]))
  const name = (key: string) => bare(byKey.get(key)!.name)
  const refs = (from: string, role: string) =>
    report.references.flatMap((each) =>
      each.from === from && each.role === role && each.key !== undefined
        ? [{ key: each.key, evidence: each.evidence }]
        : [],
    )
  const ofList = (list: string) =>
    report.subresources.filter((each) => each.key.startsWith(`${list}/`)).map((each) => each.key)
  const place = (key: string) =>
    `${name(byKey.get(key)!.parent!)}/${name(refs(key, '所在插槽')[0]!.key)}/${name(key)}`
  const names = (keys: { key: string }[]) => keys.map((each) => name(each.key)).join(',')
  const targets: string[] = []
  const folders: string[] = []
  for (const key of ofList('animations'))
    for (const ref of refs(key, '动画目标')) {
      const collection = ref.key.slice(0, ref.key.indexOf('/'))
      const target = collection === 'attachments' ? place(ref.key) : name(ref.key)
      if (/\/drawOrderFolder\//.test(ref.evidence ?? '')) folders.push(`${name(key)} → ${target}`)
      // Draw order offsets are left out: the runtime keeps only the orders they lead to.
      else if (!/\/drawOrder\//.test(ref.evidence ?? ''))
        targets.push(`${name(key)} → ${collection} ${target}`)
    }
  return {
    lists: Object.fromEntries(
      Object.keys(lists).map((list) => [list, ofList(list).map((key) => byKey.get(key)!.name)]),
    ),
    bones: ofList('bones').map((key) => {
      const parent = byKey.get(key)!.parent
      return `${name(key)} ← ${parent ? name(parent) : '-'}`
    }),
    slots: ofList('slots').map((key) => {
      const setup = refs(key, '初始附件').map((each) => name(each.key))
      return `${name(key)}: ${name(refs(key, '所在骨骼')[0]!.key)}, ${setup[0] ?? '-'}`
    }),
    constraints: constraintLists.flatMap((list) =>
      ofList(list).map(
        (key) =>
          `${list} ${name(key)}: ${names(refs(key, '约束骨骼'))} → ${names(refs(key, '约束目标'))} ▶ ${names(refs(key, '滑块动画'))}`,
      ),
    ),
    skins: ofList('skins').map(
      (key) =>
        `${name(key)}: ${refs(key, '皮肤包含')
          .map((each) => `${each.key.slice(0, each.key.indexOf('/'))} ${name(each.key)}`)
          .sort()
          .join(', ')}`,
    ),
    attachments: ofList('attachments')
      .map((key) => {
        const parent = refs(key, '父网格').map((each) => ` ← ${place(each.key)}`)
        const end = refs(key, '结束插槽').map((each) => ` … ${name(each.key)}`)
        return `${place(key)}: ${byKey.get(key)!.kind}${parent.join('')}${end.join('')}`
      })
      .sort(),
    targets: [...new Set(targets)].sort(),
    folders: [...new Set(folders)].sort(),
  }
}

function fromRuntime(spine: Graph, data: Graph): Summary {
  const names = (items: Graph[]) => Array.from(items ?? [], (each: Graph) => each.name as string)
  const classes: Record<(typeof constraintLists)[number], Graph> = {
    ik: spine.IkConstraintData,
    transform: spine.TransformConstraintData,
    path: spine.PathConstraintData,
    physics: spine.PhysicsConstraintData,
    slider: spine.SliderData,
  }
  const listOf = (constraint: Graph) =>
    constraintLists.find((list) => constraint instanceof classes[list])!
  const ofType = (list: (typeof constraintLists)[number]) =>
    (data.constraints as Graph[]).filter((each) => each instanceof classes[list])

  const located = new Map<Graph, string>()
  for (const skin of data.skins)
    for (const entry of skin.getAttachments())
      located.set(
        entry.attachment,
        `${skin.name}/${data.slots[entry.slotIndex].name}/${entry.placeholder}`,
      )
  const kindOf = (attachment: Graph) =>
    attachment instanceof spine.RegionAttachment
      ? '区域附件'
      : attachment instanceof spine.MeshAttachment
        ? attachment.getSourceMesh()
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
  const attachments = [...located].map(([attachment, place]) => {
    const parent = attachment instanceof spine.MeshAttachment ? attachment.getSourceMesh() : null
    const end = attachment instanceof spine.ClippingAttachment ? attachment.endSlot : null
    return `${place}: ${kindOf(attachment)}${parent ? ` ← ${located.get(parent)}` : ''}${end ? ` … ${end.name}` : ''}`
  })

  const targets: string[] = []
  const folders: string[] = []
  for (const animation of data.animations)
    for (const timeline of animation.timelines) {
      const to = (collection: string, target: string) =>
        targets.push(`${animation.name} → ${collection} ${target}`)
      if (timeline instanceof spine.DeformTimeline || timeline instanceof spine.SequenceTimeline)
        to('attachments', located.get(timeline.attachment)!)
      else if (timeline instanceof spine.EventTimeline)
        for (const event of timeline.events) to('events', event.data.name)
      else if (timeline instanceof spine.DrawOrderTimeline) continue
      else if (timeline instanceof spine.DrawOrderFolderTimeline)
        for (const slot of timeline.slots)
          folders.push(`${animation.name} → ${data.slots[slot].name}`)
      else if (timeline.boneIndex !== undefined) to('bones', data.bones[timeline.boneIndex].name)
      else if (timeline.slotIndex !== undefined) to('slots', data.slots[timeline.slotIndex].name)
      else if (timeline.constraintIndex !== undefined) {
        // A physics timeline with index -1 applies to every physics constraint and names none.
        if (timeline.constraintIndex < 0) continue
        const constraint = data.constraints[timeline.constraintIndex]
        to(listOf(constraint), constraint.name)
      } else assert.fail(`timeline ${timeline.constructor.name} not compared`)
    }

  const targetOf = (list: string, constraint: Graph) =>
    list === 'ik'
      ? constraint.target.name
      : list === 'transform'
        ? constraint.source.name
        : list === 'path'
          ? constraint.slot.name
          : ''
  const defaultSkin = data.defaultSkin
  return {
    lists: {
      ...Object.fromEntries(constraintLists.map((list) => [list, names(ofType(list))])),
      bones: names(data.bones),
      slots: names(data.slots),
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
    constraints: constraintLists.flatMap((list) =>
      ofType(list).map((each) => {
        const bones =
          list === 'physics' || list === 'slider'
            ? names(each.bone ? [each.bone] : [])
            : names(each.bones)
        const animation = list === 'slider' ? each.animation.name : ''
        return `${list} ${each.name}: ${bones} → ${targetOf(list, each)} ▶ ${animation}`
      }),
    ),
    skins: Array.from(data.skins as Graph[], (skin) => {
      const contents = [
        ...Array.from(skin.bones as Graph[], (bone) => `bones ${bone.name}`),
        ...Array.from(skin.constraints as Graph[], (each) => `${listOf(each)} ${each.name}`),
      ]
      return `${skin.name}: ${contents.sort().join(', ')}`
    }),
    attachments: attachments.sort(),
    targets: [...new Set(targets)].sort(),
    folders: [...new Set(folders)].sort(),
  }
}

/**
 * The runtime's reading of `text`. Attachments are made without an atlas: the analysis does not look
 * at regions. Region and mesh attachments compute their UVs from their regions, so they get stand-ins.
 */
function readWithRuntime(spine: Graph, text: string) {
  const region = {
    u: 0,
    v: 0,
    u2: 1,
    v2: 1,
    degrees: 0,
    offsetX: 0,
    offsetY: 0,
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  }
  const withRegions = (sequence: Graph) => {
    sequence.regions.fill(region)
    return sequence
  }
  const loader = {
    newRegionAttachment: (
      _skin: unknown,
      _placeholder: string,
      name: string,
      _path: string,
      sequence: Graph,
    ) => new spine.RegionAttachment(name, withRegions(sequence)),
    newMeshAttachment: (
      _skin: unknown,
      _placeholder: string,
      name: string,
      _path: string,
      sequence: Graph,
    ) => new spine.MeshAttachment(name, withRegions(sequence)),
    newBoundingBoxAttachment: (_skin: unknown, _placeholder: string, name: string) =>
      new spine.BoundingBoxAttachment(name),
    newPathAttachment: (_skin: unknown, _placeholder: string, name: string) =>
      new spine.PathAttachment(name),
    newPointAttachment: (_skin: unknown, _placeholder: string, name: string) =>
      new spine.PointAttachment(name),
    newClippingAttachment: (_skin: unknown, _placeholder: string, name: string) =>
      new spine.ClippingAttachment(name),
  }
  return new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(text))
}

async function compareWithRuntime(file: string) {
  const text = await readFile(join(fixtures, file), 'utf8')
  const spine = (await nodeRuntime('4.3')) as Graph
  const report = analyzeSkeleton(readSkeletonJson(text), basename(file))
  assert.deepEqual(report.diagnostics, [], file)
  assert.ok(!report.partial, file)
  const analysis = fromReport(report)
  assert.deepEqual(analysis, fromRuntime(spine, readWithRuntime(spine, text)), file)
  return analysis
}

test('the analysis of the 4.3 fixture matches what spine-core 4.3 reads', async () => {
  const analysis = await compareWithRuntime('basic/paladin.json')
  // Every kind of constraint from the one list, with 4.3's field names.
  assert.deepEqual(analysis.constraints, [
    'ik arm-ik: arm-l → hip ▶ ',
    'transform head-follow: head → torso ▶ ',
    'path cape-path: cape → spline ▶ ',
    'physics cape-sway: cape →  ▶ ',
    'slider visor-slider: head →  ▶ visor-open',
    'slider idle-slider:  →  ▶ idle',
  ])
  assert.ok(analysis.skins.includes('armored: bones visor, slider visor-slider'))
  // A linked mesh in another slot (`slot`) and one in another skin (`skin`), both by `source`.
  assert.ok(analysis.attachments.includes('default/trim/trim: 链接网格附件 ← default/cape/cape'))
  assert.ok(analysis.attachments.includes('armored/cape/cape: 链接网格附件 ← default/cape/cape'))
  assert.ok(analysis.targets.includes('walk → slider idle-slider'))
  assert.deepEqual(analysis.folders, ['swap-cape → cape', 'swap-cape → trim'])
})

test('the analysis of the 4.3 preview figure matches what spine-core 4.3 reads', async () => {
  await compareWithRuntime('preview/knight.json')
})
