import { isNotApplicable, type NotApplicable, type PluginInput } from '@vormio/plugin-sdk'
import type { Runtime } from './figure.ts'
import { loadRuntime } from './runtimes.ts'
import { readAtlas, readPage, readSkeleton, type PageImage, type SkeletonFile } from './source.ts'
import { requireRuntimeLine } from './version.ts'

/** Everything a runtime needs to load a skeleton. */
export interface Parts {
  runtime: Runtime
  skeleton: SkeletonFile['data']
  atlas: string
  pages: { name: string; image: PageImage }[]
}

/**
 * Reads a skeleton, binary or JSON, with the files it needs: its version decides the runtime, then
 * the atlas with the same name, then every page of the atlas. Stops at the first file that is
 * missing or not usable, with the reason. JSON that is not a skeleton is not applicable.
 */
export async function readParts(
  input: PluginInput,
  signal?: AbortSignal,
): Promise<Parts | NotApplicable> {
  const skeleton = await readSkeleton(input, signal)
  if (isNotApplicable(skeleton)) return skeleton
  const line = requireRuntimeLine(skeleton.version)
  const atlas = await readAtlas(input)
  const runtime = await loadRuntime(line)
  const names = runtime.pageNames(atlas)
  const pages = await Promise.all(
    names.map(async (name) => ({ name, image: await readPage(input, name) })),
  )
  return { runtime, skeleton: skeleton.data, atlas, pages }
}
