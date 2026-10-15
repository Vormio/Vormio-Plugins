import type { PluginInput } from '@vormio/plugin-sdk'
import { ModelError } from './errors.ts'
import { looksBinary, NotObjError, sniffLength } from './obj-file.ts'

async function open(input: PluginInput): Promise<Response> {
  const response = await fetch(input.url).catch(() => undefined)
  if (!response?.ok)
    throw new ModelError(
      response?.status === 409 ? '文件在磁盘上已变化，需要重新扫描。' : '无法读取这个文件。',
    )
  return response
}

/** The whole input as text; throws NotObjError for a compiled object file. */
export async function readObjText(input: PluginInput): Promise<string> {
  const bytes = new Uint8Array(await (await open(input)).arrayBuffer())
  if (looksBinary(bytes))
    throw new NotObjError('不是 OBJ 模型：文件不是文本（可能是编译产生的目标文件）。')
  return new TextDecoder().decode(bytes)
}

/** The whole input as text, for material libraries. */
export async function readText(input: PluginInput): Promise<string> {
  return new TextDecoder().decode(await (await open(input)).arrayBuffer())
}

/**
 * The input as text, chunk by chunk, so a large OBJ is analyzed without holding all of it. The
 * first bytes decide whether it is text at all: a compiled object file throws NotObjError before
 * anything is decoded.
 */
export async function* readObjChunks(input: PluginInput): AsyncGenerator<string> {
  const response = await open(input)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let start: Uint8Array = new Uint8Array(0)
  let checked = false
  for (;;) {
    const { value, done } = await reader.read()
    if (!checked) {
      // Gather the first bytes before deciding, however the stream splits them.
      if (value) start = concat(start, value)
      if (start.length < sniffLength && !done) continue
      checked = true
      if (looksBinary(start)) {
        await reader.cancel()
        throw new NotObjError('不是 OBJ 模型：文件不是文本（可能是编译产生的目标文件）。')
      }
      yield decoder.decode(start, { stream: !done })
    } else if (value) yield decoder.decode(value, { stream: true })
    if (done) break
  }
  const rest = decoder.decode()
  if (rest) yield rest
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a)
  joined.set(b, a.length)
  return joined
}
