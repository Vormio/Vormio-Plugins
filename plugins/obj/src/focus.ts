// What the viewer shows when the host asks it to focus a subresource (SDK `viewer(show, { focus })`):
// an object, a group or a material of the OBJ report (`objects/<n>`, `groups/<n>`, `materials/<n>`,
// see obj-file.ts). OBJLoader groups faces by its own rules, which need not match the report's, so
// the faces are found by reading the file again with the analyzer itself and drawn over the model in
// the highlight colour, while the model is dimmed.
//
// `Highlight` is a copy of the glTF plugin's (src/focus.ts there), which also dims lines and points:
// `shared/` cannot import three.js. Keep the two the same otherwise.

import type { PluginInput } from '@vormio/plugin-sdk'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three'
import { libraryNames, ObjAnalysis, StatementReader } from './obj-file.ts'
import { readObjText } from './source.ts'

/** The colour of focused faces: amber, visible on light and dark backgrounds. */
const accent = 0xf59e0b

/**
 * The faces of the subresource `key` as a mesh in the highlight colour, with the label to show
 * ("<kind> <name>"); no mesh when it has no faces. Undefined for a key the file's report lacks.
 */
export async function focusMesh(
  input: PluginInput,
  key: string,
): Promise<{ label: string; mesh?: Mesh } | undefined> {
  const match = /^(objects|groups|materials)\/(\d+)$/.exec(key)
  if (!match) return undefined
  const [, collection, number] = match
  const index = Number(number)
  const text = await readObjText(input)

  const vertices: number[] = []
  const triangles: number[] = []
  const analysis = new ObjAnalysis({
    vertex(rest) {
      const [x = 0, y = 0, z = 0] = rest.split(/\s+/).map(Number)
      vertices.push(x, y, z)
    },
    face(where, rest) {
      const wanted =
        collection === 'objects'
          ? where.object
          : collection === 'groups'
            ? where.group
            : where.material
      if (wanted !== index) return
      // A polygon as a fan of triangles; negative indices count back from the last vertex.
      const count = vertices.length / 3
      const corners = libraryNames(rest).map((vertex) => {
        const position = Number(vertex.split('/')[0])
        return position < 0 ? count + position : position - 1
      })
      if (corners.some((corner) => !Number.isInteger(corner) || corner < 0 || corner >= count))
        return
      for (let corner = 1; corner + 1 < corners.length; corner++)
        for (const each of [corners[0]!, corners[corner]!, corners[corner + 1]!])
          triangles.push(vertices[each * 3]!, vertices[each * 3 + 1]!, vertices[each * 3 + 2]!)
    },
  })
  const reader = new StatementReader((statement) => analysis.statement(statement))
  reader.push(text)
  reader.end()
  const subresource = analysis.report().subresources.find((each) => each.key === key)
  if (!subresource) return undefined
  const label = `${subresource.kind} ${subresource.name}`
  if (!triangles.length) return { label }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(triangles), 3))
  geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({
    color: accent,
    roughness: 0.6,
    side: DoubleSide,
    // Drawn over the model's own faces in the same place.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  return { label, mesh: new Mesh(geometry, material) }
}

/** Opacity of the meshes that are not focused. */
const dimmed = 0.25

/**
 * Dims every mesh of a model except some: their materials are swapped for see-through copies, and
 * put back by `clear`. Anything that replaces materials must clear first and apply again.
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

/** The meshes, lines and points of a model, each once. */
function meshesIn(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    const item = object as Mesh & { isLine?: boolean; isPoints?: boolean }
    if (item.isMesh || item.isLine || item.isPoints) meshes.push(item)
  })
  return meshes
}
