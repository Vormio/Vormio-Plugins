// Builds the composition report of a glTF file from its JSON alone: the objects inside it, what
// refers to what, and the files it names. Buffers and images are never read. No DOM, so it runs in
// Node tests as well as in the analyzer page.

import type {
  CompositionReport,
  ReportDiagnostic,
  ReportReference,
  ReportSubresource,
} from '@vormio/plugin-sdk'
import { unsupportedRequiredExtensions, type GltfJson } from './gltf-file.ts'

/**
 * The host's report limits. The SDK exports them as `reportLimits`, but importing a value from its
 * report module would bundle its schema and zod into the page; a test keeps the two equal.
 */
export const limits = {
  subresources: 10_000,
  references: 50_000,
  diagnostics: 500,
  /** Serialized size, as the host measures it (JSON.stringify length). */
  size: 4 * 1024 * 1024,
  uri: 2048,
  name: 200,
  label: 80,
  evidence: 300,
  message: 500,
}

/** The collections that become subresources, in display order, with their display kinds. */
const collections = [
  ['scenes', '场景'],
  ['nodes', '节点'],
  ['meshes', '网格'],
  ['materials', '材质'],
  ['textures', '纹理'],
  ['images', '图像'],
  ['buffers', '缓冲区'],
  ['cameras', '相机'],
  ['lights', '光源'],
  ['skins', '皮肤'],
  ['animations', '动画'],
] as const
type Collection = (typeof collections)[number][0]
const kinds = Object.fromEntries(collections) as Record<Collection, string>

/** When a report is too large, subresources of these collections go first, last index first. */
const dropOrder: Collection[] = [
  'nodes',
  'animations',
  'skins',
  'lights',
  'cameras',
  'buffers',
  'images',
  'textures',
  'materials',
  'meshes',
  'scenes',
]

/** Display names for the texture slots of the core glTF material. */
const coreTextureSlots: Record<string, string> = {
  baseColorTexture: '基础色贴图',
  metallicRoughnessTexture: '金属度/粗糙度贴图',
  normalTexture: '法线贴图',
  occlusionTexture: '环境光遮蔽贴图',
  emissiveTexture: '自发光贴图',
}

