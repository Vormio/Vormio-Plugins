import {
  notApplicable,
  readCompanion,
  type CompanionStatus,
  type NotApplicable,
  type PluginInput,
} from '@vormio/plugin-sdk'
import { fileUri } from '../../../../shared/uri.ts'
import { NotSpineError, SpineError } from '../errors.ts'
import { atlasName, readSkeletonJson } from '../skeleton.ts'
import { skeletonVersion } from './version.ts'

/** A skeleton file as a runtime reads it: binary data, or the parsed JSON. */
export interface SkeletonFile {
  /** The editor version that wrote it, such as `4.2.43`. */
  version: string
  data: ArrayBuffer | Record<string, unknown>
}

/**
 * Reads the skeleton file. Other tools use `.json` too, so JSON that is not a Spine skeleton is not
 * applicable; that is decided from the file alone, before any companion is read. A binary file is
 * Spine's own format, so one without a version in its header fails instead.
 */
export async function readSkeleton(
  input: PluginInput,
  signal?: AbortSignal,
): Promise<SkeletonFile | NotApplicable> {
  const response = await fetch(input.url, { signal }).catch(() => undefined)
  if (!response?.ok)
    throw new SpineError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  // In a buffer of its own, as the runtime's binary reader expects.
  const bytes = await response.arrayBuffer()
  if (input.extension === 'json') {
    let json: Record<string, unknown>
    try {
      json = readSkeletonJson(new TextDecoder().decode(bytes))
    } catch (error) {
      if (error instanceof NotSpineError) return notApplicable()
      throw error
    }
    return { version: (json.skeleton as { spine: string }).spine, data: json }
  }
  const version = skeletonVersion(new Uint8Array(bytes))
  if (!version) throw new SpineError('不是 Spine 的二进制骨骼文件：文件开头没有 Spine 版本。')
  return { version, data: bytes }
}

const reasons: Record<CompanionStatus | 'undecodable', string> = {
  missing: '文件不存在',
  unauthorized: '插件只读取图集与 PNG、JPEG 贴图',
  'out-of-bounds': '路径不合法',
  'over-limit': '读取的文件太多',
  changed: '文件在磁盘上已变化，需要重新扫描',
  unavailable: '暂时无法读取',
  undecodable: '无法解码这张图片',
}

/**
 * Reads the atlas next to the skeleton with the same name. Spine exports pair the two by this
 * convention only; the skeleton does not name its atlas.
 */
export async function readAtlas(input: PluginInput): Promise<string> {
  const name = atlasName(input.name)
  const result = await readCompanion(input, fileUri(name))
  if (result.status === 'missing')
    throw new SpineError(`找不到同名图集 ${name}（${reasons.missing}）`)
  if (result.status !== 'ok')
    throw new SpineError(`图集无法读取：${name}（${reasons[result.status]}）`)
  return new TextDecoder().decode(result.bytes)
}

/** A page image, or why it cannot be shown. */
export type PageImage = { image: HTMLImageElement } | { problem: string }

/**
 * Reads and decodes an atlas page. The atlas sits next to the skeleton, so its page names are
 * relative to the skeleton too; backslashes are folder separators as on Windows. The page is an
 * image element, as the runtime's own asset manager loads it: the 4.3 runtime premultiplies
 * non-premultiplied pages through WebGL's unpack setting, which WebGL ignores for ImageBitmaps.
 *
 * It waits for the load event, not `decode()`: the host keeps a viewer hidden until it reports
 * ready, and a hidden page draws no frames, so `decode()` would never settle there. WebGL decodes
 * the image when the page is uploaded.
 */
export async function readPage(input: PluginInput, name: string): Promise<PageImage> {
  const result = await readCompanion(input, fileUri(name).replaceAll('\\', '/'))
  if (result.status !== 'ok') return { problem: reasons[result.status] }
  const url = URL.createObjectURL(new Blob([result.bytes]))
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })
    return { image }
  } catch {
    return { problem: reasons.undecodable }
  } finally {
    // The loaded image keeps its data.
    URL.revokeObjectURL(url)
  }
}
