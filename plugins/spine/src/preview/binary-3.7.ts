/*
 * Spine Runtimes License Agreement
 * Last updated May 1, 2019. Replaces all prior versions.
 *
 * Copyright (c) 2013-2019, Esoteric Software LLC
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
 * THIS SOFTWARE IS PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY EXPRESS
 * OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN
 * NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, BUSINESS
 * INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Reads binary Spine 3.7 skeletons (.skel) into the data classes of spine-ts 3.7, which has no binary
// reader of its own (spine-ts gained one in 3.8). A port of SkeletonBinary from spine-libgdx 3.7 (the
// spine-runtimes 3.7 branch at 7f7e5f0f, the last commit that changed it), the official runtime that
// reads this layout, written against the spine-ts 3.7 classes the way its SkeletonJson builds them. It is therefore a derivative of the Spine Runtimes and, unlike the
// plugin's own code, is subject to the Spine Runtimes License Agreement above.
//
// The vendored 3.7 script has no types, so its objects are handled as `any` here. Tests compare what
// this reader produces with what the official JSON reader makes of the same skeleton's JSON export.

type Spine37 = any
type Data = any

const SLOT_ATTACHMENT = 0
const SLOT_COLOR = 1
const SLOT_TWO_COLOR = 2

const BONE_ROTATE = 0
const BONE_TRANSLATE = 1
const BONE_SCALE = 2
const BONE_SHEAR = 3

const PATH_POSITION = 0
const PATH_SPACING = 1
const PATH_MIX = 2

const CURVE_STEPPED = 1
const CURVE_BEZIER = 2

// Enumerations as the binary format numbers them; spine-ts 3.7 numbers its enums the same way.
const ATTACHMENT_REGION = 0
const ATTACHMENT_BOUNDING_BOX = 1
const ATTACHMENT_MESH = 2
const ATTACHMENT_LINKED_MESH = 3
const ATTACHMENT_PATH = 4
const ATTACHMENT_POINT = 5
const ATTACHMENT_CLIPPING = 6
const POSITION_FIXED = 0
const SPACING_LENGTH = 0
const SPACING_FIXED = 1

/** Big-endian reads over the skeleton's bytes, as the 3.7 runtimes read them. */
class Input {
  private index = 0
  private readonly bytes: Uint8Array
  private readonly view: DataView
  private readonly decoder = new TextDecoder()

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  readByte(): number {
    return this.view.getInt8(this.index++)
  }

  readBoolean(): boolean {
    return this.readByte() !== 0
  }

  readShort(): number {
    const value = this.view.getInt16(this.index)
    this.index += 2
    return value
  }

  readInt32(): number {
    const value = this.view.getInt32(this.index)
    this.index += 4
    return value
  }

  /** A variable-length int: 7 bits a byte, low bits first; zigzag-decoded unless `optimizePositive`. */
  readInt(optimizePositive: boolean): number {
    let result = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.view.getUint8(this.index++)
      result |= (byte & 0x7f) << shift
      if (!(byte & 0x80)) break
    }
    // Signed 32 bits either way: a draw order offset is a negative "positive" int.
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1)
  }

  /** Its byte count plus one, then UTF-8; 0 is null and 1 the empty string. */
  readString(): string | null {
    const count = this.readInt(true)
    if (count === 0) return null
    if (count === 1) return ''
    const end = this.index + count - 1
    if (end > this.bytes.length) throw new RangeError('Offset is outside the bounds of the data')
    const value = this.decoder.decode(this.bytes.subarray(this.index, end))
    this.index = end
    return value
  }

  readFloat(): number {
    const value = this.view.getFloat32(this.index)
    this.index += 4
    return value
  }
}

function rgba8888(color: Data, value: number): void {
  color.r = ((value & 0xff000000) >>> 24) / 255
  color.g = ((value & 0x00ff0000) >>> 16) / 255
  color.b = ((value & 0x0000ff00) >>> 8) / 255
  color.a = (value & 0x000000ff) / 255
}

function rgb888(color: Data, value: number): void {
  color.r = ((value & 0xff0000) >>> 16) / 255
  color.g = ((value & 0x00ff00) >>> 8) / 255
  color.b = (value & 0x0000ff) / 255
}

interface LinkedMesh {
  mesh: Data
  skin: string | null
  slotIndex: number
  parent: string
}

