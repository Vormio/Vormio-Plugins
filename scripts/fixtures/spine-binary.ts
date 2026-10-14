// Writes binary Spine skeletons (.skel) for the test fixtures, in the 4.2 or the 4.3 layout. Only
// what the preview fixtures use is covered: bones, slots, region attachments, skins, and rotate and
// attachment timelines; every constraint, event and other timeline list is written empty.
//
// The public binary format description still shows the 3.8 layout, so the field order here follows
// the SkeletonBinary readers of the Spine Runtimes (spine-core 4.2.120 and 4.3.13). This file is
// therefore a derivative of the Spine Runtimes and, unlike the rest of the repository, is subject to
// the Spine Runtimes License Agreement (the LICENSE of the spine-core package; the Spine plugin
// ships it as licenses/SPINE-RUNTIMES.txt).
// It is a development tool and never ends up in a plugin package.

export type BinaryLayout = '4.2' | '4.3'

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

  // Header: hash as two ints, version, the setup pose bounds and reference scale; no nonessential
  // data (fps, image and audio paths, colours).
  out.int32(0x766f726d)
  out.int32(0x696f2d31)
  out.string(skeleton.version)
  for (const value of [-100, 0, 200, 200, 100]) out.float(value)
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
    // Inherit mode 0 is "normal"; 4.3 moved it before the length.
    if (layout === '4.2') {
      out.float(bone.length ?? 0)
      out.byte(0)
    } else {
      out.byte(0)
      out.float(bone.length ?? 0)
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

  // Constraints: 4.2 has IK, transform, path and physics lists; 4.3 has one list.
  for (let count = layout === '4.2' ? 4 : 1; count > 0; count--) out.varint(0)

  const writeAttachments = (attachments: Record<number, Record<string, BinaryRegion>>) => {
    const slots = Object.entries(attachments)
    out.varint(slots.length)
    for (const [slot, byKey] of slots) {
      out.varint(Number(slot))
      const entries = Object.entries(byKey)
      out.varint(entries.length)
      for (const [key, region] of entries) {
        ref(key)
        // Type 0 is a region; flag 8: a name of its own, 16: a path, 128: a rotation.
        let flags = 0
        if (region.name !== undefined) flags |= 8
        if (region.path !== undefined) flags |= 16
        if (region.rotation) flags |= 128
        out.byte(flags)
        if (region.name !== undefined) ref(region.name)
        if (region.path !== undefined) ref(region.path)
        if (region.rotation) out.float(region.rotation)
        for (const value of [region.x ?? 0, region.y ?? 0, 1, 1, region.width, region.height])
          out.float(value)
      }
    }
  }
  const [defaultSkin, ...skins] = skeleton.skins
  writeAttachments(defaultSkin?.attachments ?? {})
  out.varint(skins.length)
  for (const skin of skins) {
    out.string(skin.name)
    out.varint(0) // bones
    for (let count = layout === '4.2' ? 4 : 1; count > 0; count--) out.varint(0) // constraints
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
    // IK, transform, path and physics timelines; 4.3 adds sliders. Then attachment (deform and
    // sequence) timelines, draw order (4.3 also draw order folders) and events.
    const empty = layout === '4.2' ? 7 : 9
    for (let count = empty; count > 0; count--) out.varint(0)
  }
  return out.result()
}
