// Builds the composition report of a Spine skeleton in JSON (Spine 3.8 to 4.2): bones, slots,
// constraints, skins and their attachments, events and animations, and what refers to what. Spine
// refers to objects by name. The skeleton does not name its atlas; Spine pairs it with the atlas of
// the same name, which is reported as an inferred reference. Atlas regions and audio files are not
// reported as references: regions are inside another file, and the base of the skeleton's image
// and audio paths is not established. No DOM, so it runs in Node tests as well as in the analyzer
// page.

import type { CompositionReport, ReportReference, ReportSubresource } from '@vormio/plugin-sdk'
import {
  compact,
  diagnosticList,
  limits,
  plainText,
  pointer,
  reportedUri,
  withinLimits,
} from '../../../shared/report.ts'
import { fileUri } from '../../../shared/uri.ts'
import { NotSpineError, SpineError } from './errors.ts'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The named lists, in display order, with their display kinds. */
const lists = [
  ['bones', '骨骼'],
  ['slots', '插槽'],
  ['ik', 'IK 约束'],
  ['transform', '变换约束'],
  ['path', '路径约束'],
  ['physics', '物理约束'],
] as const
type List = (typeof lists)[number][0]
type Collection = List | 'skins' | 'attachments' | 'events' | 'animations'

const kinds: Record<Collection, string> = {
  ...(Object.fromEntries(lists) as Record<List, string>),
  skins: '皮肤',
  attachments: '附件',
  events: '事件',
  animations: '动画',
}

const attachmentKinds: Record<string, string> = {
  region: '区域附件',
  mesh: '网格附件',
  linkedmesh: '链接网格附件',
  boundingbox: '包围盒附件',
  path: '路径附件',
  point: '点附件',
  clipping: '裁剪附件',
}
/** Attachment types drawn with an atlas region. */
const textured = new Set(['region', 'mesh', 'linkedmesh'])

/** When a report is too large, subresources go in this order, last one in the file first. */
const dropOrder: Collection[] = [
  'attachments',
  'animations',
  'physics',
  'path',
  'transform',
  'ik',
  'events',
  'skins',
  'slots',
  'bones',
]

/** The oldest and newest Spine versions whose JSON this analysis follows. */
export const supported = { oldest: [3, 8], newest: [4, 2] } as const

/** Parses the text of a skeleton file; anything that is not Spine JSON throws NotSpineError. */
export function readSkeletonJson(text: string): Json {
  let json: unknown
  try {
    json = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new NotSpineError('不是 Spine 骨骼文件：内容不是 JSON。')
  }
  if (!isObject(json) || typeof objectAt(json, 'skeleton')?.spine !== 'string')
    throw new NotSpineError('不是 Spine 骨骼文件：没有 skeleton.spine 版本。')
  if (!Array.isArray(json.bones)) throw new NotSpineError('不是 Spine 骨骼文件：没有 bones 列表。')
  return json
}

function objectAt(value: unknown, ...path: string[]): Json | undefined {
  let current = value
  for (const step of path) current = isObject(current) ? current[step] : undefined
  return isObject(current) ? current : undefined
}

/** The editor version that wrote the file, as [major, minor], or undefined if unreadable. */
export function spineVersion(json: Json): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)/.exec(String(objectAt(json, 'skeleton')?.spine ?? ''))
  return match ? [Number(match[1]), Number(match[2])] : undefined
}

const compareVersions = (a: readonly number[], b: readonly number[]) =>
  a[0]! - b[0]! || a[1]! - b[1]!

/** The atlas that goes with a skeleton by name: `hero.skel` → `hero.atlas`. */
export function atlasName(skeletonName: string): string {
  const dot = skeletonName.lastIndexOf('.')
  return `${dot > 0 ? skeletonName.slice(0, dot) : skeletonName}.atlas`
}

