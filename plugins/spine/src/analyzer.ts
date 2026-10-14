import { analyzer, notApplicable } from '@vormio/plugin-sdk'
import { analyzeAtlas } from './atlas.ts'
import { NotSpineError } from './errors.ts'
import { analyzeSkeleton, readSkeletonJson } from './skeleton.ts'
import { readText } from './source.ts'

// The report comes from the file alone: the page images an atlas names are reported as written,
// never read, so the analyzer declares no companion formats. Other tools use `.json` too: JSON that
// is not a Spine skeleton is not applicable, and the host shows no composition for it.
analyzer(async (input) => {
  const text = await readText(input)
  if (input.extension !== 'json') return analyzeAtlas(text)
  let skeleton: ReturnType<typeof readSkeletonJson>
  try {
    skeleton = readSkeletonJson(text)
  } catch (error) {
    if (error instanceof NotSpineError) return notApplicable()
    throw error
  }
  return analyzeSkeleton(skeleton)
})
