import { readCompanion, type CompanionStatus, type PluginInput } from '@vormio/plugin-sdk'
import { fileUri } from '../../../../shared/uri.ts'
import { SpineError } from '../errors.ts'

/** The skeleton file's bytes, in a buffer of their own as the runtime's reader expects. */
export async function readSkeleton(input: PluginInput, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(input.url, { signal }).catch(() => undefined)
  if (!response?.ok)
    throw new SpineError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  return response.arrayBuffer()
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

/** The atlas that goes with a skeleton by name: `hero.skel` → `hero.atlas`. */
export function atlasName(skeletonName: string): string {
  const dot = skeletonName.lastIndexOf('.')
  return `${dot > 0 ? skeletonName.slice(0, dot) : skeletonName}.atlas`
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
 */
export async function readPage(input: PluginInput, name: string): Promise<PageImage> {
  const result = await readCompanion(input, fileUri(name).replaceAll('\\', '/'))
  if (result.status !== 'ok') return { problem: reasons[result.status] }
  const url = URL.createObjectURL(new Blob([result.bytes]))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { image }
  } catch {
    return { problem: reasons.undecodable }
  } finally {
    // The decoded pixels stay with the element.
    URL.revokeObjectURL(url)
  }
}
