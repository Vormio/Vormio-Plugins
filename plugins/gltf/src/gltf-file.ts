// Reads just enough of a .gltf or .glb file to refuse what the viewer cannot show, with a reason the
// user can act on, before three.js parses it. No DOM, so it runs in Node tests as well.

/** A file the plugin will not try to show; the message is shown to the user as it is. */
export class GltfFileError extends Error {
  override name = 'GltfFileError'
}

export interface GltfJson {
  asset?: { version?: unknown; minVersion?: unknown }
  extensionsUsed?: unknown
  extensionsRequired?: unknown
  [property: string]: unknown
}

export interface GltfSummary {
  container: 'gltf' | 'glb'
  json: GltfJson
}

/**
 * Extensions the bundled three.js GLTFLoader (0.186.1) implements, with the decoders this plugin
 * ships. A file that requires anything else is refused instead of being shown wrongly.
 */
export const supportedExtensions: ReadonlySet<string> = new Set([
  'EXT_materials_bump',
  'EXT_mesh_gpu_instancing',
  'EXT_meshopt_compression',
  'EXT_texture_avif',
  'EXT_texture_webp',
  'KHR_draco_mesh_compression',
  'KHR_lights_punctual',
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
  'KHR_texture_transform',
])

const glbMagic = 0x46546c67 // "glTF"
const jsonChunk = 0x4e4f534a // "JSON"

/** Identifies the container, checks it and returns the parsed JSON. */
export function readGltf(bytes: ArrayBuffer): GltfSummary {
  const view = new DataView(bytes)
  const isGlb = bytes.byteLength >= 4 && view.getUint32(0, true) === glbMagic
  const json = isGlb ? glbJson(view) : parseJson(new Uint8Array(bytes))
  checkVersion(json)
  return { container: isGlb ? 'glb' : 'gltf', json }
}

/** Required extensions that this plugin cannot show, in file order. */
export function unsupportedRequiredExtensions(json: GltfJson): string[] {
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : []
  return required.filter(
    (name): name is string => typeof name === 'string' && !supportedExtensions.has(name),
  )
}

function glbJson(view: DataView): GltfJson {
  if (view.byteLength < 20) throw new GltfFileError('GLB 文件不完整：文件头被截断。')
  const version = view.getUint32(4, true)
  if (version === 1) throw new GltfFileError('这是 glTF 1.0 的 GLB 文件，只支持 glTF 2.0。')
  if (version !== 2) throw new GltfFileError(`不支持 GLB 容器版本 ${version}，只支持版本 2。`)
  const length = view.getUint32(8, true)
  if (length > view.byteLength)
    throw new GltfFileError(
      `GLB 文件不完整：文件头声明 ${length} 字节，实际只有 ${view.byteLength} 字节。`,
    )
  const chunkLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== jsonChunk)
    throw new GltfFileError('GLB 文件损坏：第一个数据块不是 JSON。')
  if (20 + chunkLength > length)
    throw new GltfFileError('GLB 文件不完整：JSON 数据块超出了文件长度。')
  return parseJson(new Uint8Array(view.buffer, view.byteOffset + 20, chunkLength))
}

function parseJson(bytes: Uint8Array): GltfJson {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new GltfFileError('不是有效的 glTF 文件：内容不是 JSON。')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new GltfFileError('不是有效的 glTF 文件：顶层不是 JSON 对象。')
  return value as GltfJson
}

function checkVersion(json: GltfJson): void {
  const version = json.asset?.version
  if (typeof version !== 'string')
    throw new GltfFileError('不是有效的 glTF 文件：缺少 asset.version。')
  const major = Number(version.split('.')[0])
  if (major === 1) throw new GltfFileError('这是 glTF 1.0 文件，只支持 glTF 2.0。')
  if (major !== 2 || !/^\d+\.\d+$/.test(version))
    throw new GltfFileError(`不支持 glTF ${version}，只支持 glTF 2.0。`)
  const minVersion = json.asset?.minVersion
  if (typeof minVersion === 'string' && minVersion !== '2.0')
    throw new GltfFileError(`这个文件要求 glTF ${minVersion} 或更高，只支持 glTF 2.0。`)
}
