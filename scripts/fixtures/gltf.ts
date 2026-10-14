// Generates the glTF test fixtures in fixtures/gltf/; run through scripts/make-fixtures.ts.
// Everything is authored here (geometry, colours, PNG encoding), so the fixtures contain no
// third-party content. glTF-Transform writes the files and applies Draco and meshopt compression
// with the encoders from draco3dgltf and meshoptimizer.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Document, NodeIO, TextureInfo, type Material } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions'
import { draco, meshopt } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptEncoder } from 'meshoptimizer'
import { png, type Rgba } from './png.ts'

const output = join(import.meta.dirname, '..', '..', 'fixtures', 'gltf')
const generator = 'Vormio-Plugins scripts/make-fixtures.ts (glTF-Transform 4.5.1)'

// Saturated colours the render tests look for.
const red: Rgba = [220, 38, 38, 255]
const green: Rgba = [22, 163, 74, 255]
const blue: Rgba = [37, 99, 235, 255]
const yellow: Rgba = [234, 179, 8, 255]

/** Four quadrants: red and green on top, blue and yellow below. */
const quadrants = png(64, 64, (x, y) => (y < 32 ? (x < 32 ? red : green) : x < 32 ? blue : yellow))

/** Planks in two browns inside a dark frame. */
const crateColor = png(64, 64, (x, y) => {
  if (x < 6 || y < 6 || x >= 58 || y >= 58) return [92, 58, 30, 255]
  return Math.floor((y - 6) / 13) % 2 ? [150, 92, 44, 255] : [196, 128, 64, 255]
})

/** Eight vertical stripes, so turning the globe visibly changes the picture. */
const stripeColors: Rgba[] = [
  red,
  [234, 88, 12, 255],
  yellow,
  green,
  [13, 148, 136, 255],
  blue,
  [124, 58, 237, 255],
  [219, 39, 119, 255],
]
const stripes = png(128, 64, (x) => stripeColors[Math.floor(x / 16)]!)

