// Reads Wavefront OBJ text for the composition report and for what the previews need to know before
// three.js parses it: whether the file is an OBJ at all, and which material libraries it names. No
// DOM, so it runs in Node tests as well as in the plugin pages.
//
// The format is line based: a keyword, then its arguments separated by white space; a line starting
// with `#` is a comment and a line ending in `\` continues on the next one. The analysis reads the file one line
// at a time and keeps only counts and names, so a large file is never held as a whole.

import type { CompositionReport, ReportReference, ReportSubresource } from '@vormio/plugin-sdk'
import {
  compact,
  diagnosticList,
  limits,
  plainText,
  reportedUri,
  withinLimits,
} from '../../../shared/report.ts'
import { fileName } from './names.ts'

/** The file is not an OBJ at all, as opposed to a broken one; the pages answer "not applicable". */
export class NotObjError extends Error {
  override name = 'NotObjError'
}

/** How much of the start of a file is checked for binary content. */
export const sniffLength = 4096

/**
 * `.obj` is also the extension of compiled object files (COFF from MSVC, ELF from GCC and Clang),
 * which hold NUL bytes from their first few bytes on; an OBJ is text and never does.
 */
export function looksBinary(start: Uint8Array): boolean {
  return start.subarray(0, sniffLength).includes(0)
}

/** Statements of geometry and grouping; a file with none of them is not an OBJ. */
const statements = new Set([
  'v',
  'vt',
  'vn',
  'vp',
  'f',
  'fo',
  'l',
  'p',
  'o',
  'g',
  's',
  'mg',
  'usemtl',
  'mtllib',
])
/** Free-form curves and surfaces, which the analysis notes and the viewer does not draw. */
const freeForm = new Set([
  'cstype',
  'deg',
  'bmat',
  'step',
  'curv',
  'curv2',
  'surf',
  'parm',
  'trim',
  'hole',
  'scrv',
  'sp',
  'end',
  'con',
])
/** Statements the analysis accepts without comment. */
const ignored = new Set([
  'bevel',
  'c_interp',
  'd_interp',
  'lod',
  'shadow_obj',
  'trace_obj',
  'ctech',
  'stech',
  'maplib',
  'usemap',
  'call',
  'csh',
])

/** One statement: its keyword, the rest of the line (trimmed) and its first line number. */
export interface Statement {
  keyword: string
  rest: string
  line: number
}

/**
 * Splits text into statements, joining continued lines. Feed it chunks with `push` and call `end`
 * after the last one; it keeps only the unfinished line between chunks.
 */
export class StatementReader {
  private carry = ''
  private continued = ''
  private continuedFrom = 0
  private line = 0
  private readonly onStatement: (statement: Statement) => void

  constructor(onStatement: (statement: Statement) => void) {
    this.onStatement = onStatement
  }

  push(text: string): void {
    const lines = (this.carry + text).split('\n')
    this.carry = lines.pop()!
    for (const line of lines) this.take(line)
  }

  end(): void {
    if (this.carry || this.continued) this.take(this.carry)
    this.carry = ''
  }

  private take(raw: string): void {
    this.line++
    let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (this.line === 1) line = line.replace(/^﻿/, '')
    if (line.endsWith('\\')) {
      if (!this.continued) this.continuedFrom = this.line
      this.continued += `${line.slice(0, -1)} `
      return
    }
    const from = this.continued ? this.continuedFrom : this.line
    const text = (this.continued + line).trim()
    this.continued = ''
    // Only a whole line is a comment, as three.js's OBJ and MTL loaders read it: `#` may be part of
    // a file name.
    if (!text || text.startsWith('#')) return
    const space = text.search(/\s/)
    this.onStatement({
      keyword: space < 0 ? text : text.slice(0, space),
      rest: space < 0 ? '' : text.slice(space).trim(),
      line: from,
    })
  }
}

/** The file names of an `mtllib` statement: separated by white space, as the format defines. */
export function libraryNames(rest: string): string[] {
  return rest.split(/\s+/).filter(Boolean)
}

