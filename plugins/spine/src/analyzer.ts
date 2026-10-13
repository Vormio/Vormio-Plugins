import { analyzer, type PluginInput } from '@vormio/plugin-sdk'
import { analyzeAtlas } from './atlas.ts'
import { SpineError } from './errors.ts'
import { analyzeSkeleton, readSkeletonJson } from './skeleton.ts'

/** The whole input file as text. */
async function readText(input: PluginInput): Promise<string> {
  const response = await fetch(input.url).catch(() => undefined)
  if (!response?.ok)
    throw new SpineError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  return new TextDecoder().decode(await response.arrayBuffer())
}

// The report comes from the file alone: the page images an atlas names are reported as written,
// never read, so the analyzer declares no companion formats. The manifest declares only `atlas`;
// the skeleton branch waits until the host lets an analyzer decline JSON that is not Spine.
analyzer(async (input) => {
  const text = await readText(input)
  return input.extension === 'json' ? analyzeSkeleton(readSkeletonJson(text)) : analyzeAtlas(text)
})
