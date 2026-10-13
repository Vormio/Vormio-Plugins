import { analyzer } from '@vormio/plugin-sdk'
import { analyzeAtlas } from './atlas.ts'
import { analyzeSkeleton, readSkeletonJson } from './skeleton.ts'
import { readText } from './source.ts'

// The report comes from the file alone: the page images an atlas names are reported as written,
// never read, so the analyzer declares no companion formats. The manifest declares only `atlas`;
// the skeleton branch waits until the host lets an analyzer decline JSON that is not Spine.
analyzer(async (input) => {
  const text = await readText(input)
  return input.extension === 'json' ? analyzeSkeleton(readSkeletonJson(text)) : analyzeAtlas(text)
})
