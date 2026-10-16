// The Spine version in the header of a binary skeleton, read without a runtime: which runtime can
// read the rest depends on it. No DOM, so it runs in Node tests as well as in the plugin pages.

import { SpineError } from '../errors.ts'

/** The Spine runtimes in the package, by major and minor version. */
export const runtimeLines = ['3.7', '3.8', '4.0', '4.1', '4.2', '4.3'] as const
export type RuntimeLine = (typeof runtimeLines)[number]

/** A varint+ at `offset`: 7 bits per byte, low bits first; undefined past the end. */
function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | undefined {
  let value = 0
  for (let index = 0; index < 5; index++) {
    const byte = bytes[offset + index]
    if (byte === undefined) return undefined
    value |= (byte & 0x7f) << (7 * index)
    if (!(byte & 0x80)) return { value: value >>> 0, next: offset + index + 1 }
  }
  return undefined
}

/** A string at `offset`: its byte count plus one, then UTF-8. */
function readString(
  bytes: Uint8Array,
  offset: number,
): { value: string; next: number } | undefined {
  const length = readVarint(bytes, offset)
  if (!length || length.value < 2 || length.value > 256) return undefined
  const end = length.next + length.value - 1
  if (end > bytes.length) return undefined
  return { value: new TextDecoder().decode(bytes.subarray(length.next, end)), next: end }
}

const versionPattern = /^(\d+)\.(\d+)\.\d+/

/**
 * The editor version that wrote a binary skeleton, such as `4.2.43`; undefined when the bytes do
 * not start like one. From 4.0 the header starts with a hash of two 32-bit ints; before that the
 * hash was a string. Either way the version string follows.
 */
export function skeletonVersion(bytes: Uint8Array): string | undefined {
  const modern = readString(bytes, 8)
  if (modern && versionPattern.test(modern.value)) return modern.value
  const hash = readString(bytes, 0)
  const legacy = hash && readString(bytes, hash.next)
  if (legacy && versionPattern.test(legacy.value)) return legacy.value
  return undefined
}

/** The runtime for data of `version`; throws the reason when the package has none. */
export function requireRuntimeLine(version: string): RuntimeLine {
  const line = runtimeLine(version)
  if (!line)
    throw new SpineError(
      `Spine ${version} 的数据：插件只包含这些版本的运行时：${runtimeLines.join('、')}。`,
    )
  return line
}

/** The runtime for data of `version`, or undefined when the package has none. */
export function runtimeLine(version: string): RuntimeLine | undefined {
  const match = versionPattern.exec(version)
  const line = match ? `${match[1]}.${match[2]}` : ''
  return runtimeLines.find((each) => each === line)
}
