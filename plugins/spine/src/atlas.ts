// Reads a Spine / libGDX texture atlas and builds its composition report: pages and the regions on
// them, and the image file of each page. Both the 4.x syntax (`bounds`, `offsets`) and the 3.x
// syntax (`xy`, `size`, `orig`, `offset`) are read. Only names and `index` are interpreted; other
// fields are checked for shape. No DOM, so it runs in Node tests as well as in the analyzer page.

import type { CompositionReport, ReportReference, ReportSubresource } from '@vormio/plugin-sdk'
import {
  compact,
  diagnosticList,
  limits,
  plainText,
  reportedUri,
  withinLimits,
} from '../../../shared/report.ts'
import { SpineError } from './errors.ts'

/** Page fields and how many numbers each holds; `undefined` means a word such as `Linear`. */
const pageFields: Record<string, number | undefined> = {
  size: 2,
  format: undefined,
  filter: undefined,
  repeat: undefined,
  pma: undefined,
  scale: 1,
}

/**
 * Region fields with numbers and how many each holds. Spine stores other region fields as
 * name/value pairs, so unknown region fields are accepted without comment.
 */
const regionFields: Record<string, number> = {
  bounds: 4,
  offsets: 4,
  xy: 2,
  size: 2,
  orig: 2,
  offset: 2,
  split: 4,
  pad: 4,
  index: 1,
}

interface Page {
  name: string
  line: number
}
interface Region {
  name: string
  page: number
  line: number
  index: number
  /** Whether a position was given (`bounds`, or `xy` and `size`). */
  placed: boolean
}

/** A `name: value` line, or undefined when the line has no colon. */
function field(line: string): { name: string; values: string[] } | undefined {
  const colon = line.indexOf(':')
  if (colon < 0) return undefined
  return {
    name: line.slice(0, colon).trim(),
    values: line
      .slice(colon + 1)
      .split(',')
      .map((each) => each.trim()),
  }
}

const isInteger = (value: string) => /^-?\d+$/.test(value)
const isNumber = (value: string) => /^-?(\d+\.?\d*|\.\d+)$/.test(value)

/**
 * The address to report for a page. Atlases hold file names, not URIs, but the host decodes
 * percent-encoding and drops anything after `?` or `#`; those three characters are encoded so the
 * name reaches the host as written.
 */
export function pageUri(name: string): string {
  return name.replace(/[%?#]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Analyzes the text of an .atlas file. */
export function analyzeAtlas(text: string): CompositionReport {
  const { diagnostics, diagnose } = diagnosticList()
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const pages: Page[] = []
  const regions: Region[] = []
  let page: Page | undefined
  let region: Region | undefined
  /** Whether the line after the current page's name was a field, as exporters always write. */
  let pageHasFields = false

  const pageKey = (index: number) => `pages/${index}`
  const regionKey = (index: number) => `regions/${index}`
  const checkNumbers = (
    values: string[],
    count: number,
    integer: boolean,
    where: string,
    key: string,
  ): boolean => {
    const valid = integer ? isInteger : isNumber
    if (values.length === count && values.every(valid)) return true
    diagnose('warning', `${where}的值不是 ${count} 个数字。`, key)
    return false
  }

  lines.forEach((raw, offset) => {
    const lineNumber = offset + 1
    const line = raw.trim()
    if (line === '') {
      if (page && !pageHasFields) failNotAtlas(page.line)
      page = undefined
      region = undefined
      return
    }
    const entry = field(line)
    if (!entry) {
      if (!page) {
        page = { name: line, line: lineNumber }
        pages.push(page)
        pageHasFields = false
        region = undefined
      } else {
        if (!pageHasFields) failNotAtlas(page.line)
        region = { name: line, page: pages.length - 1, line: lineNumber, index: -1, placed: false }
        regions.push(region)
      }
      return
    }
    if (!page) {
      // libGDX allows fields before the first page; Spine writes none.
      if (pages.length === 0 && regions.length === 0)
        diagnose('info', `第 ${lineNumber} 行的字段 ${entry.name} 在第一个页面之前，已忽略。`)
      else failNotAtlas(lineNumber)
      return
    }
    if (!region) {
      pageHasFields = true
      const key = pageKey(pages.length - 1)
      const where = `第 ${lineNumber} 行页面字段 ${entry.name} `
      if (!(entry.name in pageFields))
        diagnose('info', `第 ${lineNumber} 行的页面字段 ${entry.name} 无法识别。`, key)
      else if (pageFields[entry.name] !== undefined)
        checkNumbers(entry.values, pageFields[entry.name]!, entry.name === 'size', where, key)
      return
    }
    const key = regionKey(regions.length - 1)
    const count = regionFields[entry.name]
    if (count === undefined) return
    if (!checkNumbers(entry.values, count, true, `第 ${lineNumber} 行区域字段 ${entry.name} `, key))
      return
    if (entry.name === 'index') region.index = Number(entry.values[0])
    if (entry.name === 'bounds' || entry.name === 'xy') region.placed = true
  })
  if (page && !pageHasFields) failNotAtlas(page.line)
  if (pages.length === 0) throw new SpineError('图集中没有任何页面。')

  // --- Subresources and references --------------------------------------------------------------
  const subresources: ReportSubresource[] = []
  const fileReferences: ReportReference[] = []
  pages.forEach((each, index) => {
    const key = pageKey(index)
    subresources.push({ key, kind: '页面', name: plainText(each.name, limits.name) })
    const uri = reportedUri(pageUri(each.name))
    if (uri === undefined)
      diagnose(
        'warning',
        `第 ${each.line} 行的页面文件名超过 ${limits.uri} 个字符，没有列出。`,
        key,
      )
    else
      fileReferences.push({
        from: key,
        uri,
        role: '贴图页',
        evidence: `第 ${each.line} 行`,
      })
  })
  const seen = new Map<string, number>()
  regions.forEach((each, index) => {
    const key = regionKey(index)
    const name = each.index >= 0 ? `${each.name}（帧 ${each.index}）` : each.name
    subresources.push(
      compact({
        key,
        kind: '区域',
        name: plainText(name, limits.name),
        parent: pageKey(each.page),
      }),
    )
    if (!each.placed)
      diagnose('warning', `第 ${each.line} 行的区域 ${each.name} 没有位置（bounds 或 xy）。`, key)
    // Spine looks regions up by name and index across the whole atlas.
    const identity = `${each.name}\0${each.index}`
    const first = seen.get(identity)
    if (first === undefined) seen.set(identity, each.line)
    else
      diagnose(
        'warning',
        `第 ${each.line} 行的区域 ${name} 与第 ${first} 行重名，Spine 只会使用第一个。`,
        key,
      )
  })

  return withinLimits({
    subresources,
    fileReferences,
    internal: [],
    diagnostics,
    partial: false,
    dropOrder: ['regions', 'pages'],
  })
}

function failNotAtlas(line: number): never {
  throw new SpineError(
    `不是 Spine 或 libGDX 图集：第 ${line} 行的页面名后面应当是页面字段（例如 size: 1024, 512）。`,
  )
}