interface Geometry {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

/** A box centred on the origin; every face shows the whole texture upright. */
function box(width: number, height: number, depth: number): Geometry {
  const half = [width / 2, height / 2, depth / 2]
  // Outward normal, then the face's right and up axes (right × up = normal, counter-clockwise).
  const faces = [
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
  ]
  const geometry: Geometry = { positions: [], normals: [], uvs: [], indices: [] }
  for (const [normal, right, up] of faces) {
    const base = geometry.positions.length / 3
    for (const [sr, su, u, v] of [
      [-1, -1, 0, 1],
      [1, -1, 1, 1],
      [1, 1, 1, 0],
      [-1, 1, 0, 0],
    ] as const) {
      for (let axis = 0; axis < 3; axis++)
        geometry.positions.push(
          (normal![axis]! + sr * right![axis]! + su * up![axis]!) * half[axis]!,
        )
      geometry.normals.push(...normal!)
      geometry.uvs.push(u, v)
    }
    geometry.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return geometry
}

/** A UV sphere with the texture wrapped once around it (the same layout as three's SphereGeometry). */
function sphere(radius: number, segments: number, rings: number): Geometry {
  const geometry: Geometry = { positions: [], normals: [], uvs: [], indices: [] }
  for (let ring = 0; ring <= rings; ring++)
    for (let segment = 0; segment <= segments; segment++) {
      const u = segment / segments
      const v = ring / rings
      const normal = [
        -Math.cos(u * 2 * Math.PI) * Math.sin(v * Math.PI),
        Math.cos(v * Math.PI),
        Math.sin(u * 2 * Math.PI) * Math.sin(v * Math.PI),
      ]
      geometry.positions.push(...normal.map((value) => value * radius))
      geometry.normals.push(...normal)
      geometry.uvs.push(u, v)
    }
  const at = (ring: number, segment: number) => ring * (segments + 1) + segment
  for (let ring = 0; ring < rings; ring++)
    for (let segment = 0; segment < segments; segment++) {
      const a = at(ring, segment + 1)
      const b = at(ring, segment)
      const c = at(ring + 1, segment)
      const d = at(ring + 1, segment + 1)
      if (ring !== 0) geometry.indices.push(a, b, d)
      if (ring !== rings - 1) geometry.indices.push(b, c, d)
    }
  return geometry
}

interface ModelOptions {
  name: string
  geometry: Geometry
  bufferUri?: string
  texture?: { image: Uint8Array; uri: string; nearest?: boolean }
}

function model({ name, geometry, bufferUri, texture }: ModelOptions): Document {
  const document = new Document()
  document.getRoot().getAsset().generator = generator
  const buffer = document.createBuffer(name)
  if (bufferUri) buffer.setURI(bufferUri)
  const accessor = (
    type: 'VEC2' | 'VEC3' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const material = document
    .createMaterial(name)
    .setBaseColorFactor(texture ? [1, 1, 1, 1] : [0.8, 0.8, 0.8, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.7)
  if (texture) {
    material.setBaseColorTexture(
      document
        .createTexture(name)
        .setImage(texture.image)
        .setMimeType('image/png')
        .setURI(texture.uri),
    )
    if (texture.nearest)
      material.getBaseColorTextureInfo()!.setMagFilter(TextureInfo.MagFilter.NEAREST!)
  }
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(geometry.positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(geometry.normals)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(geometry.uvs)))
    .setIndices(accessor('SCALAR', new Uint16Array(geometry.indices)))
    .setMaterial(material)
  const node = document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive))
  document.getRoot().setDefaultScene(document.createScene(name).addChild(node))
  return document
}

/** Wood grain in two browns, shared by the furniture models. */
const wood = png(64, 64, (x, y) =>
  Math.floor((x + (Math.floor(y / 16) % 2) * 4) / 8) % 2
    ? [158, 104, 58, 255]
    : [190, 132, 78, 255],
)

interface FurnitureOptions {
  name: string
  bufferUri: string
  /** Shapes, each made once and used by any number of parts. */
  meshes: Record<string, { geometry: Geometry; material: 'Wood' | 'Metal' }>
  parts: { name: string; mesh: string; at: [number, number, number] }[]
}

/**
 * A piece of furniture: a root node whose children are its parts. Parts share meshes, and the wood
 * material uses the texture `textures/wood.png` that several models refer to.
 */
function furniture({ name, bufferUri, meshes, parts }: FurnitureOptions): Document {
  const document = new Document()
  document.getRoot().getAsset().generator = generator
  const buffer = document.createBuffer(name).setURI(bufferUri)
  const accessor = (
    type: 'VEC2' | 'VEC3' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const materials = {
    Wood: document
      .createMaterial('Wood')
      .setMetallicFactor(0)
      .setRoughnessFactor(0.8)
      .setBaseColorTexture(
        document
          .createTexture('Wood')
          .setImage(wood)
          .setMimeType('image/png')
          .setURI('textures/wood.png'),
      ),
    Metal: document
      .createMaterial('Metal')
      .setBaseColorFactor([0.62, 0.63, 0.66, 1])
      .setMetallicFactor(0.9)
      .setRoughnessFactor(0.35),
  }
  const shapes = Object.fromEntries(
    Object.entries(meshes).map(([meshName, { geometry, material }]) => [
      meshName,
      document.createMesh(meshName).addPrimitive(
        document
          .createPrimitive()
          .setAttribute('POSITION', accessor('VEC3', new Float32Array(geometry.positions)))
          .setAttribute('NORMAL', accessor('VEC3', new Float32Array(geometry.normals)))
          .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(geometry.uvs)))
          .setIndices(accessor('SCALAR', new Uint16Array(geometry.indices)))
          .setMaterial(materials[material]),
      ),
    ]),
  )
  const root = document.createNode(name)
  for (const part of parts)
    root.addChild(
      document.createNode(part.name).setMesh(shapes[part.mesh]!).setTranslation(part.at),
    )
  document.getRoot().setDefaultScene(document.createScene(name).addChild(root))
  return document
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'meshopt.encoder': MeshoptEncoder,
})
await MeshoptEncoder.ready

async function write(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(join(output, path)), { recursive: true })
  await writeFile(join(output, path), data)
}

type Json = Record<string, unknown> & { buffers?: { uri?: string }[] }

/**
 * Writes a .gltf and the files it refers to, each at the path its (percent-encoded) URI names.
 * `edit` may change the JSON first; resources it lists in `omit` are left out on purpose.
 */
