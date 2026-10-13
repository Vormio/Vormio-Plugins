// Reads a Spine / libGDX texture atlas: pages, the regions on them and where each region lies on its
// page. Both the 4.x syntax (`bounds`, `offsets`) and the 3.x syntax (`xy`, `size`, `orig`,
// `offset`) are read. `analyzeAtlas` turns the result into a composition report; the thumbnail and
// the viewer draw from it. No DOM, so it runs in Node tests as well as in the plugin pages.

import type {
  CompositionReport,
  ReportDiagnostic,
  ReportReference,
  ReportSubresource,
} from '@vormio/plugin-sdk'
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

export interface AtlasPage {
  /** The image file name as written, relative to the atlas. */
  name: string
  line: number
  /** `size` of the page, if given. */
  size?: { width: number; height: number }
}

export interface AtlasRegion {
  name: string
  /** Index into the atlas's pages. */
  page: number
  line: number
  /** Frame number, -1 when the region is not a frame. */
  index: number
  /** Rotation on the page in degrees (`rotate: true` is 90). */
  degrees: number
  /** The region's size before rotation, as Spine uses it. */
  width: number
  height: number
  /** The area the region covers on its page, in page pixels from the top left. */
  rect?: { x: number; y: number; width: number; height: number }
}

export interface Atlas {
  pages: AtlasPage[]
  regions: AtlasRegion[]
}

type Diagnose = (severity: ReportDiagnostic['severity'], message: string, key?: string) => void

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
export const pageKey = (index: number) => `pages/${index}`
export const regionKey = (index: number) => `regions/${index}`

/**
 * The address of a page relative to the atlas. Atlases hold file names, not URIs, but the host
 * decodes percent-encoding and drops anything after `?` or `#`; those three characters are encoded
 * so the name reaches the host as written.
 */
export function pageUri(name: string): string {
  return name.replace(/[%?#]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * Parses the text of an .atlas file. Problems that still leave a usable atlas go to `diagnose`;
 * text that is not an atlas throws SpineError.
 */
export function parseAtlas(text: string, diagnose: Diagnose = () => undefined): Atlas {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const pages: AtlasPage[] = []
  const regions: AtlasRegion[] = []
  /** Numbers of the region's position fields, combined once the region is complete. */
  const positions: { bounds?: number[]; xy?: number[]; size?: number[] }[] = []
  let page: AtlasPage | undefined
  let region: AtlasRegion | undefined
  /** Whether the line after the current page's name was a field, as exporters always write. */
  let pageHasFields = false

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
        region = {
          name: line,
          page: pages.length - 1,
          line: lineNumber,
          index: -1,
          degrees: 0,
          width: 0,
          height: 0,
        }
        regions.push(region)
        positions.push({})
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
      else if (
        pageFields[entry.name] !== undefined &&
        checkNumbers(entry.values, pageFields[entry.name]!, entry.name === 'size', where, key) &&
        entry.name === 'size'
      )
        page.size = { width: Number(entry.values[0]), height: Number(entry.values[1]) }
      return
    }
    const key = regionKey(regions.length - 1)
    if (entry.name === 'rotate') {
      const value = entry.values.join(',')
      if (value === 'true') region.degrees = 90
      else if (value === 'false') region.degrees = 0
      else if (isNumber(value)) region.degrees = Number(value)
      else diagnose('warning', `第 ${lineNumber} 行区域字段 rotate 的值无法识别。`, key)
      return
    }
    const count = regionFields[entry.name]
    if (count === undefined) return
    if (!checkNumbers(entry.values, count, true, `第 ${lineNumber} 行区域字段 ${entry.name} `, key))
      return
    const numbers = entry.values.map(Number)
    if (entry.name === 'index') region.index = numbers[0]!
    else if (entry.name === 'bounds' || entry.name === 'xy' || entry.name === 'size')
      positions[regions.length - 1]![entry.name] = numbers
  })
  if (page && !pageHasFields) failNotAtlas(page.line)
  if (pages.length === 0) throw new SpineError('图集中没有任何页面。')

  // Where each region lies: `bounds` gives position and size; 3.x writes `xy` and `size`. Sizes
  // are before rotation, so a region turned by 90 degrees covers its height across the page.
  regions.forEach((each, index) => {
    const { bounds, xy, size } = positions[index]!
    const [x, y, width, height] = bounds ?? (xy && size ? [...xy, ...size] : [])
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      diagnose(
        'warning',
        `第 ${each.line} 行的区域 ${each.name} 没有位置（bounds 或 xy）。`,
        regionKey(index),
      )
      return
    }
    each.width = width
    each.height = height
    const turned = Math.abs(each.degrees % 180) === 90
    each.rect = turned ? { x, y, width: height, height: width } : { x, y, width, height }
  })
  return { pages, regions }
}

/** The display name of a region: frames carry their number. */
export function regionName(region: AtlasRegion): string {
  return region.index >= 0 ? `${region.name}（帧 ${region.index}）` : region.name
}

/** Analyzes the text of an .atlas file. */
export function analyzeAtlas(text: string): CompositionReport {
  const { diagnostics, diagnose } = diagnosticList()
  const { pages, regions } = parseAtlas(text, diagnose)

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
    const name = regionName(each)
    subresources.push(
      compact({
        key,
        kind: '区域',
        name: plainText(name, limits.name),
        parent: pageKey(each.page),
      }),
    )
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
