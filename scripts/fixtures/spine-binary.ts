// Writes binary Spine skeletons (.skel) for the test fixtures, in the 4.0 to 4.3 layouts. Only
// what the preview fixtures use is covered: bones, slots, region attachments, skins, and rotate and
// attachment timelines; every constraint, event and other timeline list is written empty.
//
// The public binary format description still shows the 3.8 layout, so the field order here follows
// the SkeletonBinary readers of the Spine Runtimes (spine-core 4.0.31, 4.1.56, 4.2.120 and 4.3.13).
// This file is
// therefore a derivative of the Spine Runtimes and, unlike the rest of the repository, is subject to
// the Spine Runtimes License Agreement below, which redistribution must include. The Spine plugin
// ships the license of each runtime line in licenses/. It is a development tool and never ends up
// in a plugin package.

/*
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

export type BinaryLayout = '4.0' | '4.1' | '4.2' | '4.3'

/** What differs between the layouts, as far as this writer goes. */
interface Traits {
  /** 4.2 added the reference scale to the header. */
  referenceScale: boolean
  /** 4.3 writes the inherit mode of a bone before its length. */
  inheritFirst: boolean
  /** Constraint lists after the slots, and in each named skin: IK, transform, path, physics. */
  constraintLists: number
  /**
   * 4.2 starts an attachment with a flags byte that says which fields follow, and writes skin
   * names as strings. Before, an attachment starts with its name (null for its key) and its type,
   * and skin names are shared strings.
   */
  flags: boolean
  /** 4.1 ends a region attachment with its sequence, a boolean when there is none. */
  sequence: boolean
  /** Empty timeline lists after the bone timelines. */
  emptyTimelineLists: number
}

const layouts: Record<BinaryLayout, Traits> = {
  // IK, transform, path; then IK, transform, path, deform, draw order and event timelines.
  '4.0': {
    referenceScale: false,
    inheritFirst: false,
    constraintLists: 3,
    flags: false,
    sequence: false,
    emptyTimelineLists: 6,
  },
  '4.1': {
    referenceScale: false,
    inheritFirst: false,
    constraintLists: 3,
    flags: false,
    sequence: true,
    emptyTimelineLists: 6,
  },
  // Adds physics constraints and their timelines.
  '4.2': {
    referenceScale: true,
    inheritFirst: false,
    constraintLists: 4,
    flags: true,
    sequence: false,
    emptyTimelineLists: 7,
  },
  // One list for every kind of constraint; adds slider and draw order folder timelines.
  '4.3': {
    referenceScale: true,
    inheritFirst: true,
    constraintLists: 1,
    flags: true,
    sequence: false,
    emptyTimelineLists: 9,
  },
}

export interface BinaryRegion {
  /** The attachment's name, when it differs from its key in the skin. */
  name?: string
  /** The atlas region, when it differs from the name. */
  path?: string
  x?: number
  y?: number
  rotation?: number
  width: number
  height: number
}

export interface BinarySkeleton {
  /** The editor version written in the header, such as `4.2.43`. */
  version: string
  bones: {
    name: string
    parent?: number
    x?: number
    y?: number
    rotation?: number
    length?: number
  }[]
  slots: { name: string; bone: number; attachment?: string }[]
  /** The first skin is the default skin. Attachments by slot index, then by key. */
  skins: { name: string; attachments: Record<number, Record<string, BinaryRegion>> }[]
  animations: {
    name: string
    /** Rotation keys (time, degrees) by bone index, linear between keys. */
    rotate?: Record<number, [number, number][]>
    /** Attachment keys (time, key or null to hide) by slot index. */
    attachment?: Record<number, [number, string | null][]>
  }[]
}

class Output {
  private bytes: number[] = []
  private readonly view = new DataView(new ArrayBuffer(4))