/**
 * Reads a 3.7 binary skeleton. `attachmentLoader` is a spine-ts 3.7 AttachmentLoader, usually an
 * AtlasAttachmentLoader over the skeleton's atlas. Reads at scale 1, as the plugin does for every
 * line. Throws when the data is cut short or names something that does not exist.
 */
export function readSkeletonBinary37(
  spine: Spine37,
  attachmentLoader: Data,
  bytes: Uint8Array,
): Data {
  const input = new Input(bytes)
  const linkedMeshes: LinkedMesh[] = []
  const skeletonData = new spine.SkeletonData()
  skeletonData.name = ''

  skeletonData.hash = input.readString() || null
  skeletonData.version = input.readString() || null
  skeletonData.width = input.readFloat()
  skeletonData.height = input.readFloat()
  const nonessential = input.readBoolean()
  if (nonessential) {
    skeletonData.fps = input.readFloat()
    skeletonData.imagesPath = input.readString() || null
    skeletonData.audioPath = input.readString() || null
  }

  // Bones.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readString()
    const parent = i === 0 ? null : skeletonData.bones[input.readInt(true)]
    const data = new spine.BoneData(i, name, parent)
    data.rotation = input.readFloat()
    data.x = input.readFloat()
    data.y = input.readFloat()
    data.scaleX = input.readFloat()
    data.scaleY = input.readFloat()
    data.shearX = input.readFloat()
    data.shearY = input.readFloat()
    data.length = input.readFloat()
    data.transformMode = input.readInt(true)
    // The bone colour of the editor; spine-ts 3.7 bones have none, so it is skipped.
    if (nonessential) input.readInt32()
    skeletonData.bones.push(data)
  }

  // Slots.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readString()
    const boneData = skeletonData.bones[input.readInt(true)]
    const data = new spine.SlotData(i, name, boneData)
    rgba8888(data.color, input.readInt32())
    const darkColor = input.readInt32()
    // Opaque, as spine-ts 3.7's own reader (SkeletonJson) makes it; only the colour is drawn.
    if (darkColor !== -1) rgb888((data.darkColor = new spine.Color(1, 1, 1, 1)), darkColor)
    data.attachmentName = input.readString()
    data.blendMode = input.readInt(true)
    skeletonData.slots.push(data)
  }

  // IK constraints.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const data = new spine.IkConstraintData(input.readString())
    data.order = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++)
      data.bones.push(skeletonData.bones[input.readInt(true)])
    data.target = skeletonData.bones[input.readInt(true)]
    data.mix = input.readFloat()
    data.bendDirection = input.readByte()
    data.compress = input.readBoolean()
    data.stretch = input.readBoolean()
    data.uniform = input.readBoolean()
    skeletonData.ikConstraints.push(data)
  }

  // Transform constraints.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const data = new spine.TransformConstraintData(input.readString())
    data.order = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++)
      data.bones.push(skeletonData.bones[input.readInt(true)])
    data.target = skeletonData.bones[input.readInt(true)]
    data.local = input.readBoolean()
    data.relative = input.readBoolean()
    data.offsetRotation = input.readFloat()
    data.offsetX = input.readFloat()
    data.offsetY = input.readFloat()
    data.offsetScaleX = input.readFloat()
    data.offsetScaleY = input.readFloat()
    data.offsetShearY = input.readFloat()
    data.rotateMix = input.readFloat()
    data.translateMix = input.readFloat()
    data.scaleMix = input.readFloat()
    data.shearMix = input.readFloat()
    skeletonData.transformConstraints.push(data)
  }

  // Path constraints.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const data = new spine.PathConstraintData(input.readString())
    data.order = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++)
      data.bones.push(skeletonData.bones[input.readInt(true)])
    data.target = skeletonData.slots[input.readInt(true)]
    data.positionMode = input.readInt(true)
    data.spacingMode = input.readInt(true)
    data.rotateMode = input.readInt(true)
    data.offsetRotation = input.readFloat()
    data.position = input.readFloat()
    data.spacing = input.readFloat()
    data.rotateMix = input.readFloat()
    data.translateMix = input.readFloat()
    skeletonData.pathConstraints.push(data)
  }

  // Default skin.
  const defaultSkin = readSkin(
    input,
    spine,
    attachmentLoader,
    skeletonData,
    'default',
    nonessential,
    linkedMeshes,
  )
  if (defaultSkin) {
    skeletonData.defaultSkin = defaultSkin
    skeletonData.skins.push(defaultSkin)
  }

  // Skins.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readString()
    skeletonData.skins.push(
      readSkin(input, spine, attachmentLoader, skeletonData, name, nonessential, linkedMeshes),
    )
  }

  // Linked meshes.
  for (const linkedMesh of linkedMeshes) {
    const skin =
      linkedMesh.skin === null ? skeletonData.defaultSkin : skeletonData.findSkin(linkedMesh.skin)
    if (!skin) throw new Error(`Skin not found: ${linkedMesh.skin}`)
    const parent = skin.getAttachment(linkedMesh.slotIndex, linkedMesh.parent)
    if (!parent) throw new Error(`Parent mesh not found: ${linkedMesh.parent}`)
    linkedMesh.mesh.setParentMesh(parent)
    linkedMesh.mesh.updateUVs()
  }

  // Events.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const data = new spine.EventData(input.readString())
    data.intValue = input.readInt(false)
    data.floatValue = input.readFloat()
    data.stringValue = input.readString()
    data.audioPath = input.readString()
    if (data.audioPath !== null) {
      data.volume = input.readFloat()
      data.balance = input.readFloat()
    }
    skeletonData.events.push(data)
  }

  // Animations.
  for (let i = 0, n = input.readInt(true); i < n; i++)
    skeletonData.animations.push(readAnimation(input, spine, input.readString(), skeletonData))

  return skeletonData
}