/** What the previews need from the text before three.js parses it. */
export interface ObjSummary {
  /** Material libraries in the order the file names them, each once. */
  libraries: string[]
  /** Faces, lines and points: what there is to draw. */
  elements: number
}

/** Scans a whole OBJ text; throws NotObjError when it has no OBJ statements. */
export function summarizeObj(text: string): ObjSummary {
  const libraries: string[] = []
  let elements = 0
  let recognised = false
  const reader = new StatementReader(({ keyword, rest }) => {
    if (!statements.has(keyword)) return
    recognised = true
    if (keyword === 'mtllib') {
      for (const name of libraryNames(rest)) if (!libraries.includes(name)) libraries.push(name)
    } else if (keyword === 'f' || keyword === 'fo' || keyword === 'l' || keyword === 'p') elements++
  })
  reader.push(text)
  reader.end()
  if (!recognised) throw new NotObjError('不是 OBJ 模型：没有任何 OBJ 语句。')
  return { libraries, elements }
}

/**
 * Builds the composition report of an OBJ from its statements: objects, the groups in them and the
 * materials they use, and the material libraries the file names. Call `statement` for each one,
 * then `report`, which throws NotObjError if none of them was an OBJ statement.
 */
export class ObjAnalysis {
  private readonly diagnostics = diagnosticList()
  private recognised = false
  private readonly counts = { v: 0, vt: 0, vn: 0 }
  private readonly objects: { name: string; faces: number }[] = []
  private readonly groups: { name: string; object: number; faces: number }[] = []
  /** Group index by object and name: a group named again in the same object is the same group. */
  private readonly groupIndex = new Map<string, number>()
  private readonly materials: string[] = []
  private readonly materialIndex = new Map<string, number>()
  private readonly libraries: ReportReference[] = []
  /** Where faces go: the current group, or the object when no group is set since it started. */
  private object: number | undefined
  private group: number | undefined
  private material: number | undefined
  private materialLine = 0
  private readonly uses = new Map<string, ReportReference>()
  private badIndices = { count: 0, first: 0 }
  private unknown = new Map<string, number>()
  private freeFormLine = 0

  statement({ keyword, rest, line }: Statement): void {
    if (statements.has(keyword)) this.recognised = true
    switch (keyword) {
      case 'v':
      case 'vt':
      case 'vn':
        this.counts[keyword]++
        return
      case 'o':
        this.object = this.objects.push({ name: rest, faces: 0 }) - 1
        this.group = undefined
        return
      case 'g': {
        const object = this.currentObject()
        const name = libraryNames(rest).join(' ') || 'default'
        const key = `${object}\0${name}`
        let group = this.groupIndex.get(key)
        if (group === undefined) {
          group = this.groups.push({ name, object, faces: 0 }) - 1
          this.groupIndex.set(key, group)
        }
        this.group = group
        return
      }
      case 'usemtl': {
        const name = rest
        let index = this.materialIndex.get(name)
        if (index === undefined) {
          index = this.materials.push(name) - 1
          this.materialIndex.set(name, index)
        }
        this.material = index
        this.materialLine = line
        return
      }
      case 'mtllib': {
        const names = libraryNames(rest)
        if (names.length > 1)
          this.diagnostics.diagnose(
            'info',
            `第 ${line} 行的 mtllib 列出 ${names.length} 个材质库，按空格分开读取；文件名中的空格无法写进 OBJ。`,
          )
        for (const name of names) {
          const uri = reportedUri(fileName(name))
          if (uri)
            this.libraries.push({
              uri,
              role: '材质库',
              evidence: plainText(`第 ${line} 行`, limits.evidence),
            })
          else this.diagnostics.diagnose('warning', `第 ${line} 行的材质库名称太长，没有报告。`)
        }
        return
      }
      case 'f':
      case 'fo':
        this.face(rest, line)
        return
      case 'vp':
      case 'l':
      case 'p':
      case 's':
      case 'mg':
        return
    }
    if (freeForm.has(keyword)) {
      this.freeFormLine ||= line
      return
    }
    if (!ignored.has(keyword) && !this.unknown.has(keyword)) this.unknown.set(keyword, line)
  }

