// What the viewer shows when the host asks it to focus a subresource (SDK `viewer(show, { focus })`).
// The key is the analyzer's (`<collection>/<index>`, see analysis.ts); GLTFLoader's associations
// say which objects, materials and textures of the default scene each glTF element became. The
// highlight keeps what was asked for as it is and dims the rest of the model.
//
// The OBJ plugin keeps a copy of the dimming (src/focus.ts there): `shared/` cannot import three.js.
// Keep the two the same.

import type { Material, Mesh, Object3D, Texture } from 'three'
import { readKey } from './analysis.ts'
import type { Model } from './model.ts'

/** What a key stands for in the viewer. */
export interface FocusTarget {
  /** Shown to the user: "<kind> <name>". */
  label: string
  /** Meshes to frame and keep as they are while the rest is dimmed; empty for none. */
  meshes: Mesh[]
  /** A camera of the file to look through: its position in `model.cameras`. */
  camera?: number
  /** An animation to play: its position in `model.animations`. */
  animation?: number
  /** Frame the whole model and highlight nothing (the default scene). */
  whole?: boolean
}

const materialsOf = (mesh: Mesh): Material[] => [mesh.material].flat()

/** The meshes of the default scene, each once. */
function meshesIn(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh)
  })
  return meshes
}

/**
 * What the analyzer's `key` stands for in `model`, or undefined for a key this file does not have.
 * Meshes are looked up by what they show now, so a material variant chosen since is followed.
 */
export function resolveFocus(
  model: Model,
  key: string,
  container: 'gltf' | 'glb',
): FocusTarget | undefined {
  const element = readKey(model.json, key, container)
  if (!element) return undefined
  const { collection, index } = element
  const label = `${element.kind} ${element.name}`
  const association = (object: object) => model.associations.get(object)
  const meshes = meshesIn(model.root)
  switch (collection) {
    case 'nodes': {
      const found: Mesh[] = []
      model.root.traverse((object) => {
        if (association(object)?.nodes === index) found.push(...meshesIn(object))
      })
      return { label, meshes: [...new Set(found)] }
    }
    case 'meshes':
      return { label, meshes: meshes.filter((mesh) => association(mesh)?.meshes === index) }
    case 'materials':
      return {
        label,
        meshes: meshes.filter((mesh) =>
          materialsOf(mesh).some((material) => association(material)?.materials === index),
        ),
      }
    case 'textures':
      return {
        label,
        meshes: meshes.filter((mesh) =>
          materialsOf(mesh).some((material) =>
            Object.values(material).some(
              (value) =>
                (value as Texture | null)?.isTexture &&
                association(value as Texture)?.textures === index,
            ),
          ),
        ),
      }
    case 'cameras': {
      const nodes = Array.isArray(model.json.nodes) ? (model.json.nodes as unknown[]) : []
      const camera = model.cameras.findIndex(({ camera }) =>
        [camera, camera.parent].some((object) => {
          const node = object ? association(object)?.nodes : undefined
          return node !== undefined && (nodes[node] as { camera?: unknown })?.camera === index
        }),
      )
      return { label, meshes: [], camera: camera < 0 ? undefined : camera }
    }
    case 'animations':
      return { label, meshes: [], animation: index < model.animations.length ? index : undefined }
    case 'scenes':
      return {
        label,
        meshes: [],
        whole: index === (typeof model.json.scene === 'number' ? model.json.scene : 0),
      }
    default:
      // Images, buffers, skins and lights have no place of their own in the picture.
      return { label, meshes: [] }
  }
}

/** Opacity of the meshes that are not focused. */
const dimmed = 0.25

/**
 * Dims every mesh of a model except some: their materials are swapped for see-through copies, and
 * put back by `clear`. Anything that replaces materials (a variant) must clear first and apply again.
 */
export class Highlight {
  private readonly swapped = new Map<Mesh, Material | Material[]>()
  private readonly copies: Material[] = []

  get active(): boolean {
    return this.swapped.size > 0
  }

  apply(root: Object3D, kept: Iterable<Mesh>): void {
    this.clear()
    const keep = new Set(kept)
    if (!keep.size) return
    for (const mesh of meshesIn(root)) {
      if (keep.has(mesh)) continue
      this.swapped.set(mesh, mesh.material)
      const copy = (material: Material) => {
        const faded = material.clone()
        faded.transparent = true
        faded.opacity = material.opacity * dimmed
        faded.depthWrite = false
        this.copies.push(faded)
        return faded
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material)
    }
  }

  clear(): void {
    for (const [mesh, material] of this.swapped) mesh.material = material
    this.swapped.clear()
    for (const copy of this.copies.splice(0)) copy.dispose()
  }
}
