// Builds the composition report of a binary skeleton (.skel), Spine 3.7, 3.8 and 4.0 to 4.3. The
// binary layout changes with every version and is described in public only for 3.8, so the file is
// read by the runtime of its own line that the previews use (the plugin's port for 3.7), with a
// stand-in atlas: the analysis reads the skeleton alone. What the runtime read is written back as the
// skeleton JSON of the same version, as far as the JSON analyzer reads it, and analyzed by it: the
// .skel and .json of one export give the same report, except that a binary file has no JSON pointers
// to give as evidence. No DOM, so it runs in Node tests as well as in the analyzer page.
//
// The runtimes' classes are told apart with instanceof against the runtime's own namespace: the
// plugin build minifies class names.

import type { CompositionReport } from '@vormio/plugin-sdk'
import type * as Spine43 from 'spine-webgl-4.3'
import { failureMessage, SpineError } from './errors.ts'
import { readSkeletonBinary37 } from './preview/binary-3.7.ts'
import type { RuntimeLine } from './preview/version.ts'
import { analyzeSkeleton } from './skeleton.ts'

/** A runtime's namespace, typed as 4.3; older lines lack some classes and name some fields apart. */
export type Spine = typeof Spine43
type SkeletonData = Spine43.SkeletonData
type Json = Record<string, unknown>
// The data classes differ between the lines (fields renamed, getters in place of fields), so they
// are read loosely; every field read here is checked against each line's reader by the tests.
type Loose = any

/** One page with one region, which stands in for every region a skeleton asks for. */
const atlases = {
  classic:
    '\nstand-in.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nstand-in\n  rotate: false\n  xy: 0, 0\n  size: 1, 1\n  orig: 1, 1\n  offset: 0, 0\n  index: -1\n',
  modern: 'stand-in.png\nsize: 2,2\nfilter: Linear,Linear\nstand-in\nbounds: 0,0,1,1\n',
}
/** 3.7 and 3.8 ask for each page's texture while reading the atlas, and take its size from it. */
const texture = {
  setFilters() {},
  setWraps() {},
  dispose() {},
  getImage: () => ({ width: 2, height: 2 }),
}

/**
 * An attachment loader whose atlas is a stand-in: its one region answers every lookup, so
 * attachments are read as they are written; nothing is drawn with it.
 */
export function standInLoader(spine: Spine, line: RuntimeLine): Spine43.AtlasAttachmentLoader {
  const atlas: Loose =
    line === '3.7' || line === '3.8'
      ? new (spine.TextureAtlas as Loose)(atlases.classic, () => texture)
      : new spine.TextureAtlas(atlases.modern)
  const region = atlas.regions[0]
  atlas.findRegion = () => region
  return new spine.AtlasAttachmentLoader(atlas)
}

/** Reads binary skeleton data with the runtime of ; throws the runtime's error when it cannot. */
export function readSkeletonData(spine: Spine, line: RuntimeLine, bytes: Uint8Array): SkeletonData {
  const loader = standInLoader(spine, line)
  // The 3.8 and 4.0 readers view the buffer from its start, so the bytes get a buffer of their own.
  const own = new Uint8Array(bytes)
  return line === '3.7'
    ? readSkeletonBinary37(spine, loader, own)
    : new spine.SkeletonBinary(loader).readSkeletonData(own)
}

type ConstraintList = 'ik' | 'transform' | 'path' | 'physics' | 'slider'

/**
 * The skeleton JSON of `line` for `data`, as far as the JSON analyzer reads it: names and what refers
 * to what, in the order the runtime keeps them (the order of the file).
 */
