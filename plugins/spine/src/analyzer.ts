import { analyzer, notApplicable, type PluginInput } from '@vormio/plugin-sdk'
import { analyzeAtlas } from './atlas.ts'
import { NotSpineError, SpineError } from './errors.ts'
import { loadRuntime } from './preview/runtimes.ts'
import { requireRuntimeLine, skeletonVersion } from './preview/version.ts'
import { analyzeSkeletonBinary } from './skeleton-binary.ts'
import { analyzeSkeleton, readSkeletonJson } from './skeleton.ts'
import { readBytes } from './source.ts'

// The report comes from the file alone: the page images an atlas names are reported as written and
// a skeleton's atlas of the same name as inferred, neither of them read, so the analyzer declares
// no companion formats. Other tools use `.json` too: JSON that is not a Spine skeleton is not
// applicable, and the host shows no composition for it. A binary skeleton is read by the runtime of
// its version, loaded only for it, as the previews load it.
analyzer(async (input) => {
  const bytes = await readBytes(input)
  if (input.extension === 'skel') return analyzeBinary(input, bytes)
  const text = new TextDecoder().decode(bytes)
  if (input.extension !== 'json') return analyzeAtlas(text)
  let skeleton: ReturnType<typeof readSkeletonJson>
  try {
    skeleton = readSkeletonJson(text)
  } catch (error) {
    if (error instanceof NotSpineError) return notApplicable()
    throw error
  }
  return analyzeSkeleton(skeleton, input.name)
})

async function analyzeBinary(input: PluginInput, bytes: Uint8Array) {
  const version = skeletonVersion(bytes)
  if (!version) throw new SpineError('不是 Spine 的二进制骨骼文件：文件开头没有 Spine 版本。')
  const line = requireRuntimeLine(version)
  const { spine } = await loadRuntime(line)
  return analyzeSkeletonBinary(spine, line, bytes, input.name)
}
