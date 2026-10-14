import type { PluginInput } from '@vormio/plugin-sdk'
import { SpineError } from '../errors.ts'
import type { Runtime } from './figure.ts'
import { loadRuntime } from './runtimes.ts'
import { readAtlas, readPage, readSkeleton, type PageImage } from './source.ts'
import { runtimeLine, runtimeLines, skeletonVersion } from './version.ts'

/** Everything a runtime needs to load a skeleton. */
export interface Parts {
  runtime: Runtime
  skeleton: ArrayBuffer
  atlas: string
  pages: { name: string; image: PageImage }[]
}

/**
 * Reads a binary skeleton with the files it needs: its version decides the runtime, then the atlas
 * with the same name, then every page of the atlas. Stops at the first file that is missing or
 * not usable, with the reason.
 */
export async function readParts(input: PluginInput, signal?: AbortSignal): Promise<Parts> {
  const skeleton = await readSkeleton(input, signal)
  const version = skeletonVersion(new Uint8Array(skeleton))
  if (!version) throw new SpineError('不是 Spine 的二进制骨骼文件：文件开头没有 Spine 版本。')
  const line = runtimeLine(version)
  if (!line)
    throw new SpineError(
      `Spine ${version} 的数据：插件只包含这些版本的运行时：${runtimeLines.join('、')}。`,
    )
  const atlas = await readAtlas(input)
  const runtime = await loadRuntime(line)
  const names = runtime.pageNames(atlas)
  const pages = await Promise.all(
    names.map(async (name) => ({ name, image: await readPage(input, name) })),
  )
  return { runtime, skeleton, atlas, pages }
}
