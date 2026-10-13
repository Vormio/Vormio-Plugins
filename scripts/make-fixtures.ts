// Generates the glTF test fixtures in fixtures/gltf/. Everything is authored here (geometry, colours,
// PNG encoding), so the fixtures contain no third-party content. glTF-Transform writes the files and
// applies Draco and meshopt compression with the encoders from draco3dgltf and meshoptimizer.
//
//   node scripts/make-fixtures.ts

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { Document, NodeIO, TextureInfo } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco, meshopt } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptEncoder } from 'meshoptimizer'

const output = join(import.meta.dirname, '..', 'fixtures', 'gltf')
const generator = 'Vormio-Plugins scripts/make-fixtures.ts (glTF-Transform 4.5.1)'

type Rgba = readonly [number, number, number, number]

/** An 8-bit RGBA PNG, unfiltered, with one deflated IDAT chunk. */
function png(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4)
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, deflate, no filter set, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

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