/** Analyzes a skeleton read by `readSkeletonJson`; `fileName` is the name of the skeleton file. */
export function analyzeSkeleton(json: Json, fileName: string): CompositionReport {
  const { diagnostics, diagnose } = diagnosticList()
  let partial = false
  const version = spineVersion(json)
  const written = String(objectAt(json, 'skeleton')?.spine)
  const range = `${supported.oldest.join('.')} 至 ${supported.newest.join('.')}`
  if (
    !version ||
    compareVersions(version, supported.oldest) < 0 ||
    !Array.isArray(json.skins ?? [])
  )
    throw new SpineError(`不支持 Spine ${written} 的骨骼文件，只支持 ${range}。`)
  if (compareVersions(version, supported.newest) > 0)
    diagnose(
      'warning',
      `文件由 Spine ${written} 导出，比本插件依据的 ${range} 新，结果可能不完整。`,
    )

  // --- The objects ------------------------------------------------------------------------------
  const keyOf = (collection: Collection, index: number) => `${collection}/${index}`
  const subresources: ReportSubresource[] = []
  const names = new Map<string, string>()
  const add = (
    collection: Collection,
    index: number,
    name: string,
    extra: { kind?: string; parent?: string } = {},
  ) => {
    const key = keyOf(collection, index)
    const shown = plainText(name, limits.name)
    names.set(key, `${extra.kind ?? kinds[collection]} ${shown}`)
    subresources.push(
      compact({ key, kind: extra.kind ?? kinds[collection], name: shown, parent: extra.parent }),
    )
    return key
  }
  /** The kind and name of a subresource, for diagnostics. */
  const describe = (key: string) => names.get(key) ?? key

  /** The items of a list that should be an array; anything else is reported and skipped. */
  const arrayAt = (value: unknown, where: string): Json[] => {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      diagnose('error', `${where} 不是数组，其中的内容没有分析。`)
      partial = true
      return []
    }
    return value.map((item, index) => {
      if (isObject(item)) return item
      diagnose('error', `${where}/${index} 不是 JSON 对象。`)
      partial = true
      return {}
    })
  }
  const mapAt = (value: unknown, where: string): [string, Json][] => {
    if (value === undefined) return []
    if (!isObject(value)) {
      diagnose('error', `${where} 不是 JSON 对象，其中的内容没有分析。`)
      partial = true
      return []
    }
    return Object.entries(value).map(([name, item]) => {
      if (isObject(item)) return [name, item]
      diagnose('error', `${where}/${name} 不是 JSON 对象。`)
      partial = true
      return [name, {}]
    })
  }

  // Named lists: Spine refers to their items by name, so the first of two equal names wins.
  const items = {} as Record<List, Json[]>
  const byName = {} as Record<List | 'skins' | 'events', Map<string, number>>
  const index = (collection: List | 'skins' | 'events', entries: string[]) => {
    const map = new Map<string, number>()
    entries.forEach((name, position) => {
      if (map.has(name))
        diagnose(
          'warning',
          `有两个名为 ${name} 的${kinds[collection]}，按名称引用时只会找到第一个。`,
          keyOf(collection, position),
        )
      else map.set(name, position)
    })
    byName[collection] = map
  }
  const listName = (collection: Collection, item: Json, position: number) =>
    typeof item.name === 'string' ? item.name : `${kinds[collection]} ${position}`
  for (const [list] of lists) {
    items[list] = arrayAt(json[list], `/${list}`)
    index(
      list,
      items[list].map((item, position) => listName(list, item, position)),
    )
  }
  const skins = arrayAt(json.skins, '/skins')
  index(
    'skins',
    skins.map((skin, position) => listName('skins', skin, position)),
  )
  const events = mapAt(json.events, '/events')
  index(
    'events',
    events.map(([name]) => name),
  )
  const animations = mapAt(json.animations, '/animations')

  // --- References -------------------------------------------------------------------------------
  const internal: ReportReference[] = []
  const linked = new Set<string>()
  const reference = (from: string, key: string, role: string, evidence: string) => {
    if (linked.has(`${from}\0${key}\0${role}`)) return
    linked.add(`${from}\0${key}\0${role}`)
    internal.push({
      from,
      key,
      role: plainText(role, limits.label),
      evidence: plainText(evidence, limits.evidence),
    })
  }
  /** A reference from `from` to the item of `collection` named `name`, if there is one. */
  const link = (
    from: string,
    collection: List | 'skins' | 'events',
    name: unknown,
    role: string,
    evidence: string,
  ) => {
    const position = typeof name === 'string' ? byName[collection].get(name) : undefined
    if (position === undefined) {
      diagnose(
        'warning',
        `${describe(from)} 引用的${kinds[collection]} ${String(name)} 不存在（${evidence}）。`,
        from,
      )
      return
    }
    reference(from, keyOf(collection, position), role, evidence)
  }
  const linkAll = (
    from: string,
    collection: List,
    names: unknown,
    role: string,
    evidence: string,
  ) => {
    if (names === undefined) return
    if (!Array.isArray(names)) {
      diagnose('error', `${evidence} 不是数组。`, from)
      return
    }
    names.forEach((name, position) => link(from, collection, name, role, `${evidence}/${position}`))
  }

  // Bones and their hierarchy. Spine lists parents before children; a file that does not is
  // still shown, and a cycle is broken where it closes.
  const parents = new Map<number, number>()
  items.bones.forEach((bone, position) => {
    if (bone.parent === undefined) return
    const parent = typeof bone.parent === 'string' ? byName.bones.get(bone.parent) : undefined
    if (parent === undefined)
      diagnose(
        'warning',
        `骨骼 ${listName('bones', bone, position)} 的父骨骼 ${String(bone.parent)} 不存在。`,
        keyOf('bones', position),
      )
    else parents.set(position, parent)
  })
  const walked = new Map<number, 'walking' | 'done'>()
  for (const start of [...parents.keys()]) {
    const path: number[] = []
    let current: number | undefined = start
    while (current !== undefined && !walked.has(current)) {
      walked.set(current, 'walking')
      path.push(current)
      const next = parents.get(current)
      if (next !== undefined && walked.get(next) === 'walking') {
        parents.delete(current)
        diagnose(
          'warning',
          `骨骼层级有环，${listName('bones', items.bones[current]!, current)} 的父骨骼没有显示。`,
          keyOf('bones', current),
        )
        break
      }
      current = next
    }
    for (const bone of path) walked.set(bone, 'done')
  }
  for (const [list] of lists)
    items[list].forEach((item, position) =>
      add(list, position, listName(list, item, position), {
        parent:
          list === 'bones' && parents.has(position)
            ? keyOf('bones', parents.get(position)!)
            : undefined,
      }),
    )

  // Skins and attachments. Attachments are numbered across all skins.
  const attachmentKeys = new Map<string, string>()
  const attachmentAt = (skin: number, slot: string, name: string) =>
    attachmentKeys.get(`${skin}\0${slot}\0${name}`)
  const pending: (() => void)[] = []
  let attachmentCount = 0
  let drawsFromAtlas = false
  skins.forEach((skin, s) => {
    const skinKey = add('skins', s, listName('skins', skin, s))
    for (const [slot, attachments] of mapAt(skin.attachments, pointer('skins', s, 'attachments')))
      for (const [name, attachment] of mapAt(
        attachments,
        pointer('skins', s, 'attachments', slot),
      )) {
        const evidence = pointer('skins', s, 'attachments', slot, name)
        const type = typeof attachment.type === 'string' ? attachment.type : 'region'
        const kind = attachmentKinds[type]
        let shown = name
        if (textured.has(type)) {
          drawsFromAtlas = true
          const region = [attachment.path, attachment.name].find((each) => typeof each === 'string')
          const lookup = typeof region === 'string' ? region : name
          const frames = objectAt(attachment, 'sequence')?.count
          if (typeof frames === 'number') shown = `${name}（区域 ${lookup}，${frames} 帧）`
          else if (lookup !== name) shown = `${name}（区域 ${lookup}）`
        }
        const key = add('attachments', attachmentCount++, shown, { kind, parent: skinKey })
        if (!kind) diagnose('warning', `附件 ${name} 的类型 ${type} 无法识别（${evidence}）。`, key)
        attachmentKeys.set(`${s}\0${slot}\0${name}`, key)
        link(key, 'slots', slot, '所在插槽', pointer('skins', s, 'attachments', slot))
        if (type === 'clipping' && attachment.end !== undefined)
          link(key, 'slots', attachment.end, '结束插槽', `${evidence}/end`)
        if (type === 'linkedmesh')
          // The parent may belong to a skin listed later.
          pending.push(() => {
            const skinName = typeof attachment.skin === 'string' ? attachment.skin : 'default'
            const parentSkin = byName.skins.get(skinName)
            const parent =
              parentSkin !== undefined && typeof attachment.parent === 'string'
                ? attachmentAt(parentSkin, slot, attachment.parent)
                : undefined
            if (parent) reference(key, parent, '父网格', `${evidence}/parent`)
            else
              diagnose(
                'warning',
                `链接网格 ${name} 的父网格 ${String(attachment.parent)}（皮肤 ${skinName}）不存在（${evidence}）。`,
                key,
              )
          })
      }
    for (const [list] of lists)
      linkAll(skinKey, list, skin[list], '皮肤包含', pointer('skins', s, list))
  })
  for (const resolve of pending) resolve()

  // Slots, constraints and events.
  const defaultSkin = byName.skins.get('default')
  items.slots.forEach((slot, position) => {
    const from = keyOf('slots', position)
    link(from, 'bones', slot.bone, '所在骨骼', pointer('slots', position, 'bone'))
    // The setup attachment comes from the default skin; one in another skin is not an error.
    if (
      typeof slot.attachment === 'string' &&
      defaultSkin !== undefined &&
      typeof slot.name === 'string'
    ) {
      const attachment = attachmentAt(defaultSkin, slot.name, slot.attachment)
      if (attachment)
        reference(from, attachment, '初始附件', pointer('slots', position, 'attachment'))
    }
  })
  for (const list of ['ik', 'transform', 'path'] as const)
    items[list].forEach((constraint, position) => {
      const from = keyOf(list, position)
      linkAll(from, 'bones', constraint.bones, '约束骨骼', pointer(list, position, 'bones'))
      if (constraint.target !== undefined)
        link(
          from,
          list === 'path' ? 'slots' : 'bones',
          constraint.target,
          '约束目标',
          pointer(list, position, 'target'),
        )
    })
  items.physics.forEach((constraint, position) =>
    link(
      keyOf('physics', position),
      'bones',
      constraint.bone,
      '约束骨骼',
      pointer('physics', position, 'bone'),
    ),
  )
  events.forEach(([name, event], position) => {
    const audio = typeof event.audio === 'string' && event.audio ? `（音频 ${event.audio}）` : ''
    add('events', position, `${name}${audio}`)
  })

  // Animations and what their timelines animate.
  animations.forEach(([name, animation], position) => {
    const from = add('animations', position, name)
    const at = (...parts: (string | number)[]) => pointer('animations', name, ...parts)
    const targets: [string, List][] = [
      ['bones', 'bones'],
      ['slots', 'slots'],
      ['ik', 'ik'],
      ['transform', 'transform'],
      ['path', 'path'],
      ['physics', 'physics'],
    ]
    for (const [timeline, list] of targets)
      for (const target of Object.keys(objectAt(animation, timeline) ?? {}))
        // A physics timeline with an empty name applies to every physics constraint.
        if (!(list === 'physics' && target === ''))
          link(from, list, target, '动画目标', at(timeline, target))
    // Deformed and sequenced attachments: `deform` up to 4.0, `attachments` from 4.1.
    for (const timeline of ['deform', 'attachments'])
      for (const [skinName, slots] of Object.entries(objectAt(animation, timeline) ?? {}))
        for (const [slot, attachments] of Object.entries(isObject(slots) ? slots : {}))
          for (const attachment of Object.keys(isObject(attachments) ? attachments : {})) {
            const skin = byName.skins.get(skinName)
            const key = skin === undefined ? undefined : attachmentAt(skin, slot, attachment)
            const evidence = at(timeline, skinName, slot, attachment)
            if (key) reference(from, key, '动画目标', evidence)
            else
              diagnose(
                'warning',
                `${describe(from)} 引用的附件 ${attachment}（皮肤 ${skinName}，插槽 ${slot}）不存在（${evidence}）。`,
                from,
              )
          }
    const keys = Array.isArray(animation.events) ? animation.events : []
    keys.forEach((key, k) => {
      if (isObject(key)) link(from, 'events', key.name, '动画目标', at('events', k, 'name'))
    })
    for (const timeline of ['drawOrder', 'draworder']) {
      const frames = Array.isArray(animation[timeline]) ? (animation[timeline] as unknown[]) : []
      frames.forEach((frame, f) => {
        const offsets = isObject(frame) && Array.isArray(frame.offsets) ? frame.offsets : []
        offsets.forEach((offset, o) => {
          if (isObject(offset))
            link(from, 'slots', offset.slot, '动画目标', at(timeline, f, 'offsets', o, 'slot'))
        })
      })
    }
  })

  // Display order: the lists, then skins with their attachments, events and animations.
  const order = (key: string) => {
    const collection = key.slice(0, key.indexOf('/'))
    const rank = ['bones', 'slots', 'ik', 'transform', 'path', 'physics', 'skins', 'attachments']
    return rank.includes(collection) ? rank.indexOf(collection) : rank.length
  }
  const sorted = subresources
    .map((each, position) => ({ each, position }))
    .sort((a, b) => order(a.each.key) - order(b.each.key) || a.position - b.position)
    .map(({ each }) => each)

  // The atlas, when an attachment is drawn from it. The address is the atlas the skeleton previews
  // read; whether it exists is decided by the host, and a missing one is "not found", not missing.
  const fileReferences: ReportReference[] = []
  const atlas = reportedUri(fileUri(atlasName(fileName)))
  if (drawsFromAtlas && atlas)
    fileReferences.push({ uri: atlas, role: '图集', inferred: '与骨骼文件同名' })

  return withinLimits({
    subresources: sorted,
    fileReferences,
    internal,
    diagnostics,
    partial,
    dropOrder,
  })
}