async function writeGltf(
  path: string,
  document: Document,
  options: { edit?: (json: Json) => void; omit?: string[]; inlineBuffer?: boolean } = {},
): Promise<void> {
  const { json, resources } = await io.writeJSON(document)
  const editable = json as unknown as Json
  const omit = new Set(options.omit)
  if (options.inlineBuffer) {
    const buffer = editable.buffers![0]!
    omit.add(buffer.uri!)
    buffer.uri = `data:application/octet-stream;base64,${Buffer.from(resources[buffer.uri!]!).toString('base64')}`
  }
  options.edit?.(editable)
  await write(path, `${JSON.stringify(json, null, 2)}\n`)
  for (const [uri, data] of Object.entries(resources)) {
    if (omit.has(uri)) continue
    await write(join(dirname(path), decodeURIComponent(uri)), data)
  }
}

// Start from an empty folder, keeping only the hand-written README.
await mkdir(output, { recursive: true })
for (const name of await readdir(output))
  if (name !== 'README.md') await rm(join(output, name), { recursive: true, force: true })

// External buffer and texture in a subfolder.
await writeGltf(
  'cube/cube.gltf',
  model({
    name: 'cube',
    geometry: box(1, 1, 1),
    bufferUri: 'cube.bin',
    texture: { image: quadrants, uri: 'textures/quadrants.png', nearest: true },
  }),
)

// Companions in sibling folders (../) and a file name that needs percent-encoding.
await writeGltf(
  'crate/scene/crate.gltf',
  model({
    name: 'crate',
    geometry: box(1.6, 1, 1),
    bufferUri: '../buffers/crate.bin',
    texture: { image: crateColor, uri: '../textures/crate%20color.png', nearest: true },
  }),
)

const globe = () =>
  model({
    name: 'globe',
    geometry: sphere(0.5, 48, 24),
    texture: { image: stripes, uri: 'stripes.png' },
  })

// GLB with the texture embedded, then the same model with compressed geometry.
await write('globe.glb', await io.writeBinary(globe()))
const dracoGlobe = globe()
await dracoGlobe.transform(draco({ method: 'edgebreaker' }))
await write('globe-draco.glb', await io.writeBinary(dracoGlobe))
const meshoptGlobe = globe()
await meshoptGlobe.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
await write('globe-meshopt.glb', await io.writeBinary(meshoptGlobe))

// Two models that share one texture, with node hierarchies and meshes used by several nodes.
/** Four parts using the mesh "Leg", `x` and `z` from the centre, their middle at height `y`. */
const legs = (x: number, z: number, y: number) =>
  (
    [
      ['front left', -x, z],
      ['front right', x, z],
      ['back left', -x, -z],
      ['back right', x, -z],
    ] as const
  ).map(([side, legX, legZ]) => ({
    name: `Leg ${side}`,
    mesh: 'Leg',
    at: [legX, y, legZ] as [number, number, number],
  }))
await writeGltf(
  'props/table.gltf',
  furniture({
    name: 'Table',
    bufferUri: 'table.bin',
    meshes: {
      Top: { geometry: box(1.2, 0.06, 0.7), material: 'Wood' },
      Leg: { geometry: box(0.06, 0.7, 0.06), material: 'Metal' },
    },
    parts: [{ name: 'Top', mesh: 'Top', at: [0, 0.73, 0] }, ...legs(0.54, 0.29, 0.35)],
  }),
)
await writeGltf(
  'props/stool.gltf',
  furniture({
    name: 'Stool',
    bufferUri: 'stool.bin',
    meshes: {
      Seat: { geometry: box(0.4, 0.05, 0.4), material: 'Wood' },
      Leg: { geometry: box(0.04, 0.45, 0.04), material: 'Wood' },
    },
    parts: [{ name: 'Seat', mesh: 'Seat', at: [0, 0.475, 0] }, ...legs(0.16, 0.16, 0.225)],
  }),
)