/** A skin and its attachments; null for a default skin without any. */
function readSkin(
  input: Input,
  spine: Spine37,
  attachmentLoader: Data,
  skeletonData: Data,
  skinName: string | null,
  nonessential: boolean,
  linkedMeshes: LinkedMesh[],
): Data {
  const slotCount = input.readInt(true)
  if (slotCount === 0) return null
  const skin = new spine.Skin(skinName)
  for (let i = 0; i < slotCount; i++) {
    const slotIndex = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const name = input.readString()
      const attachment = readAttachment(
        input,
        spine,
        attachmentLoader,
        skeletonData,
        skin,
        slotIndex,
        name!,
        nonessential,
        linkedMeshes,
      )
      if (attachment) skin.addAttachment(slotIndex, name, attachment)
    }
  }
  return skin
}

function readAttachment(
  input: Input,
  spine: Spine37,
  attachmentLoader: Data,
  skeletonData: Data,
  skin: Data,
  slotIndex: number,
  attachmentName: string,
  nonessential: boolean,
  linkedMeshes: LinkedMesh[],
): Data {
  const name = input.readString() ?? attachmentName
  switch (input.readByte()) {
    case ATTACHMENT_REGION: {
      const path = input.readString() ?? name
      const rotation = input.readFloat()
      const x = input.readFloat()
      const y = input.readFloat()
      const scaleX = input.readFloat()
      const scaleY = input.readFloat()
      const width = input.readFloat()
      const height = input.readFloat()
      const color = input.readInt32()
      const region = attachmentLoader.newRegionAttachment(skin, name, path)
      if (!region) return null
      region.path = path
      region.x = x
      region.y = y
      region.scaleX = scaleX
      region.scaleY = scaleY
      region.rotation = rotation
      region.width = width
      region.height = height
      rgba8888(region.color, color)
      region.updateOffset()
      return region
    }
    case ATTACHMENT_BOUNDING_BOX: {
      const vertexCount = input.readInt(true)
      const vertices = readVertices(input, spine, vertexCount)
      const color = nonessential ? input.readInt32() : 0
      const box = attachmentLoader.newBoundingBoxAttachment(skin, name)
      if (!box) return null
      box.worldVerticesLength = vertexCount << 1
      box.vertices = vertices.vertices
      box.bones = vertices.bones
      if (nonessential) rgba8888(box.color, color)
      return box
    }
    case ATTACHMENT_MESH: {
      const path = input.readString() ?? name
      const color = input.readInt32()
      const vertexCount = input.readInt(true)
      const uvs = readFloatArray(input, vertexCount << 1)
      const triangles = readShortArray(input)
      const vertices = readVertices(input, spine, vertexCount)
      const hullLength = input.readInt(true)
      let edges: number[] | null = null
      let width = 0
      let height = 0
      if (nonessential) {
        edges = readShortArray(input)
        width = input.readFloat()
        height = input.readFloat()
      }
      const mesh = attachmentLoader.newMeshAttachment(skin, name, path)
      if (!mesh) return null
      mesh.path = path
      rgba8888(mesh.color, color)
      mesh.bones = vertices.bones
      mesh.vertices = vertices.vertices
      mesh.worldVerticesLength = vertexCount << 1
      mesh.triangles = triangles
      mesh.regionUVs = uvs
      mesh.updateUVs()
      mesh.hullLength = hullLength << 1
      if (nonessential) {
        mesh.edges = edges
        mesh.width = width
        mesh.height = height
      }
      return mesh
    }
    case ATTACHMENT_LINKED_MESH: {
      const path = input.readString() ?? name
      const color = input.readInt32()
      const skinName = input.readString()
      const parent = input.readString()
      const inheritDeform = input.readBoolean()
      let width = 0
      let height = 0
      if (nonessential) {
        width = input.readFloat()
        height = input.readFloat()
      }
      const mesh = attachmentLoader.newMeshAttachment(skin, name, path)
      if (!mesh) return null
      mesh.path = path
      rgba8888(mesh.color, color)
      mesh.inheritDeform = inheritDeform
      if (nonessential) {
        mesh.width = width
        mesh.height = height
      }
      linkedMeshes.push({ mesh, skin: skinName, slotIndex, parent: parent! })
      return mesh
    }
    case ATTACHMENT_PATH: {
      const closed = input.readBoolean()
      const constantSpeed = input.readBoolean()
      const vertexCount = input.readInt(true)
      const vertices = readVertices(input, spine, vertexCount)
      const lengths: number[] = new Array(vertexCount / 3)
      for (let i = 0; i < lengths.length; i++) lengths[i] = input.readFloat()
      const color = nonessential ? input.readInt32() : 0
      const path = attachmentLoader.newPathAttachment(skin, name)
      if (!path) return null
      path.closed = closed
      path.constantSpeed = constantSpeed
      path.worldVerticesLength = vertexCount << 1
      path.vertices = vertices.vertices
      path.bones = vertices.bones
      path.lengths = lengths
      if (nonessential) rgba8888(path.color, color)
      return path
    }
    case ATTACHMENT_POINT: {
      const rotation = input.readFloat()
      const x = input.readFloat()
      const y = input.readFloat()
      const color = nonessential ? input.readInt32() : 0
      const point = attachmentLoader.newPointAttachment(skin, name)
      if (!point) return null
      point.x = x
      point.y = y
      point.rotation = rotation
      if (nonessential) rgba8888(point.color, color)
      return point
    }
    case ATTACHMENT_CLIPPING: {
      const endSlotIndex = input.readInt(true)
      const vertexCount = input.readInt(true)
      const vertices = readVertices(input, spine, vertexCount)
      const color = nonessential ? input.readInt32() : 0
      const clip = attachmentLoader.newClippingAttachment(skin, name)
      if (!clip) return null
      clip.endSlot = skeletonData.slots[endSlotIndex]
      clip.worldVerticesLength = vertexCount << 1
      clip.vertices = vertices.vertices
      clip.bones = vertices.bones
      if (nonessential) rgba8888(clip.color, color)
      return clip
    }
  }
  return null
}

