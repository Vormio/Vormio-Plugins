import type { PluginInput } from '@vormio/plugin-sdk'
import {
  Box3,
  type AnimationClip,
  LoaderUtils,
  LoadingManager,
  Matrix4,
  Texture,
  Vector3,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { ModelError } from './errors.ts'
import { animationNames, readGltf, unsupportedRequiredExtensions } from './gltf-file.ts'
import { readMainFile } from './source.ts'

/** A loaded default scene and what it holds; `dispose` frees its GPU resources and images. */
export interface Model {
  root: Object3D
  box: Box3
  /** World positions of every vertex (x, y, z), for framing; absent for very large models. */
  points?: Float32Array
  triangles: number
  /** The file's animations in file order, with the names the viewer shows. */
  animations: { name: string; clip: AnimationClip }[]
  /** Addresses of files and embedded images that could not be loaded. */
  failed: string[]
  dispose(): void
}

/**
 * Loads glTF and GLB files for one page. GLTFLoader reads companion files itself, relative to
 * `input.url`, so buffers and textures come through the host's companion reads exactly as the
 * file names them. Draco and Basis decoders run in Workers built from files in the package.
 */
export class ModelLoader {
  private readonly draco: DRACOLoader
  private readonly ktx2: KTX2Loader
  /** Collects KTX2 read failures for the most recent load (the KTX2 loader is shared). */
  private ktx2Failures: Set<string> | undefined

  constructor(renderer: WebGLRenderer) {
    const decoders = new URL('decoders/', location.href)
    this.draco = new DRACOLoader()
      .setDecoderPath(new URL('draco/', decoders).href)
      .setDecoderConfig({ type: 'wasm' })
      .setWorkerLimit(2)
    const ktx2Manager = new LoadingManager()
    ktx2Manager.onError = (url) => this.ktx2Failures?.add(url)
    this.ktx2 = new KTX2Loader(ktx2Manager)
      .setTranscoderPath(new URL('basis/', decoders).href)
      .setWorkerLimit(2)
      .detectSupport(renderer)
  }

  async load(input: PluginInput, signal?: AbortSignal): Promise<Model> {
    const bytes = await readMainFile(input)
    const { json } = readGltf(bytes)
    const names = animationNames(json)
    const unsupported = unsupportedRequiredExtensions(json)
    if (unsupported.length)
      throw new ModelError(`这个文件需要不支持的 glTF 扩展：${unsupported.join('、')}。`)
    signal?.throwIfAborted()

    const failed = new Set<string>()
    this.ktx2Failures = failed
    const manager = new LoadingManager()
    manager.onError = (url) => failed.add(url)
    const abort = () => manager.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const loader = new GLTFLoader(manager)
      .setDRACOLoader(this.draco)
      .setKTX2Loader(this.ktx2)
      .setMeshoptDecoder(MeshoptDecoder)

    let gltf: GLTF
    try {
      gltf = await loader.parseAsync(bytes, LoaderUtils.extractUrlBase(input.url))
    } catch (error) {
      signal?.throwIfAborted()
      throw new ModelError(
        `模型无法加载：${error instanceof Error ? error.message : String(error)}`,
        [...failed],
      )
    } finally {
      signal?.removeEventListener('abort', abort)
    }

    const root = gltf.scene ?? gltf.scenes[0]
    const dispose = () => {
      for (const scene of gltf.scenes) disposeObject(scene)
    }
    if (!root) {
      dispose()
      throw new ModelError('这个文件中没有场景。')
    }
    const { box, points } = measure(root)
    if (box.isEmpty()) {
      dispose()
      throw new ModelError('这个文件的默认场景中没有可以显示的几何体。')
    }
    return {
      root,
      box,
      points,
      triangles: countTriangles(root),
      animations: gltf.animations.map((clip, index) => ({ name: names[index] ?? clip.name, clip })),
      failed: [...failed],
      dispose,
    }
  }

  dispose(): void {
    this.draco.dispose()
    this.ktx2.dispose()
  }
}

interface Renderable {
  isMesh?: boolean
  isPoints?: boolean
  isLine?: boolean
  isInstancedMesh?: boolean
  isSkinnedMesh?: boolean
  count?: number
  geometry?: {
    index: { count: number } | null
    attributes: { position?: { count: number } }
    dispose(): void
  }
  material?: Material | Material[]
  skeleton?: { dispose(): void }
  dispose?: () => void
}

/**
 * The bounds and vertex positions of `root` in its current pose: the rest pose after loading, or the
 * pose an animation has put it in. Skinning and morph targets are applied to the vertices.
 */
export function measure(root: Object3D): { box: Box3; points?: Float32Array } {
  root.updateMatrixWorld(true)
  // A skinned mesh keeps the bounds of the pose it was last measured in.
  root.traverse((object) => {
    const mesh = object as Renderable & { computeBoundingBox?: () => void }
    if (mesh.isSkinnedMesh) mesh.computeBoundingBox?.()
  })
  return { box: new Box3().setFromObject(root), points: worldPositions(root) }
}

/** Beyond this many vertices (instances included), framing uses the bounding box instead. */
const maxFramingVertices = 1_000_000

/** World positions of every vertex in its rest pose, or undefined for very large models. */
export function worldPositions(root: Object3D): Float32Array | undefined {
  const items: { object: Object3D; count: number; instances: number }[] = []
  let total = 0
  root.traverse((object) => {
    const item = object as Renderable
    const count = item.geometry?.attributes.position?.count ?? 0
    if (!(item.isMesh || item.isPoints || item.isLine) || count === 0) return
    const instances = item.isInstancedMesh ? (item.count ?? 1) : 1
    items.push({ object, count, instances })
    total += count * instances
  })
  if (total > maxFramingVertices) return undefined
  const points = new Float32Array(total * 3)
  const vertex = new Vector3()
  const instance = new Matrix4()
  const matrix = new Matrix4()
  let offset = 0
  for (const { object, count, instances } of items) {
    const mesh = object as Mesh
    const position = mesh.geometry.getAttribute('position')
    for (let copy = 0; copy < instances; copy++) {
      if ((object as InstancedMesh).isInstancedMesh)
        matrix.multiplyMatrices(
          object.matrixWorld,
          (object as InstancedMesh).getMatrixAt(copy, instance),
        )
      else matrix.copy(object.matrixWorld)
      for (let index = 0; index < count; index++) {
        // Meshes apply morph targets and skinning; points and lines use the raw positions.
        if (mesh.isMesh) mesh.getVertexPosition(index, vertex)
        else vertex.fromBufferAttribute(position, index)
        vertex.applyMatrix4(matrix)
        points[offset++] = vertex.x
        points[offset++] = vertex.y
        points[offset++] = vertex.z
      }
    }
  }
  return points
}

/** Triangles as the file defines them; an instanced mesh counts once per instance. */
export function countTriangles(root: Object3D): number {
  let triangles = 0
  root.traverse((object) => {
    const mesh = object as Renderable
    if (!mesh.isMesh || !mesh.geometry) return
    const vertices = mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0
    triangles += Math.floor(vertices / 3) * (mesh.isInstancedMesh ? (mesh.count ?? 1) : 1)
  })
  return triangles
}

/** Frees the geometry, materials, textures and decoded images under `root`. */
export function disposeObject(root: Object3D): void {
  const bitmaps = new Set<ImageBitmap>()
  root.traverse((object) => {
    const item = object as Renderable
    item.geometry?.dispose()
    const materials = Array.isArray(item.material)
      ? item.material
      : item.material
        ? [item.material]
        : []
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof Texture) {
          if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap)
            bitmaps.add(value.image)
          value.dispose()
        }
      material.dispose()
    }
    if (item.isSkinnedMesh) item.skeleton?.dispose()
    if (item.isInstancedMesh) item.dispose?.()
  })
  for (const bitmap of bitmaps) bitmap.close()
}
