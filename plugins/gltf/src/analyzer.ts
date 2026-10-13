import { analyzer } from '@vormio/plugin-sdk'
import { analyzeGltf } from './analysis.ts'
import { readGltfJson } from './source.ts'

// The report comes from the JSON alone: the buffers and images a file names are reported as they
// are written, never read, so the analyzer declares no companion formats. Of a GLB only the header
// and the JSON chunk are read.
analyzer(async (input) => {
  const { json, container } = await readGltfJson(input)
  return analyzeGltf(json, container)
})