/** Unweighted vertices as x, y pairs; weighted ones as bone counts with bone, x, y, weight. */
function readVertices(
  input: Input,
  spine: Spine37,
  vertexCount: number,
): { vertices: ArrayLike<number>; bones: number[] | null } {
  const verticesLength = vertexCount << 1
  if (!input.readBoolean())
    return {
      vertices: spine.Utils.toFloatArray(readFloatArray(input, verticesLength)),
      bones: null,
    }
  const weights: number[] = []
  const bones: number[] = []
  for (let i = 0; i < vertexCount; i++) {
    const boneCount = input.readInt(true)
    bones.push(boneCount)
    for (let ii = 0; ii < boneCount; ii++) {
      bones.push(input.readInt(true))
      weights.push(input.readFloat(), input.readFloat(), input.readFloat())
    }
  }
  return { vertices: spine.Utils.toFloatArray(weights), bones }
}

function readFloatArray(input: Input, n: number): number[] {
  const array: number[] = new Array(n)
  for (let i = 0; i < n; i++) array[i] = input.readFloat()
  return array
}

function readShortArray(input: Input): number[] {
  const n = input.readInt(true)
  const array: number[] = new Array(n)
  for (let i = 0; i < n; i++) array[i] = input.readShort()
  return array
}

/** The curve from key `frame` to the next: linear (nothing to set), stepped or Bézier. */
function readCurve(input: Input, frame: number, timeline: Data): void {
  switch (input.readByte()) {
    case CURVE_STEPPED:
      timeline.setStepped(frame)
      break
    case CURVE_BEZIER:
      timeline.setCurve(
        frame,
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
      )
      break
  }
}