  byte(value: number): void {
    this.bytes.push(value & 0xff)
  }
  boolean(value: boolean): void {
    this.byte(value ? 1 : 0)
  }
  /** Big-endian, as the runtime's DataView reads it. */
  int32(value: number): void {
    this.view.setInt32(0, value)
    for (let index = 0; index < 4; index++) this.byte(this.view.getUint8(index))
  }
  float(value: number): void {
    this.view.setFloat32(0, value)
    for (let index = 0; index < 4; index++) this.byte(this.view.getUint8(index))
  }
  /** A non-negative variable-length int, 7 bits per byte with the high bit set on all but the last. */
  varint(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new Error(`varint out of range: ${value}`)
    do {
      const low = value & 0x7f
      value >>>= 7
      this.byte(value ? low | 0x80 : low)
    } while (value)
  }
  /** Length plus one, then UTF-8; 0 is null. */
  string(value: string | null): void {
    if (value === null) return this.varint(0)
    const encoded = new TextEncoder().encode(value)
    this.varint(encoded.length + 1)
    for (const byte of encoded) this.byte(byte)
  }
  result(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

export function writeSkeleton(skeleton: BinarySkeleton, layout: BinaryLayout): Uint8Array {
  const out = new Output()
  const traits = layouts[layout]

  // Shared strings: every name the runtime reads as a reference into the table.
  const strings: string[] = []
  const ref = (value: string | null | undefined) => {
    if (value === null || value === undefined) return out.varint(0)
    const index = strings.indexOf(value)
    if (index < 0) throw new Error(`string not in table: ${value}`)
    out.varint(index + 1)
  }
  const share = (value: string | null | undefined) => {
    if (value !== null && value !== undefined && !strings.includes(value)) strings.push(value)
  }
  for (const slot of skeleton.slots) share(slot.attachment)
  for (const skin of skeleton.skins)
    for (const attachments of Object.values(skin.attachments))
      for (const [key, region] of Object.entries(attachments)) {
        share(key)
        share(region.name)
        share(region.path)
      }
  for (const animation of skeleton.animations)
    for (const keys of Object.values(animation.attachment ?? {}))
      for (const [, name] of keys) share(name)
  if (!traits.flags) for (const skin of skeleton.skins.slice(1)) share(skin.name)

  // Header: hash as two ints, version, the setup pose bounds and (4.2) reference scale; no
  // nonessential data (fps, image and audio paths, colours).
  out.int32(0x766f726d)
  out.int32(0x696f2d31)
  out.string(skeleton.version)
  for (const value of [-100, 0, 200, 200]) out.float(value)
  if (traits.referenceScale) out.float(100)
  out.boolean(false)
  out.varint(strings.length)
  for (const value of strings) out.string(value)

  out.varint(skeleton.bones.length)
  skeleton.bones.forEach((bone, index) => {
    out.string(bone.name)
    if (index > 0) out.varint(bone.parent ?? 0)
    out.float(bone.rotation ?? 0)
    out.float(bone.x ?? 0)
    out.float(bone.y ?? 0)
    out.float(1) // scaleX
    out.float(1) // scaleY
    out.float(0) // shearX
    out.float(0) // shearY
    // Inherit mode 0 is "normal": one byte, whether read as a byte (4.2) or a varint (before).
    if (traits.inheritFirst) {
      out.byte(0)
      out.float(bone.length ?? 0)
    } else {
      out.float(bone.length ?? 0)
      out.byte(0)
    }
    out.boolean(false) // skin required
  })

  out.varint(skeleton.slots.length)
  for (const slot of skeleton.slots) {
    out.string(slot.name)
    out.varint(slot.bone)
    out.int32(-1) // colour 0xffffffff
    out.int32(-1) // no dark colour
    ref(slot.attachment)
    out.varint(0) // normal blending
  }

  for (let count = traits.constraintLists; count > 0; count--) out.varint(0)

  const writeAttachments = (attachments: Record<number, Record<string, BinaryRegion>>) => {
    const slots = Object.entries(attachments)
    out.varint(slots.length)
    for (const [slot, byKey] of slots) {
      out.varint(Number(slot))
      const entries = Object.entries(byKey)
      out.varint(entries.length)
      for (const [key, region] of entries) {
        ref(key)
        const place = [region.x ?? 0, region.y ?? 0, 1, 1, region.width, region.height]
        if (traits.flags) {
          // Type 0 is a region; flag 8: a name of its own, 16: a path, 128: a rotation.
          let flags = 0
          if (region.name !== undefined) flags |= 8
          if (region.path !== undefined) flags |= 16
          if (region.rotation) flags |= 128
          out.byte(flags)
          if (region.name !== undefined) ref(region.name)
          if (region.path !== undefined) ref(region.path)
          if (region.rotation) out.float(region.rotation)
          for (const value of place) out.float(value)
        } else {
          ref(region.name)
          out.byte(0) // region
          ref(region.path)
          out.float(region.rotation ?? 0)
          for (const value of place) out.float(value)
          out.int32(-1) // colour 0xffffffff
          if (traits.sequence) out.boolean(false)
        }
      }
    }
  }
  const [defaultSkin, ...skins] = skeleton.skins
  writeAttachments(defaultSkin?.attachments ?? {})
  out.varint(skins.length)
  for (const skin of skins) {
    if (traits.flags) out.string(skin.name)
    else ref(skin.name)
    out.varint(0) // bones
    for (let count = traits.constraintLists; count > 0; count--) out.varint(0)
    writeAttachments(skin.attachments)
  }

  out.varint(0) // events

  out.varint(skeleton.animations.length)
  for (const animation of skeleton.animations) {
    out.string(animation.name)
    const slots = Object.entries(animation.attachment ?? {})
    const bones = Object.entries(animation.rotate ?? {})
    out.varint(slots.length + bones.length) // timeline count, a capacity hint
    out.varint(slots.length)
    for (const [slot, keys] of slots) {
      out.varint(Number(slot))
      out.varint(1)
      out.byte(0) // attachment timeline
      out.varint(keys.length)
      for (const [time, name] of keys) {
        out.float(time)
        ref(name)
      }
    }
    out.varint(bones.length)
    for (const [bone, keys] of bones) {
      out.varint(Number(bone))
      out.varint(1)
      out.byte(0) // rotate timeline
      out.varint(keys.length)
      out.varint(0) // no Bézier curves
      keys.forEach(([time, value], index) => {
        out.float(time)
        out.float(value)
        // Each key but the first is followed by the curve from the previous key: 0 is linear.
        if (index > 0) out.byte(0)
      })
    }
    for (let count = traits.emptyTimelineLists; count > 0; count--) out.varint(0)
  }
  return out.result()
}