// An animated model: a skinned arm (red) bending at its elbow joint, a block (green) whose morph
// target stretches it upwards, and a cube (blue) that spins and bobs. The first clip, "Wave", bends
// the arm and stretches the block; the second has no name and moves the cube.
function animated(): Document {
  const document = new Document()
  document.getRoot().getAsset().generator = generator
  const buffer = document.createBuffer('robot')
  const accessor = (
    type: 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const material = (name: string, [r, g, b]: Rgba) =>
    document
      .createMaterial(name)
      .setBaseColorFactor([r / 255, g / 255, b / 255, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.6)
  const primitive = (geometry: Geometry, color: Material) =>
    document
      .createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(geometry.positions)))
      .setAttribute('NORMAL', accessor('VEC3', new Float32Array(geometry.normals)))
      .setIndices(accessor('SCALAR', new Uint16Array(geometry.indices)))
      .setMaterial(color)

  // The arm: two stacked boxes 0.6 high at x = -0.8, the lower bound to the shoulder joint, the
  // upper to the elbow joint at height 0.6. A skinned mesh is placed by its joints, not its node.
  const lower = box(0.2, 0.6, 0.2)
  const upper = box(0.2, 0.6, 0.2)
  const arm: Geometry = { positions: [], normals: [], uvs: [], indices: [] }
  const joints: number[] = []
  const weights: number[] = []
  for (const [part, lift, joint] of [
    [lower, 0.3, 0],
    [upper, 0.9, 1],
  ] as const) {
    const base = arm.positions.length / 3
    part.positions.forEach((value, index) =>
      arm.positions.push(index % 3 === 0 ? value - 0.8 : index % 3 === 1 ? value + lift : value),
    )
    arm.normals.push(...part.normals)
    arm.indices.push(...part.indices.map((index) => index + base))
    for (let vertex = 0; vertex < part.positions.length / 3; vertex++) {
      joints.push(joint, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
  }
  const shoulder = document.createNode('Shoulder').setTranslation([-0.8, 0, 0])
  const elbow = document.createNode('Elbow').setTranslation([0, 0.6, 0])
  shoulder.addChild(elbow)
  // Inverse bind matrices: the joints sit at heights 0 and 0.6 of the arm's own space.
  const inverseBind = new Float32Array([
    ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.8, 0, 0, 1],
    ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.8, -0.6, 0, 1],
  ])
  const skin = document
    .createSkin('Arm')
    .addJoint(shoulder)
    .addJoint(elbow)
    .setSkeleton(shoulder)
    .setInverseBindMatrices(accessor('MAT4', inverseBind))
  const armMesh = document.createMesh('Arm').addPrimitive(
    primitive(arm, material('Red', red))
      .setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(joints)))
      .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(weights))),
  )
  const armNode = document.createNode('Arm').setMesh(armMesh).setSkin(skin)

  // The block: its morph target moves the top four vertices of each side up by 0.6.
  const block = box(0.4, 0.4, 0.4)
  const stretch = block.positions.map((value, index) =>
    index % 3 === 1 && block.positions[index]! > 0 ? 0.6 : 0,
  )
  const blockPrimitive = primitive(block, material('Green', green)).addTarget(
    document
      .createPrimitiveTarget('Stretch')
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(stretch))),
  )
  const blockNode = document
    .createNode('Block')
    .setMesh(document.createMesh('Block').addPrimitive(blockPrimitive).setWeights([0]))
    .setTranslation([0, 0.2, 0])

  const cube = document
    .createNode('Cube')
    .setMesh(
      document
        .createMesh('Cube')
        .addPrimitive(primitive(box(0.3, 0.3, 0.3), material('Blue', blue))),
    )
    .setTranslation([0.8, 0.3, 0])

  const sampler = (times: number[], values: number[], type: 'SCALAR' | 'VEC3' | 'VEC4') =>
    document
      .createAnimationSampler()
      .setInput(accessor('SCALAR', new Float32Array(times)))
      .setOutput(accessor(type, new Float32Array(values)))
      .setInterpolation('LINEAR')
  const animation = (
    name: string,
    channels: [
      node: ReturnType<Document['createNode']>,
      path: 'rotation' | 'translation' | 'weights',
      ReturnType<typeof sampler>,
    ][],
  ) => {
    const clip = document.createAnimation(name)
    for (const [node, path, each] of channels)
      clip
        .addSampler(each)
        .addChannel(
          document
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath(path)
            .setSampler(each),
        )
    return clip
  }
  // Quaternions about Z: 0°, 90°, 0°; about Y: 0°, 180°, 360°.
  const s = Math.SQRT1_2
  animation('Wave', [
    [elbow, 'rotation', sampler([0, 1, 2], [0, 0, 0, 1, 0, 0, s, s, 0, 0, 0, 1], 'VEC4')],
    [blockNode, 'weights', sampler([0, 1, 2], [0, 1, 0], 'SCALAR')],
  ])
  animation('', [
    [cube, 'rotation', sampler([0, 0.5, 1], [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1], 'VEC4')],
    [cube, 'translation', sampler([0, 0.5, 1], [0.8, 0.3, 0, 0.8, 0.8, 0, 0.8, 0.3, 0], 'VEC3')],
  ])

  document
    .getRoot()
    .setDefaultScene(
      document
        .createScene('Robot')
        .addChild(shoulder)
        .addChild(armNode)
        .addChild(blockNode)
        .addChild(cube),
    )
  return document
}
await write('animated/robot.glb', await io.writeBinary(animated()))