function readAnimation(
  input: Input,
  spine: Spine37,
  name: string | null,
  skeletonData: Data,
): Data {
  const timelines: Data[] = []
  let duration = 0
  /** Notes the time of a timeline's last key. */
  const ends = (time: number) => (duration = Math.max(duration, time))
  const color = new spine.Color()
  const dark = new spine.Color()

  // Slot timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const slotIndex = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte()
      const frameCount = input.readInt(true)
      switch (type) {
        case SLOT_ATTACHMENT: {
          const timeline = new spine.AttachmentTimeline(frameCount)
          timeline.slotIndex = slotIndex
          let time = 0
          for (let frame = 0; frame < frameCount; frame++)
            timeline.setFrame(frame, (time = input.readFloat()), input.readString())
          timelines.push(timeline)
          ends(time)
          break
        }
        case SLOT_COLOR: {
          const timeline = new spine.ColorTimeline(frameCount)
          timeline.slotIndex = slotIndex
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            time = input.readFloat()
            rgba8888(color, input.readInt32())
            timeline.setFrame(frame, time, color.r, color.g, color.b, color.a)
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
        case SLOT_TWO_COLOR: {
          const timeline = new spine.TwoColorTimeline(frameCount)
          timeline.slotIndex = slotIndex
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            time = input.readFloat()
            rgba8888(color, input.readInt32())
            rgb888(dark, input.readInt32())
            timeline.setFrame(
              frame,
              time,
              color.r,
              color.g,
              color.b,
              color.a,
              dark.r,
              dark.g,
              dark.b,
            )
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
      }
    }
  }

  // Bone timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const boneIndex = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte()
      const frameCount = input.readInt(true)
      switch (type) {
        case BONE_ROTATE: {
          const timeline = new spine.RotateTimeline(frameCount)
          timeline.boneIndex = boneIndex
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            timeline.setFrame(frame, (time = input.readFloat()), input.readFloat())
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
        case BONE_TRANSLATE:
        case BONE_SCALE:
        case BONE_SHEAR: {
          const timeline =
            type === BONE_SCALE
              ? new spine.ScaleTimeline(frameCount)
              : type === BONE_SHEAR
                ? new spine.ShearTimeline(frameCount)
                : new spine.TranslateTimeline(frameCount)
          timeline.boneIndex = boneIndex
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            timeline.setFrame(
              frame,
              (time = input.readFloat()),
              input.readFloat(),
              input.readFloat(),
            )
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
      }
    }
  }

  // IK constraint timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const index = input.readInt(true)
    const frameCount = input.readInt(true)
    const timeline = new spine.IkConstraintTimeline(frameCount)
    timeline.ikConstraintIndex = index
    let time = 0
    for (let frame = 0; frame < frameCount; frame++) {
      timeline.setFrame(
        frame,
        (time = input.readFloat()),
        input.readFloat(),
        input.readByte(),
        input.readBoolean(),
        input.readBoolean(),
      )
      if (frame < frameCount - 1) readCurve(input, frame, timeline)
    }
    timelines.push(timeline)
    ends(time)
  }

  // Transform constraint timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const index = input.readInt(true)
    const frameCount = input.readInt(true)
    const timeline = new spine.TransformConstraintTimeline(frameCount)
    timeline.transformConstraintIndex = index
    let time = 0
    for (let frame = 0; frame < frameCount; frame++) {
      timeline.setFrame(
        frame,
        (time = input.readFloat()),
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
        input.readFloat(),
      )
      if (frame < frameCount - 1) readCurve(input, frame, timeline)
    }
    timelines.push(timeline)
    ends(time)
  }

  // Path constraint timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const index = input.readInt(true)
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte()
      const frameCount = input.readInt(true)
      switch (type) {
        case PATH_POSITION:
        case PATH_SPACING: {
          const timeline =
            type === PATH_SPACING
              ? new spine.PathConstraintSpacingTimeline(frameCount)
              : new spine.PathConstraintPositionTimeline(frameCount)
          timeline.pathConstraintIndex = index
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            timeline.setFrame(frame, (time = input.readFloat()), input.readFloat())
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
        case PATH_MIX: {
          const timeline = new spine.PathConstraintMixTimeline(frameCount)
          timeline.pathConstraintIndex = index
          let time = 0
          for (let frame = 0; frame < frameCount; frame++) {
            timeline.setFrame(
              frame,
              (time = input.readFloat()),
              input.readFloat(),
              input.readFloat(),
            )
            if (frame < frameCount - 1) readCurve(input, frame, timeline)
          }
          timelines.push(timeline)
          ends(time)
          break
        }
      }
    }
  }

  // Deform timelines.
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const skin = skeletonData.skins[input.readInt(true)]
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const slotIndex = input.readInt(true)
      for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
        const attachmentName = input.readString()
        const attachment = skin.getAttachment(slotIndex, attachmentName)
        if (!attachment) throw new Error(`Deform attachment not found: ${attachmentName}`)
        const weighted = attachment.bones !== null
        const vertices = attachment.vertices
        const deformLength = weighted ? (vertices.length / 3) * 2 : vertices.length
        const frameCount = input.readInt(true)
        const timeline = new spine.DeformTimeline(frameCount)
        timeline.slotIndex = slotIndex
        timeline.attachment = attachment
        let time = 0
        for (let frame = 0; frame < frameCount; frame++) {
          time = input.readFloat()
          let deform
          let end = input.readInt(true)
          if (end === 0) deform = weighted ? spine.Utils.newFloatArray(deformLength) : vertices
          else {
            deform = spine.Utils.newFloatArray(deformLength)
            const start = input.readInt(true)
            end += start
            for (let v = start; v < end; v++) deform[v] = input.readFloat()
            if (!weighted) for (let v = 0; v < deform.length; v++) deform[v] += vertices[v]
          }
          timeline.setFrame(frame, time, deform)
          if (frame < frameCount - 1) readCurve(input, frame, timeline)
        }
        timelines.push(timeline)
        ends(time)
      }
    }
  }

  // Draw order timeline.
  const drawOrderCount = input.readInt(true)
  if (drawOrderCount > 0) {
    const timeline = new spine.DrawOrderTimeline(drawOrderCount)
    const slotCount = skeletonData.slots.length
    let time = 0
    for (let i = 0; i < drawOrderCount; i++) {
      time = input.readFloat()
      const offsetCount = input.readInt(true)
      const drawOrder: number[] = new Array(slotCount).fill(-1)
      const unchanged: number[] = new Array(slotCount - offsetCount)
      let originalIndex = 0
      let unchangedIndex = 0
      for (let ii = 0; ii < offsetCount; ii++) {
        const slotIndex = input.readInt(true)
        // Collect unchanged items.
        while (originalIndex !== slotIndex) unchanged[unchangedIndex++] = originalIndex++
        // Set changed items.
        drawOrder[originalIndex + input.readInt(true)] = originalIndex++
      }
      // Collect remaining unchanged items.
      while (originalIndex < slotCount) unchanged[unchangedIndex++] = originalIndex++
      // Fill in unchanged items.
      for (let ii = slotCount - 1; ii >= 0; ii--)
        if (drawOrder[ii] === -1) drawOrder[ii] = unchanged[--unchangedIndex]!
      timeline.setFrame(i, time, drawOrder)
    }
    timelines.push(timeline)
    ends(time)
  }

  // Event timeline.
  const eventCount = input.readInt(true)
  if (eventCount > 0) {
    const timeline = new spine.EventTimeline(eventCount)
    let time = 0
    for (let i = 0; i < eventCount; i++) {
      time = input.readFloat()
      const eventData = skeletonData.events[input.readInt(true)]
      const event = new spine.Event(time, eventData)
      event.intValue = input.readInt(false)
      event.floatValue = input.readFloat()
      event.stringValue = input.readBoolean() ? input.readString() : eventData.stringValue
      if (eventData.audioPath !== null) {
        event.volume = input.readFloat()
        event.balance = input.readFloat()
      }
      timeline.setFrame(i, event)
    }
    timelines.push(timeline)
    ends(time)
  }

  return new spine.Animation(name, timelines, duration)
}
