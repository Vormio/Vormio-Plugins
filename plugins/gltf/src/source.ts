import type { PluginInput } from '@vormio/plugin-sdk'
import { ModelError } from './errors.ts'
import {
  glbPrefixLength,
  isGlb,
  parseGltfJson,
  readGlbPrefix,
  readGltf,
  type GltfSummary,
} from './gltf-file.ts'

/** Reads the input, or one byte range of it; the host answers a single range with 206. */
async function read(
  input: PluginInput,
  range?: { start: number; end: number },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; whole: boolean }> {
  const response = await fetch(
    input.url,
    range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined,
  ).catch(() => undefined)
  if (!response?.ok)
    throw new ModelError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  return { bytes: new Uint8Array(await response.arrayBuffer()), whole: response.status !== 206 }
}

/** The whole input file. */
export async function readMainFile(input: PluginInput): Promise<ArrayBuffer> {
  return (await read(input)).bytes.buffer
}

/**
 * The JSON of a glTF file, checked like `readGltf`. Of a GLB only the header and the JSON chunk are
 * read, so a large binary chunk is never loaded.
 */
export async function readGltfJson(input: PluginInput): Promise<GltfSummary> {
  if (input.extension === 'glb' && input.size >= glbPrefixLength) {
    const prefix = await read(input, { start: 0, end: glbPrefixLength - 1 })
    // A server that ignores ranges sends the whole file, which works as well.
    if (prefix.whole) return readGltf(prefix.bytes.buffer)
    if (isGlb(prefix.bytes)) {
      const { jsonLength } = readGlbPrefix(prefix.bytes, input.size)
      if (jsonLength === 0) return { container: 'glb', json: parseGltfJson(new Uint8Array()) }
      const chunk = await read(input, {
        start: glbPrefixLength,
        end: glbPrefixLength + jsonLength - 1,
      })
      if (chunk.whole) return readGltf(chunk.bytes.buffer)
      return { container: 'glb', json: parseGltfJson(chunk.bytes) }
    }
  }
  return readGltf(await readMainFile(input))
}