// Material variants and cameras: a grey cube whose material the variants "Red" and "Blue" replace,
// a small yellow cube beside it, an orthographic camera "Top" looking down and a perspective camera
// "Side" looking along -X.
function showroom(): Document {
  const document = new Document()
  document.getRoot().getAsset().generator = generator
  const buffer = document.createBuffer('showroom')
  const accessor = (
    type: 'SCALAR' | 'VEC3',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const material = (name: string, [r, g, b]: Rgba) =>
    document
      .createMaterial(name)
      .setBaseColorFactor([r / 255, g / 255, b / 255, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.6)
  const primitive = (geometry: Geometry, color: Material) =>
    document
      .createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(geometry.positions)))
      .setAttribute('NORMAL', accessor('VEC3', new Float32Array(geometry.normals)))
      .setIndices(accessor('SCALAR', new Uint16Array(geometry.indices)))
      .setMaterial(color)

  const variants = document.createExtension(KHRMaterialsVariants)
  const mapping = (name: string, color: Rgba) =>
    variants
      .createMapping()
      .addVariant(variants.createVariant(name))
      .setMaterial(material(name, color))
  const body = primitive(box(1, 1, 1), material('Grey', [160, 160, 160, 255])).setExtension(
    'KHR_materials_variants',
    variants.createMappingList().addMapping(mapping('Red', red)).addMapping(mapping('Blue', blue)),
  )
  const cube = document.createNode('Cube').setMesh(document.createMesh('Cube').addPrimitive(body))
  const marker = document
    .createNode('Marker')
    .setMesh(
      document
        .createMesh('Marker')
        .addPrimitive(primitive(box(0.3, 0.3, 0.3), material('Yellow', yellow))),
    )
    .setTranslation([0.9, 0, 0])
  const s = Math.SQRT1_2
  const top = document
    .createNode('Top')
    .setCamera(
      document
        .createCamera('Top')
        .setType('orthographic')
        .setXMag(1.5)
        .setYMag(1.5)
        .setZNear(0.1)
        .setZFar(10),
    )
    .setTranslation([0, 5, 0])
    .setRotation([-s, 0, 0, s])
  const side = document
    .createNode('Side')
    .setCamera(
      document
        .createCamera('Side')
        .setType('perspective')
        .setYFov(0.8)
        .setAspectRatio(1.5)
        .setZNear(0.1)
        .setZFar(100),
    )
    .setTranslation([4, 0, 0])
    .setRotation([0, s, 0, s])
  document
    .getRoot()
    .setDefaultScene(
      document.createScene('Showroom').addChild(cube).addChild(marker).addChild(top).addChild(side),
    )
  return document
}
await write('variants/showroom.glb', await io.writeBinary(showroom()))

// Files the plugin has to refuse or show with a warning.
await writeGltf(
  'problems/missing-texture.gltf',
  model({
    name: 'missing-texture',
    geometry: box(1, 1, 1),
    bufferUri: 'missing-texture.bin',
    texture: { image: quadrants, uri: 'textures/absent.png' },
  }),
  { inlineBuffer: true, omit: ['textures/absent.png'] },
)
await writeGltf(
  'problems/missing-buffer.gltf',
  model({ name: 'missing-buffer', geometry: box(1, 1, 1), bufferUri: 'absent.bin' }),
  { omit: ['absent.bin'] },
)
await writeGltf(
  'problems/unsupported-extension.gltf',
  model({ name: 'unsupported-extension', geometry: box(1, 1, 1), bufferUri: 'unused.bin' }),
  {
    inlineBuffer: true,
    edit(json) {
      json.extensionsUsed = ['VORMIO_unsupported_fixture']
      json.extensionsRequired = ['VORMIO_unsupported_fixture']
    },
  },
)
await write('problems/truncated.glb', (await io.writeBinary(globe())).subarray(0, 2048))
await write(
  'problems/gltf-1.gltf',
  `${JSON.stringify({ asset: { version: '1.0' }, scene: 'default', scenes: { default: { nodes: [] } } }, null, 2)}\n`,
)

console.log(`fixtures written to ${output}`)