export function skeletonJson(spine: Spine, line: RuntimeLine, data: SkeletonData): Json {
  const s = spine as Loose
  const d = data as Loose
  const before38 = line === '3.7'
  const from43 = line === '4.3'
  const names = (list: Loose) => Array.from(list ?? [], (each: Loose) => each.name as string)
  const optional = (field: string, value: unknown) =>
    value === undefined || value === null ? {} : { [field]: value }

  /** Which list a constraint belongs to; undefined for kinds this plugin does not know. */
  const kindOf = (constraint: Loose): ConstraintList | undefined => {
    if (constraint instanceof s.IkConstraintData) return 'ik'
    if (constraint instanceof s.TransformConstraintData) return 'transform'
    if (constraint instanceof s.PathConstraintData) return 'path'
    if (s.SliderData && constraint instanceof s.SliderData) return 'slider'
    // The 4.2 namespace does not export PhysicsConstraintData; physics constraints are the ones
    // with inertia.
    if (
      s.PhysicsConstraintData
        ? constraint instanceof s.PhysicsConstraintData
        : 'inertia' in constraint
    )
      return 'physics'
    return undefined
  }
  /** The constraints of each list, in order: one list for all of them from 4.3. */
  const constraints: [ConstraintList, Loose][] = from43
    ? Array.from(
        d.constraints ?? [],
        (each: Loose) => [kindOf(each)!, each] as [ConstraintList, Loose],
      ).filter(([kind]) => kind)
    : [
        ...Array.from(d.ikConstraints ?? [], (each) => ['ik', each] as [ConstraintList, Loose]),
        ...Array.from(
          d.transformConstraints ?? [],
          (each) => ['transform', each] as [ConstraintList, Loose],
        ),
        ...Array.from(d.pathConstraints ?? [], (each) => ['path', each] as [ConstraintList, Loose]),
        ...Array.from(
          d.physicsConstraints ?? [],
          (each) => ['physics', each] as [ConstraintList, Loose],
        ),
      ]
  const constraintJson = (kind: ConstraintList, constraint: Loose): Json => {
    const name = constraint.name as string
    switch (kind) {
      case 'ik':
        return {
          name,
          bones: names(constraint.bones),
          ...optional('target', constraint.target?.name),
        }
      case 'transform':
        return from43
          ? { name, bones: names(constraint.bones), ...optional('source', constraint.source?.name) }
          : { name, bones: names(constraint.bones), ...optional('target', constraint.target?.name) }
      case 'path':
        return from43
          ? { name, bones: names(constraint.bones), ...optional('slot', constraint.slot?.name) }
          : { name, bones: names(constraint.bones), ...optional('target', constraint.target?.name) }
      case 'physics':
        return { name, bone: constraint.bone?.name }
      case 'slider':
        return {
          name,
          ...optional('bone', constraint.bone?.name),
          animation: constraint.animation?.name,
        }
    }
  }

  // Where each attachment is: skin, slot and key. Linked meshes and deform timelines refer to them.
  const slotName = (index: number) => d.slots[index]?.name as string
  const located = new Map<object, { skin: string; slot: string; key: string }>()
  const entries = Array.from(d.skins ?? [], (skin: Loose) => {
    const bySlot: [string, [string, Loose][]][] = []
    Array.from(skin.attachments ?? [], (byKey: Loose, slot: number) => {
      if (!byKey) return
      const attachments = Object.entries(byKey).filter(([, attachment]) => attachment)
      if (!attachments.length) return
      bySlot.push([slotName(slot), attachments])
      for (const [key, attachment] of attachments)
        located.set(attachment as object, { skin: skin.name, slot: slotName(slot), key })
    })
    return { skin, bySlot }
  })

  const sequenceJson = (attachment: Loose) => {
    const sequence = attachment.sequence
    // From 4.3 every textured attachment has one, and only one with a path suffix is a sequence.
    if (!sequence || (from43 && !sequence.pathSuffix)) return {}
    return {
      sequence: { count: sequence.regions.length, start: sequence.start, digits: sequence.digits },
    }
  }
  const attachmentJson = (attachment: Loose, key: string, slot: string): Json => {
    const textured = (type: string): Json => ({
      type,
      ...(attachment.name !== key ? { name: attachment.name } : {}),
      ...(attachment.path !== attachment.name ? optional('path', attachment.path) : {}),
      ...sequenceJson(attachment),
    })
    if (attachment instanceof s.RegionAttachment) return textured('region')
    if (attachment instanceof s.MeshAttachment) {
      const parent = attachment.getSourceMesh?.() ?? attachment.getParentMesh?.()
      const at = parent ? located.get(parent) : undefined
      if (!at) return textured('mesh')
      return {
        ...textured('linkedmesh'),
        [from43 ? 'source' : 'parent']: at.key,
        skin: at.skin,
        ...(from43 && at.slot !== slot ? { slot: at.slot } : {}),
      }
    }
    if (attachment instanceof s.BoundingBoxAttachment) return { type: 'boundingbox' }
    if (attachment instanceof s.PathAttachment) return { type: 'path' }
    if (attachment instanceof s.PointAttachment) return { type: 'point' }
    if (attachment instanceof s.ClippingAttachment)
      return { type: 'clipping', ...optional('end', attachment.endSlot?.name) }
    return { type: 'unknown' }
  }
  const attachmentsJson = (bySlot: [string, [string, Loose][]][]) =>
    Object.fromEntries(
      bySlot.map(([slot, attachments]) => [
        slot,
        Object.fromEntries(
          attachments.map(([key, attachment]) => [key, attachmentJson(attachment, key, slot)]),
        ),
      ]),
    )
  /** From 3.8, a skin lists the bones and constraints only it uses. */
  const skinContents = (skin: Loose): Json => {
    const contents: Json = {}
    if (skin.bones?.length) contents.bones = names(skin.bones)
    for (const constraint of skin.constraints ?? []) {
      const kind = kindOf(constraint)
      if (kind) ((contents[kind] ??= []) as string[]).push(constraint.name)
    }
    return contents
  }
  const skins = before38
    ? Object.fromEntries(entries.map(({ skin, bySlot }) => [skin.name, attachmentsJson(bySlot)]))
    : entries.map(({ skin, bySlot }) => ({
        name: skin.name,
        ...skinContents(skin),
        attachments: attachmentsJson(bySlot),
      }))

  // Animations: what each timeline animates, under the key the JSON of this version uses.
  const deformKey = line === '3.7' || line === '3.8' || line === '4.0' ? 'deform' : 'attachments'
  const pathKey = before38 ? 'paths' : 'path'
  const constraintAt = (timeline: Loose): [ConstraintList, Loose] | undefined => {
    if (typeof timeline.ikConstraintIndex === 'number')
      return ['ik', d.ikConstraints[timeline.ikConstraintIndex]]
    if (typeof timeline.transformConstraintIndex === 'number')
      return ['transform', d.transformConstraints[timeline.transformConstraintIndex]]
    if (typeof timeline.pathConstraintIndex === 'number')
      return ['path', d.pathConstraints[timeline.pathConstraintIndex]]
    const index = timeline.constraintIndex
    // -1: a physics timeline for every physics constraint, which names none.
    if (typeof index !== 'number' || index < 0) return undefined
    if (from43) {
      const constraint = d.constraints[index]
      const kind = kindOf(constraint)
      return kind && [kind, constraint]
    }
    // 4.2 numbers each kind's constraints apart.
    if (timeline instanceof s.IkConstraintTimeline) return ['ik', d.ikConstraints[index]]
    if (timeline instanceof s.TransformConstraintTimeline)
      return ['transform', d.transformConstraints[index]]
    if (
      timeline instanceof s.PathConstraintPositionTimeline ||
      timeline instanceof s.PathConstraintSpacingTimeline ||
      timeline instanceof s.PathConstraintMixTimeline
    )
      return ['path', d.pathConstraints[index]]
    return ['physics', d.physicsConstraints?.[index]]
  }
  const animations = Object.fromEntries(
    Array.from(d.animations ?? [], (animation: Loose) => {
      const json: Record<string, Loose> = {}
      const target = (group: string, name: string | undefined) => {
        if (name !== undefined) (json[group] ??= {})[name] = {}
      }
      const timelines = Array.from(animation.timelines ?? [], (timeline: Loose) => timeline)
      for (const timeline of timelines) {
        if (timeline.attachment && typeof timeline.attachment === 'object') {
          // Deform and sequence timelines animate one attachment of one skin.
          const at = located.get(timeline.attachment)
          if (at) (((json[deformKey] ??= {})[at.skin] ??= {})[at.slot] ??= {})[at.key] = {}
        } else if (typeof timeline.boneIndex === 'number')
          target('bones', d.bones[timeline.boneIndex]?.name)
        else if (timeline instanceof s.EventTimeline) {
          for (const event of timeline.events ?? [])
            if (event) (json.events ??= []).push({ name: event.data?.name })
        } else if (timeline instanceof s.DrawOrderTimeline) {
          for (const order of timeline.drawOrders ?? [])
            if (order)
              (json.drawOrder ??= []).push({
                offsets: movedSlots(Array.from(order as number[])).map((slot) => ({
                  slot: slotName(slot),
                })),
              })
        } else if (s.DrawOrderFolderTimeline && timeline instanceof s.DrawOrderFolderTimeline)
          (json.drawOrderFolder ??= []).push({ slots: Array.from(timeline.slots ?? [], slotName) })
        else if (typeof timeline.slotIndex === 'number')
          target('slots', slotName(timeline.slotIndex))
        else {
          const constraint = constraintAt(timeline)
          if (constraint?.[1])
            target(constraint[0] === 'path' ? pathKey : constraint[0], constraint[1].name)
        }
      }
      return [animation.name as string, json]
    }),
  )

  const lists: Json = {}
  if (from43)
    lists.constraints = constraints.map(([kind, each]) => ({
      type: kind,
      ...constraintJson(kind, each),
    }))
  else
    for (const [kind, each] of constraints)
      ((lists[kind] ??= []) as Json[]).push(constraintJson(kind, each))

  return {
    skeleton: { spine: d.version ?? '' },
    bones: Array.from(d.bones ?? [], (bone: Loose) => ({
      name: bone.name,
      ...optional('parent', bone.parent?.name),
    })),
    slots: Array.from(d.slots ?? [], (slot: Loose) => ({
      name: slot.name,
      bone: slot.boneData?.name,
      ...optional('attachment', slot.attachmentName),
    })),
    ...lists,
    skins,
    events: Object.fromEntries(
      Array.from(d.events ?? [], (event: Loose) => [
        event.name,
        event.audioPath ? { audio: event.audioPath } : {},
      ]),
    ),
    animations,
  }
}

