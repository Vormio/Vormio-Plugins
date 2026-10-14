import type { PluginInput } from '@vormio/plugin-sdk'
import {
  Box3,
  FileLoader,
  LoaderUtils,
  LoadingManager,
  Texture,
  Vector3,
  type Material,
  type Mesh,
  type MeshPhongMaterial,
  type Object3D,
} from 'three'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { ModelError } from './errors.ts'
import { mtlForLoader } from './mtl-file.ts'
import { fileName } from './names.ts'
import { summarizeObj } from './obj-file.ts'
import { readObjText } from './source.ts'

/** A loaded OBJ and what it holds; `dispose` frees its GPU resources. */
export interface Model {
  root: Object3D
  box: Box3
  /** World positions of every vertex (x, y, z), for framing; absent for very large models. */
  points?: Float32Array
  triangles: number
  /** Distinct materials the meshes use. */
  materials: number
  /** Addresses of material libraries and textures that could not be loaded. */
  failed: string[]
  /** Materials the file uses that no material library defines; shown grey. */
  missingMaterials: string[]
  dispose(): void
}

/** The colour of a part without a material of its own, as in the other viewers of 3D files. */
const grey = 0xb4b4b4

/**
 * A loading manager that knows when everything it started has finished, and what failed. MTLLoader
 * hands out textures at once and loads their images afterwards; a picture is drawn only after that.
 */
function trackedManager() {
  const manager = new LoadingManager()
  const failed = new Set<string>()
  let pending = 0
  const waiting: (() => void)[] = []
  const start = manager.itemStart.bind(manager)
  const end = manager.itemEnd.bind(manager)
  const error = manager.itemError.bind(manager)
  manager.itemStart = (url) => {
    pending++
    start(url)
  }
  manager.itemError = (url) => {
    failed.add(url)
    error(url)
  }
  manager.itemEnd = (url) => {
    end(url)
    if (--pending === 0) for (const wake of waiting.splice(0)) wake()
  }
  manager.addHandler(/\.tga$/i, new TGALoader(manager))
  const idle = () =>
    pending === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))
  return { manager, failed, idle }
}

/**
 * Loads OBJ files with their material libraries. The libraries are read first, each relative to
 * the model, and their texture statements are rewritten for MTLLoader (see mtl-file.ts); textures
 * load relative to their library. A material defined in more than one library comes from the last
 * one the file names.
 */
export async function loadModel(input: PluginInput, signal?: AbortSignal): Promise<Model> {
  const text = await readObjText(input)
  const summary = summarizeObj(text)
  if (!summary.elements) throw new ModelError('这个文件中没有可以显示的面、线或点。')
  signal?.throwIfAborted()

  const { manager, failed, idle } = trackedManager()
  const creators: MTLLoader.MaterialCreator[] = []
  for (const name of summary.libraries) {
    const url = new URL(fileName(name), input.url).href
    const library = await new FileLoader(manager).loadAsync(url).catch(() => undefined)
    if (typeof library !== 'string') continue
    creators.push(
      new MTLLoader(manager).parse(mtlForLoader(library), LoaderUtils.extractUrlBase(url)),
    )
  }
  signal?.throwIfAborted()

  const defined = new Set<Material>()
  const missing = new Set<string>()
  const materials = {
    create(name: string) {
      const creator = creators.findLast((each) => name in each.materialsInfo)
      if (!creator) {
        missing.add(name)
        return undefined
      }
      const material = creator.create(name)
      defined.add(material)
      return material
    },
  }
  const loader = new OBJLoader(manager).setMaterials(
    materials as unknown as MTLLoader.MaterialCreator,
  )
  let root: Object3D
  try {
    root = loader.parse(text)
  } catch (error) {
    throw new ModelError(`模型无法加载：${error instanceof Error ? error.message : String(error)}`)
  }
  await idle()

  const used = new Set<Material>()
  root.traverse((object) => {
    const mesh = object as Mesh
    for (const material of [mesh.material ?? []].flat()) {
      used.add(material)
      // Parts without a material from a library are grey, unless their vertices carry colours.
      if (!defined.has(material) && !material.vertexColors)
        (material as MeshPhongMaterial).color?.setHex(grey)
      // A texture whose image could not be loaded would draw black; the colour stays instead.
      for (const [key, value] of Object.entries(material))
        if (value instanceof Texture && !hasImage(value)) {
          value.dispose()
          ;(material as unknown as Record<string, unknown>)[key] = null
          material.needsUpdate = true
        }
    }
  })
  const dispose = () => disposeObject(root)
  const { box, points } = measure(root)
  if (box.isEmpty()) {
    dispose()
    throw new ModelError('这个文件中没有可以显示的面、线或点。')
  }
  return {
    root,
    box,
    points,
    triangles: countTriangles(root),
    materials: used.size,
    failed: [...failed],
    missingMaterials: [...missing].filter((name) => name),
    dispose,
  }
}

/** Whether a texture got its image; a TGA that failed keeps an empty data image. */
function hasImage(texture: Texture): boolean {
  const image = texture.image as { data?: unknown } | null | undefined
  return !!image && (!('data' in image) || !!image.data)
}

interface Renderable {
  isMesh?: boolean
  isPoints?: boolean
  isLine?: boolean
  geometry?: {
    attributes: { position?: { count: number } }
    dispose(): void
  }
  material?: Material | Material[]
}

/** Beyond this many vertices, framing uses the bounding box instead. */
const maxFramingVertices = 1_000_000

/** The bounds and vertex positions of `root`, as the framing needs them. */
export function measure(root: Object3D): { box: Box3; points?: Float32Array } {
  root.updateMatrixWorld(true)
  const items: Object3D[] = []
  let total = 0
  root.traverse((object) => {
    const item = object as Renderable
    const count = item.geometry?.attributes.position?.count ?? 0
    if (!(item.isMesh || item.isPoints || item.isLine) || count === 0) return
    items.push(object)
    total += count
  })
  const box = new Box3().setFromObject(root)
  if (total > maxFramingVertices) return { box }
  const points = new Float32Array(total * 3)
  const vertex = new Vector3()
  let offset = 0
  for (const object of items) {
    const position = (object as Mesh).geometry.getAttribute('position')
    for (let index = 0; index < position.count; index++) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld)
      points[offset++] = vertex.x
      points[offset++] = vertex.y
      points[offset++] = vertex.z
    }
  }
  return { box, points }
}

/** Triangles of the faces; OBJLoader splits polygons into triangles and indexes nothing. */
export function countTriangles(root: Object3D): number {
  let triangles = 0
  root.traverse((object) => {
    const mesh = object as Renderable
    if (mesh.isMesh) triangles += Math.floor((mesh.geometry?.attributes.position?.count ?? 0) / 3)
  })
  return triangles
}

/** Frees the geometry, materials and textures under `root`. */
export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const item = object as Renderable
    item.geometry?.dispose()
    for (const material of [item.material ?? []].flat()) {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose()
      material.dispose()
    }
  })
}