/** Texture extensions whose `source` names an image in another format. */
const imageSourceRoles: Record<string, string> = {
  KHR_texture_basisu: '图像（KTX2）',
  EXT_texture_webp: '图像（WebP）',
  EXT_texture_avif: '图像（AVIF）',
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const objectAt = (value: unknown, ...path: string[]): Json | undefined => {
  let current = value
  for (const step of path) current = isObject(current) ? current[step] : undefined
  return isObject(current) ? current : undefined
}

/** A JSON pointer (RFC 6901) into the file's JSON. */
export function pointer(...parts: (string | number)[]): string {
  return parts
    .map((part) => `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('')
}

/** Display text: control characters become spaces, overlong text ends in an ellipsis. */
export function plainText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ')
  if (clean.length <= max) return clean
  let cut = clean.slice(0, max - 1)
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * The address to report for `uri`, as written. The host classifies any `data:` address as
 * embedded, so an overlong one is shortened to its header; other overlong addresses cannot be
 * reported and return undefined.
 */
export function reportedUri(uri: string): string | undefined {
  if (uri.length <= limits.uri) return uri
  if (!/^data:/i.test(uri)) return undefined
  const comma = uri.indexOf(',')
  return comma > 0 && comma < limits.uri ? uri.slice(0, comma + 1) : 'data:'
}

/** The object without its undefined properties, which a report leaves out. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined)) as T
}

/** Analyzes the JSON of a .gltf file or of a GLB's JSON chunk. */
export function analyzeGltf(json: GltfJson, container: 'gltf' | 'glb'): CompositionReport {
  const diagnostics: ReportDiagnostic[] = []
  const reported = new Set<string>()
  let partial = false
  const diagnose = (severity: ReportDiagnostic['severity'], message: string, key?: string) => {
    // The same problem found along several paths is reported once.
    if (reported.has(`${key}\0${message}`)) return
    reported.add(`${key}\0${message}`)
    diagnostics.push(compact({ severity, message: plainText(message, limits.message), key }))
  }

  // --- The objects ------------------------------------------------------------------------
  const lightsHolder = objectAt(json, 'extensions', 'KHR_lights_punctual')
  const items = {} as Record<Collection, Json[]>
  for (const [collection] of collections) {
    const value = collection === 'lights' ? lightsHolder?.lights : json[collection]
    if (value !== undefined && !Array.isArray(value)) {
      diagnose('error', `${collection} 不是数组，其中的内容没有分析。`)
      partial = true
    }
    items[collection] = (Array.isArray(value) ? value : []).map((item, index) => {
      if (isObject(item)) return item
      diagnose('error', `${kinds[collection]} ${index}（/${collection}/${index}）不是 JSON 对象。`)
      return {}
    })
  }
  const keyOf = (collection: Collection, index: number) => `${collection}/${index}`
  const names = new Map<string, string>()
  const nameOf = (collection: Collection, index: number): string => {
    const key = keyOf(collection, index)
    let name = names.get(key)
    if (name === undefined) {
      const written = items[collection][index]?.name
      name =
        typeof written === 'string' && written.trim()
          ? plainText(written, limits.name)
          : collection === 'buffers' && container === 'glb' && index === 0 && !items.buffers[0]?.uri
            ? 'GLB 二进制块'
            : `${kinds[collection]} ${index}`
      names.set(key, name)
    }
    return name
  }
  const nameOfKey = (key: string) => {
    const [collection, index] = key.split('/') as [Collection, string]
    return nameOf(collection, Number(index))
  }

  // --- The node hierarchy -------------------------------------------------------------------
  const parents = new Map<number, string>()
  items.nodes.forEach((node, index) => {
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (!isIndex(child) || child >= items.nodes.length)
        diagnose(
          'error',
          `${nameOf('nodes', index)} 的子节点 ${String(child)} 不存在。`,
          keyOf('nodes', index),
        )
      else if (parents.has(child))
        diagnose(
          'warning',
          `${nameOf('nodes', child)} 有多个父节点，只按第一个显示。`,
          keyOf('nodes', child),
        )
      else parents.set(child, keyOf('nodes', index))
    }
  })
  items.scenes.forEach((scene, index) => {
    for (const root of Array.isArray(scene.nodes) ? scene.nodes : []) {
      if (!isIndex(root) || root >= items.nodes.length)
        diagnose(
          'error',
          `${nameOf('scenes', index)} 的根节点 ${String(root)} 不存在。`,
          keyOf('scenes', index),
        )
      else if (!parents.has(root)) parents.set(root, keyOf('scenes', index))
    }
  })
  // glTF forbids cycles; a file that has one would make the hierarchy endless. One pass: each node
  // is walked up once, and a walk that reaches a node of its own path has found a cycle.
  const walked = new Map<number, 'walking' | 'done'>()
  for (const start of [...parents.keys()]) {
    const path: number[] = []
    let current: number | undefined = start
    while (current !== undefined && !walked.has(current)) {
      walked.set(current, 'walking')
      path.push(current)
      const parent = parents.get(current)
      const next = parent?.startsWith('nodes/') ? Number(parent.slice('nodes/'.length)) : undefined
      if (next !== undefined && walked.get(next) === 'walking') {
        parents.delete(current)
        diagnose(
          'warning',
          `节点层级有环，${nameOf('nodes', current)} 的父节点没有显示。`,
          keyOf('nodes', current),
        )
        break
      }
      current = next
    }
    for (const node of path) walked.set(node, 'done')
  }

  const subresources: ReportSubresource[] = []
  for (const [collection, kind] of collections)
    items[collection].forEach((_, index) => {
      const parent = collection === 'nodes' ? parents.get(index) : undefined
      subresources.push(
        compact({ key: keyOf(collection, index), kind, name: nameOf(collection, index), parent }),
      )
    })

  // --- References -----------------------------------------------------------------------------
  const fileReferences: ReportReference[] = []
  const internal: ReportReference[] = []
  const linked = new Set<string>()

  /** A reference from `from` (or the file) to item `index` of `collection`, if it exists. */
  const link = (
    from: string | undefined,
    collection: Collection,
    index: unknown,
    role: string,
    evidence: string,
    options: { once?: boolean } = {},
  ) => {
    if (!isIndex(index) || index >= items[collection].length) {
      const subject = from ? `${nameOfKey(from)} ` : '文件'
      diagnose(
        'error',
        `${subject}引用的${kinds[collection]} ${String(index)} 不存在（${evidence}）。`,
        from,
      )
      return
    }
    const key = keyOf(collection, index)
    if (options.once) {
      if (linked.has(`${from}\0${key}\0${role}`)) return
      linked.add(`${from}\0${key}\0${role}`)
    }
    internal.push(
      compact({
        from,
        key,
        role: plainText(role, limits.label),
        evidence: plainText(evidence, limits.evidence),
      }),
    )
  }

  const fileReference = (from: string, uri: string, role: string, evidence: string) => {
    if (uri === '') {
      diagnose('error', `${nameOfKey(from)} 的地址为空（${evidence}）。`, from)
      return
    }
    const reportedAddress = reportedUri(uri)
    if (reportedAddress === undefined) {
      diagnose(
        'warning',
        `${nameOfKey(from)} 的地址超过 ${limits.uri} 个字符，没有列出（${evidence}）。`,
        from,
      )
      return
    }
    fileReferences.push({ from, uri: reportedAddress, role, evidence })
  }

  /** The buffers an accessor's data lives in, for "which file holds this geometry". */
  const bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : []
  const accessors = Array.isArray(json.accessors) ? json.accessors : []
  const buffersOfView = (view: unknown, evidence: string): number[] => {
    const definition = isIndex(view) ? bufferViews[view] : undefined
    if (!isObject(definition)) {
      diagnose('error', `bufferView ${String(view)} 不存在（${evidence}）。`)
      return []
    }
    const found = [definition.buffer]
    for (const name of ['EXT_meshopt_compression', 'KHR_meshopt_compression'])
      found.push(objectAt(definition, 'extensions', name)?.buffer)
    return found.filter(isIndex)
  }
  const buffersOfAccessor = (accessor: unknown, evidence: string): number[] => {
    const definition = isIndex(accessor) ? accessors[accessor] : undefined
    if (!isObject(definition)) {
      diagnose('error', `accessor ${String(accessor)} 不存在（${evidence}）。`)
      return []
    }
    const views = [definition.bufferView]
    const sparse = objectAt(definition, 'sparse')
    if (sparse)
      views.push(objectAt(sparse, 'indices')?.bufferView, objectAt(sparse, 'values')?.bufferView)
    return views
      .filter((view) => view !== undefined)
      .flatMap((view) => buffersOfView(view, evidence))
  }
  const linkBuffers = (from: string, buffers: number[], role: string, evidence: string) => {
    for (const buffer of buffers) link(from, 'buffers', buffer, role, evidence, { once: true })
  }

  // Files the glTF names.
  items.buffers.forEach((buffer, index) => {
    const from = keyOf('buffers', index)
    if (typeof buffer.uri === 'string')
      fileReference(from, buffer.uri, '缓冲区数据', pointer('buffers', index, 'uri'))
    else {
      const fallback = ['EXT_meshopt_compression', 'KHR_meshopt_compression'].some(
        (name) => objectAt(buffer, 'extensions', name)?.fallback === true,
      )
      // In a GLB, the first buffer without a uri is the binary chunk.
      if (!fallback && !(container === 'glb' && index === 0))
        diagnose('error', `${nameOf('buffers', index)} 没有 uri。`, from)
    }
  })
  items.images.forEach((image, index) => {
    const from = keyOf('images', index)
    if (typeof image.uri === 'string')
      fileReference(from, image.uri, '图像', pointer('images', index, 'uri'))
    else if (image.bufferView !== undefined)
      linkBuffers(
        from,
        buffersOfView(image.bufferView, pointer('images', index, 'bufferView')),
        '嵌入数据',
        pointer('images', index, 'bufferView'),
      )
    else diagnose('error', `${nameOf('images', index)} 既没有 uri 也没有 bufferView。`, from)
  })

  // Links between the objects of the file.
  if (json.scene !== undefined) link(undefined, 'scenes', json.scene, '默认场景', '/scene')
  items.nodes.forEach((node, index) => {
    const from = keyOf('nodes', index)
    if (node.mesh !== undefined)
      link(from, 'meshes', node.mesh, '网格', pointer('nodes', index, 'mesh'))
    if (node.camera !== undefined)
      link(from, 'cameras', node.camera, '相机', pointer('nodes', index, 'camera'))
    if (node.skin !== undefined)
      link(from, 'skins', node.skin, '皮肤', pointer('nodes', index, 'skin'))
    const light = objectAt(node, 'extensions', 'KHR_lights_punctual')?.light
    if (light !== undefined)
      link(
        from,
        'lights',
        light,
        '光源',
        pointer('nodes', index, 'extensions', 'KHR_lights_punctual', 'light'),
      )
  })
  items.meshes.forEach((mesh, index) => {
    const from = keyOf('meshes', index)
    ;(Array.isArray(mesh.primitives) ? mesh.primitives : []).forEach((primitive, p) => {
      if (!isObject(primitive)) return
      const at = (...parts: (string | number)[]) =>
        pointer('meshes', index, 'primitives', p, ...parts)
      if (primitive.material !== undefined)
        link(from, 'materials', primitive.material, '材质', at('material'), { once: true })
      const mappings = objectAt(primitive, 'extensions', 'KHR_materials_variants')?.mappings
      ;(Array.isArray(mappings) ? mappings : []).forEach((mapping, m) => {
        if (isObject(mapping) && mapping.material !== undefined)
          link(
            from,
            'materials',
            mapping.material,
            '变体材质',
            at('extensions', 'KHR_materials_variants', 'mappings', m, 'material'),
            { once: true },
          )
      })
      for (const [name, accessor] of Object.entries(objectAt(primitive, 'attributes') ?? {}))
        linkBuffers(
          from,
          buffersOfAccessor(accessor, at('attributes', name)),
          '几何数据',
          at('attributes', name),
        )
      if (primitive.indices !== undefined)
        linkBuffers(
          from,
          buffersOfAccessor(primitive.indices, at('indices')),
          '几何数据',
          at('indices'),
        )
      ;(Array.isArray(primitive.targets) ? primitive.targets : []).forEach((target, t) => {
        for (const [name, accessor] of Object.entries(isObject(target) ? target : {}))
          linkBuffers(
            from,
            buffersOfAccessor(accessor, at('targets', t, name)),
            '几何数据',
            at('targets', t, name),
          )
      })
      const draco = objectAt(primitive, 'extensions', 'KHR_draco_mesh_compression')
      if (draco?.bufferView !== undefined) {
        const evidence = at('extensions', 'KHR_draco_mesh_compression', 'bufferView')
        linkBuffers(from, buffersOfView(draco.bufferView, evidence), '几何数据', evidence)
      }
    })
  })
  items.materials.forEach((material, index) => {
    const from = keyOf('materials', index)
    // Texture slots are properties named …Texture holding an index, in the core material and in
    // material extensions alike (KHR_materials_clearcoat's clearcoatTexture and so on).
    const visit = (value: Json, path: string[], extension?: string) => {
      for (const [property, child] of Object.entries(value)) {
        if (!isObject(child)) continue
        if (property.endsWith('Texture') && child.index !== undefined) {
          const role = extension
            ? `${property}（${extension}）`
            : (coreTextureSlots[property] ?? property)
          link(
            from,
            'textures',
            child.index,
            role,
            pointer('materials', index, ...path, property, 'index'),
          )
        } else if (property !== 'extras') {
          visit(child, [...path, property], path.at(-1) === 'extensions' ? property : extension)
        }
      }
    }
    visit(material, [])
  })
  items.textures.forEach((texture, index) => {
    const from = keyOf('textures', index)
    if (texture.source !== undefined)
      link(from, 'images', texture.source, '图像', pointer('textures', index, 'source'))
    for (const [name, extension] of Object.entries(objectAt(texture, 'extensions') ?? {}))
      if (isObject(extension) && extension.source !== undefined)
        link(
          from,
          'images',
          extension.source,
          imageSourceRoles[name] ?? `图像（${name}）`,
          pointer('textures', index, 'extensions', name, 'source'),
        )
  })
  items.skins.forEach((skin, index) => {
    const from = keyOf('skins', index)
    if (skin.skeleton !== undefined)
      link(from, 'nodes', skin.skeleton, '骨架根节点', pointer('skins', index, 'skeleton'))
    ;(Array.isArray(skin.joints) ? skin.joints : []).forEach((joint, j) =>
      link(from, 'nodes', joint, '关节', pointer('skins', index, 'joints', j), { once: true }),
    )
    if (skin.inverseBindMatrices !== undefined) {
      const evidence = pointer('skins', index, 'inverseBindMatrices')
      linkBuffers(from, buffersOfAccessor(skin.inverseBindMatrices, evidence), '皮肤数据', evidence)
    }
  })
  items.animations.forEach((animation, index) => {
    const from = keyOf('animations', index)
    ;(Array.isArray(animation.channels) ? animation.channels : []).forEach((channel, c) => {
      const node = objectAt(channel, 'target')?.node
      if (node !== undefined)
        link(
          from,
          'nodes',
          node,
          '动画目标',
          pointer('animations', index, 'channels', c, 'target', 'node'),
          { once: true },
        )
    })
    ;(Array.isArray(animation.samplers) ? animation.samplers : []).forEach((sampler, s) => {
      if (!isObject(sampler)) return
      for (const name of ['input', 'output'])
        if (sampler[name] !== undefined) {
          const evidence = pointer('animations', index, 'samplers', s, name)
          linkBuffers(from, buffersOfAccessor(sampler[name], evidence), '动画数据', evidence)
        }
    })
  })

  const unsupported = unsupportedRequiredExtensions(json)
  if (unsupported.length)
    diagnose(
      'warning',
      `文件要求的扩展本插件不支持：${unsupported.join('、')}。查看器与缩略图不会显示这个文件。`,
    )

  return withinLimits(subresources, fileReferences, internal, diagnostics, partial)
}

/**
 * Keeps a report inside the host's limits. Files the glTF names come first, so they are the last
 * to be dropped; nodes are dropped before other objects. Anything dropped marks the report partial.
 */
function withinLimits(
  allSubresources: ReportSubresource[],
  fileReferences: ReportReference[],
  internal: ReportReference[],
  diagnostics: ReportDiagnostic[],
  partial: boolean,
): CompositionReport {
  let subresources = allSubresources
  const notes: string[] = []
  const dropSubresources = (count: number) => {
    const dropped = new Set<string>()
    for (const collection of dropOrder) {
      for (let index = subresources.length - 1; index >= 0 && dropped.size < count; index--)
        if (subresources[index]!.key.startsWith(`${collection}/`))
          dropped.add(subresources[index]!.key)
      if (dropped.size >= count) break
    }
    subresources = subresources.filter((each) => !dropped.has(each.key))
  }
  if (subresources.length > limits.subresources) {
    dropSubresources(subresources.length - limits.subresources)
    notes.push(`对象超过 ${limits.subresources.toLocaleString('en-US')} 个，只列出一部分。`)
  }

  let references: ReportReference[] = []
  let fileCount = 0
  const assemble = (): CompositionReport => {
    const kept = new Set(subresources.map((each) => each.key))
    const known = (key: string | undefined) => key === undefined || kept.has(key)
    const files = fileReferences.filter((each) => known(each.from))
    fileCount = files.length
    references = [...files, ...internal.filter((each) => known(each.from) && known(each.key))]
    if (references.length > limits.references) {
      references = references.slice(0, limits.references)
      if (!notes.some((note) => note.startsWith('引用')))
        notes.push(`引用超过 ${limits.references.toLocaleString('en-US')} 条，只列出一部分。`)
    }
    const shown = diagnostics.map((each) =>
      known(each.key) ? each : compact({ ...each, key: undefined }),
    )
    const room = limits.diagnostics - notes.length
    const listed = shown.length > room ? shown.slice(0, room - 1) : shown
    if (shown.length > room)
      listed.push({
        severity: 'info',
        message: `另有 ${shown.length - listed.length} 条诊断没有列出。`,
      })
    return {
      subresources: subresources.map((each) =>
        each.parent !== undefined && !kept.has(each.parent)
          ? compact({ ...each, parent: undefined })
          : each,
      ),
      references,
      diagnostics: [...listed, ...notes.map((message) => ({ severity: 'info' as const, message }))],
      ...(partial || notes.length ? { partial: true } : {}),
    }
  }

  let report = assemble()
  // The size limit counts characters of the serialized report; keep some room for the notes.
  for (let round = 0; round < 50 && JSON.stringify(report).length > limits.size - 4096; round++) {
    if (!notes.some((note) => note.startsWith('报告'))) notes.push('报告超过 4 MiB，只列出一部分。')
    if (references.length > fileCount) {
      const keep = Math.max(fileCount, Math.floor(references.length * 0.8))
      internal = internal.slice(0, Math.max(0, internal.length - (references.length - keep)))
    } else if (subresources.length > 0) dropSubresources(Math.ceil(subresources.length * 0.2))
    else fileReferences = fileReferences.slice(0, Math.floor(fileReferences.length * 0.8))
    report = assemble()
  }
  return report
}
