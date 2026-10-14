// Helpers for building composition reports that the host accepts: its limits, plain display text,
// addresses and trimming an oversized report. No DOM, so they run in Node tests as well as in the
// analyzer pages.

import type {
  CompositionReport,
  ReportDiagnostic,
  ReportReference,
  ReportSubresource,
} from '@vormio/plugin-sdk'

/**
 * The host's report limits. The SDK exports them as `reportLimits`, but importing a value from its
 * report module would bundle its schema and zod into the page; a test keeps the two equal.
 */
export const limits = {
  subresources: 10_000,
  references: 50_000,
  diagnostics: 500,
  /** Serialized size: UTF-8 bytes of the report as JSON, as the host measures it. */
  size: 4 * 1024 * 1024,
  uri: 2048,
  name: 200,
  label: 80,
  evidence: 300,
  /** The basis of an inferred reference. */
  inferred: 120,
  message: 500,
}

/** A JSON pointer (RFC 6901) into a JSON document. */
export function pointer(...parts: (string | number)[]): string {
  return parts
    .map((part) => `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('')
}

/** Display text: control characters become spaces, overlong text ends in an ellipsis. */
export function plainText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ')
  if (clean.length <= max) return clean
  let cut = clean.slice(0, max - 1)
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * The address to report for `uri`, as written. The host classifies any `data:` address as
 * embedded, so an overlong one is shortened to its header; other overlong addresses cannot be
 * reported and return undefined.
 */
export function reportedUri(uri: string): string | undefined {
  if (uri.length <= limits.uri) return uri
  if (!/^data:/i.test(uri)) return undefined
  const comma = uri.indexOf(',')
  return comma > 0 && comma < limits.uri ? uri.slice(0, comma + 1) : 'data:'
}

/**
 * The size the host checks against `limits.size`: UTF-8 bytes of the report as JSON, as the SDK's
 * parseReport measures it. Computed here because importing parseReport would bundle zod.
 */
export function serializedSize(report: CompositionReport): number {
  return new TextEncoder().encode(JSON.stringify(report)).byteLength
}

/** The object without its undefined properties, which a report leaves out. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined)) as T
}

export interface ReportParts {
  subresources: ReportSubresource[]
  /** References to other files; they are kept longest. */
  fileReferences: ReportReference[]
  /** References between subresources of the file. */
  internal: ReportReference[]
  diagnostics: ReportDiagnostic[]
  partial: boolean
  /**
   * Key prefixes (the part before the first `/`) in the order their subresources are dropped when
   * the report is too large, last one in the file first. Subresources of other prefixes go last.
   */
  dropOrder: readonly string[]
}

/**
 * Keeps a report inside the host's limits. File references come first, so they are the last to be
 * dropped; subresources go in `dropOrder`. Anything dropped marks the report partial.
 */
export function withinLimits(parts: ReportParts): CompositionReport {
  let { subresources, fileReferences, internal } = parts
  const { diagnostics, partial, dropOrder } = parts
  const notes: string[] = []
  const dropSubresources = (count: number) => {
    const dropped = new Set<string>()
    const prefixes = [...dropOrder, '']
    for (const prefix of prefixes) {
      for (let index = subresources.length - 1; index >= 0 && dropped.size < count; index--) {
        const key = subresources[index]!.key
        if (prefix === '' || key.startsWith(`${prefix}/`)) dropped.add(key)
      }
      if (dropped.size >= count) break
    }
    subresources = subresources.filter((each) => !dropped.has(each.key))
  }
  if (subresources.length > limits.subresources) {
    dropSubresources(subresources.length - limits.subresources)
    notes.push(`对象超过 ${limits.subresources.toLocaleString('en-US')} 个，只列出一部分。`)
  }

  let references: ReportReference[] = []
  let fileCount = 0
  const assemble = (): CompositionReport => {
    const kept = new Set(subresources.map((each) => each.key))
    const known = (key: string | undefined) => key === undefined || kept.has(key)
    const files = fileReferences.filter((each) => known(each.from))
    fileCount = files.length
    references = [...files, ...internal.filter((each) => known(each.from) && known(each.key))]
    if (references.length > limits.references) {
      references = references.slice(0, limits.references)
      if (!notes.some((note) => note.startsWith('引用')))
        notes.push(`引用超过 ${limits.references.toLocaleString('en-US')} 条，只列出一部分。`)
    }
    const shown = diagnostics.map((each) =>
      known(each.key) ? each : compact({ ...each, key: undefined }),
    )
    const room = limits.diagnostics - notes.length
    const listed = shown.length > room ? shown.slice(0, room - 1) : shown
    if (shown.length > room)
      listed.push({
        severity: 'info',
        message: `另有 ${shown.length - listed.length} 条诊断没有列出。`,
      })
    return {
      subresources: subresources.map((each) =>
        each.parent !== undefined && !kept.has(each.parent)
          ? compact({ ...each, parent: undefined })
          : each,
      ),
      references,
      diagnostics: [...listed, ...notes.map((message) => ({ severity: 'info' as const, message }))],
      ...(partial || notes.length ? { partial: true } : {}),
    }
  }

  let report = assemble()
  // Keep some room for the notes added on the way.
  for (let round = 0; round < 50 && serializedSize(report) > limits.size - 4096; round++) {
    if (!notes.some((note) => note.startsWith('报告'))) notes.push('报告超过 4 MiB，只列出一部分。')
    if (references.length > fileCount) {
      const keep = Math.max(fileCount, Math.floor(references.length * 0.8))
      internal = internal.slice(0, Math.max(0, internal.length - (references.length - keep)))
    } else if (subresources.length > 0) dropSubresources(Math.ceil(subresources.length * 0.2))
    else fileReferences = fileReferences.slice(0, Math.floor(fileReferences.length * 0.8))
    report = assemble()
  }
  return report
}

/**
 * Collects diagnostics; the same problem found along several paths is reported once. `partial` is
 * set by the analysis when part of the file could not be read.
 */
export function diagnosticList() {
  const diagnostics: ReportDiagnostic[] = []
  const reported = new Set<string>()
  return {
    diagnostics,
    diagnose(severity: ReportDiagnostic['severity'], message: string, key?: string) {
      if (reported.has(`${key}\0${message}`)) return
      reported.add(`${key}\0${message}`)
      diagnostics.push(compact({ severity, message: plainText(message, limits.message), key }))
    },
  }
}