/**
 * The slots a draw order key lists, from the whole order the runtime keeps for it (slot indices by
 * draw position). A key lists the slots it moves, each with an offset; the runtime places them and
 * fills the other positions with the other slots in setup order. So the slots not listed are in
 * setup order, and the fewest listed are the ones outside a longest increasing run of the order.
 */
export function movedSlots(order: number[]): number[] {
  // Patience sorting: tails[k] is the position ending the best increasing run of length k + 1.
  const tails: number[] = []
  const before = new Array<number>(order.length).fill(-1)
  order.forEach((slot, position) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (order[tails[middle]!]! < slot) low = middle + 1
      else high = middle
    }
    if (low > 0) before[position] = tails[low - 1]!
    tails[low] = position
  })
  const kept = new Set<number>()
  for (let position = tails.at(-1) ?? -1; position >= 0; position = before[position]!)
    kept.add(position)
  return order.filter((_, position) => !kept.has(position)).sort((a, b) => a - b)
}

/**
 * Analyzes the binary skeleton `bytes`, written by Spine of `line`, with the runtime `spine` of that
 * line; `fileName` is the name of the skeleton file. Data the runtime cannot read fails the analysis
 * with the runtime's reason, as the previews do.
 */
export function analyzeSkeletonBinary(
  spine: Spine,
  line: RuntimeLine,
  bytes: Uint8Array,
  fileName: string,
): CompositionReport {
  let data: SkeletonData
  try {
    data = readSkeletonData(spine, line, bytes)
  } catch (error) {
    throw new SpineError(failureMessage(error))
  }
  const report = analyzeSkeleton(skeletonJson(spine, line, data), fileName)
  // The pointers are into JSON written here, not into the file: a binary file gives no evidence.
  return {
    ...report,
    references: report.references.map(({ evidence: _evidence, ...reference }) => reference),
  }
}
