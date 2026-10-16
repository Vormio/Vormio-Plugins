import { readCompanion, type CompanionStatus, type PluginInput } from '@vormio/plugin-sdk'
import { fileUri } from '../../../shared/uri.ts'
import type { AtlasPage } from './atlas.ts'
import { SpineError } from './errors.ts'

/** The whole input file. */
export async function readBytes(input: PluginInput, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(input.url, { signal }).catch(() => undefined)
  if (!response?.ok)
    throw new SpineError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  return new Uint8Array(await response.arrayBuffer())
}

/** The whole input file as text. */
export async function readText(input: PluginInput, signal?: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await readBytes(input, signal))
}

const reasons: Record<CompanionStatus | 'undecodable', string> = {
  missing: '文件不存在',
  unauthorized: '插件只读取 PNG 与 JPEG 贴图',
  'out-of-bounds': '路径不合法',
  'over-limit': '读取的文件太多',
  changed: '文件在磁盘上已变化，需要重新扫描',
  unavailable: '暂时无法读取',
  undecodable: '无法解码这张图片',
}

/** A page image, or why it cannot be shown. */
export type PageImage = { image: ImageBitmap } | { problem: string }

/**
 * Reads and decodes the image of `page`, next to the atlas. Atlas page names are file names, so
 * they go through `fileUri`; backslashes are folder separators as on Windows.
 */
export async function loadPage(input: PluginInput, page: AtlasPage): Promise<PageImage> {
  const result = await readCompanion(input, fileUri(page.name).replaceAll('\\', '/'))
  if (result.status !== 'ok') return { problem: reasons[result.status] }
  try {
    return { image: await createImageBitmap(new Blob([result.bytes])) }
  } catch {
    return { problem: reasons.undecodable }
  }
}

/** One line for a page that cannot be shown, such as `hero.png（文件不存在）`. */
export function describePageProblem(page: AtlasPage, problem: string): string {
  return `${page.name}（${problem}）`
}