  /** The object faces and groups belong to; an implicit one before the first `o`. */
  private currentObject(): number {
    this.object ??= this.objects.push({ name: '', faces: 0 }) - 1
    return this.object
  }

  private face(rest: string, line: number): void {
    const object = this.currentObject()
    // An object counts the faces of its groups as well.
    this.objects[object]!.faces++
    if (this.group !== undefined) this.groups[this.group]!.faces++
    // Each vertex is v, v/vt, v//vn or v/vt/vn; negative indices count back from the last one.
    const limitsOf = [this.counts.v, this.counts.vt, this.counts.vn]
    for (const vertex of libraryNames(rest)) {
      const parts = vertex.split('/')
      for (let slot = 0; slot < Math.min(parts.length, 3); slot++) {
        if (parts[slot] === '' && slot > 0) continue
        const index = Number(parts[slot])
        const count = limitsOf[slot]!
        if (!Number.isInteger(index) || index === 0 || index > count || index < -count) {
          if (this.badIndices.count++ === 0) this.badIndices.first = line
        }
      }
    }
    if (this.material !== undefined) {
      const from = this.group !== undefined ? `groups/${this.group}` : `objects/${object}`
      const key = `materials/${this.material}`
      if (!this.uses.has(`${from}\0${key}`))
        this.uses.set(`${from}\0${key}`, {
          from,
          key,
          role: '使用材质',
          evidence: `第 ${this.materialLine} 行`,
        })
    }
  }

  report(): CompositionReport {
    if (!this.recognised) throw new NotObjError('不是 OBJ 模型：没有任何 OBJ 语句。')
    const { diagnose, diagnostics } = this.diagnostics
    if (this.badIndices.count)
      diagnose(
        'warning',
        this.badIndices.count === 1
          ? `第 ${this.badIndices.first} 行的面引用了不存在的顶点、贴图坐标或法线。`
          : `${this.badIndices.count.toLocaleString('en-US')} 处面引用了不存在的顶点、贴图坐标或法线，第一处在第 ${this.badIndices.first} 行。`,
      )
    if (this.materials.length && !this.libraries.length)
      diagnose('info', '文件使用了材质（usemtl），但没有指定材质库（mtllib）。')
    if (this.freeFormLine)
      diagnose(
        'info',
        `文件包含自由曲线或曲面（第 ${this.freeFormLine} 行起），查看器与缩略图不显示它们。`,
      )
    for (const [keyword, line] of this.unknown)
      diagnose('info', `无法识别的语句 ${keyword}（第 ${line} 行起）。`)

    const faces = (count: number) => `${count.toLocaleString('en-US')} 个面`
    const shown = (name: string, fallback: string) => plainText(name || fallback, limits.name - 20)
    const subresources: ReportSubresource[] = []
    this.objects.forEach((object, index) => {
      // The implicit object is listed only when something belongs to it.
      if (!object.name && !object.faces && !this.groups.some((group) => group.object === index))
        return
      subresources.push({
        key: `objects/${index}`,
        kind: '对象',
        name: `${shown(object.name, index === 0 ? '默认' : `对象 ${index + 1}`)}（${faces(object.faces)}）`,
      })
    })
    this.groups.forEach((group, index) =>
      subresources.push({
        key: `groups/${index}`,
        kind: '组',
        name: `${shown(group.name, 'default')}（${faces(group.faces)}）`,
        parent: `objects/${group.object}`,
      }),
    )
    this.materials.forEach((name, index) =>
      subresources.push(
        compact({ key: `materials/${index}`, kind: '材质', name: shown(name, '（无名称）') }),
      ),
    )
    return withinLimits({
      subresources,
      fileReferences: this.libraries,
      internal: [...this.uses.values()],
      diagnostics,
      partial: false,
      dropOrder: ['groups', 'objects'],
    })
  }
}

/** The composition report of a whole OBJ text. */
export function analyzeObj(text: string): CompositionReport {
  const analysis = new ObjAnalysis()
  const reader = new StatementReader((statement) => analysis.statement(statement))
  reader.push(text)
  reader.end()
  return analysis.report()
}
