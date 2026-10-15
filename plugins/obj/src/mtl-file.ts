// Reads Wavefront MTL material libraries: the materials they define and the texture files their
// statements name. The composition report comes from here, and so does the text the previews hand
// to three.js's MTLLoader, which understands fewer texture options. No DOM, so it runs in Node tests
// as well as in the plugin pages.

import type { CompositionReport, ReportReference, ReportSubresource } from '@vormio/plugin-sdk'
import {
  diagnosticList,
  limits,
  plainText,
  reportedUri,
  withinLimits,
} from '../../../shared/report.ts'
import { fileName, materialNameKey } from './names.ts'
import { StatementReader, type Statement } from './obj-file.ts'

/** Texture statements (in lower case, as keywords are matched) and the roles of their files. */
const textureRoles: Record<string, string> = {
  map_ka: '环境光贴图',
  map_kd: '漫反射贴图',
  map_ks: '高光贴图',
  map_ke: '自发光贴图',
  map_ns: '高光指数贴图',
  map_d: '透明度贴图',
  map_bump: '凹凸贴图',
  bump: '凹凸贴图',
  norm: '法线贴图',
  map_kn: '法线贴图',
  disp: '置换贴图',
  decal: '贴花贴图',
  refl: '反射贴图',
  map_pr: '粗糙度贴图',
  map_pm: '金属度贴图',
  map_ps: '光泽贴图',
}
const isTexture = (keyword: string) => keyword in textureRoles || keyword.startsWith('map_')

/** Other statements of the format and its common PBR extension. */
const known = new Set([
  'newmtl',
  'ka',
  'kd',
  'ks',
  'ke',
  'km',
  'ns',
  'ni',
  'd',
  'tr',
  'tf',
  'illum',
  'sharpness',
  'pr',
  'pm',
  'ps',
  'pc',
  'pcr',
  'aniso',
  'anisor',
])

/** Texture options and how many arguments each takes (at least, at most). */
const options: Record<string, [number, number]> = {
  '-blendu': [1, 1],
  '-blendv': [1, 1],
  '-boost': [1, 1],
  '-mm': [2, 2],
  '-o': [1, 3],
  '-s': [1, 3],
  '-t': [1, 3],
  '-texres': [1, 1],
  '-clamp': [1, 1],
  '-bm': [1, 1],
  '-imfchan': [1, 1],
  '-type': [1, 1],
  '-cc': [1, 1],
}
const isNumber = (token: string) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(token)

/** A texture statement: its options (name → arguments) and the file name after them. */
export interface TextureStatement {
  options: Map<string, string[]>
  file: string
}

/**
 * Splits the arguments of a texture statement. Options come first, each with its arguments; the
 * rest of the line is the file name, which may contain spaces.
 */
export function readTextureStatement(rest: string): TextureStatement {
  const found = new Map<string, string[]>()
  const tokens = [...rest.matchAll(/\S+/g)]
  let at = 0
  while (at < tokens.length) {
    const option = tokens[at]![0]
    const counts = options[option]
    if (!counts) break
    const [least, most] = counts
    const values: string[] = []
    at++
    while (
      at < tokens.length &&
      values.length < most &&
      (values.length < least || isNumber(tokens[at]![0]))
    )
      values.push(tokens[at++]![0])
    found.set(option, values)
  }
  const start = tokens[at]?.index
  return { options: found, file: start === undefined ? '' : rest.slice(start).trim() }
}

/** The composition report of an MTL text. */
export function analyzeMtl(text: string): CompositionReport {
  const { diagnostics, diagnose } = diagnosticList()
  const subresources: ReportSubresource[] = []
  const fileReferences: ReportReference[] = []
  const names = new Map<string, number>()
  /** The name of each material, by position; keys are settled once the last one is known. */
  const defined: string[] = []
  let material: string | undefined
  const unknown = new Map<string, number>()
  const reader = new StatementReader(({ keyword, rest, line }: Statement) => {
    const lower = keyword.toLowerCase()
    if (lower === 'newmtl') {
      const key = `materials/${subresources.length}`
      const shown = plainText(rest || '（无名称）', limits.name)
      const earlier = names.get(rest)
      if (earlier !== undefined)
        diagnose(
          'warning',
          `第 ${line} 行又定义了名为 ${shown} 的材质（第 ${earlier} 行已有），使用这个名称时按后一个显示。`,
          key,
        )
      names.set(rest, line)
      defined.push(rest)
      subresources.push({ key, kind: '材质', name: shown })
      material = key
      return
    }
    if (isTexture(lower)) {
      const { options: found, file } = readTextureStatement(rest)
      if (!material)
        diagnose('warning', `第 ${line} 行的 ${keyword} 在第一个 newmtl 之前，不属于任何材质。`)
      if (!file) {
        diagnose('warning', `第 ${line} 行的 ${keyword} 没有文件名。`, material)
        return
      }
      const uri = reportedUri(fileName(file))
      if (!uri) {
        diagnose('warning', `第 ${line} 行的文件名太长，没有报告。`, material)
        return
      }
      const cube = lower === 'refl' ? found.get('-type')?.[0] : undefined
      const role = textureRoles[lower] ?? `贴图（${keyword}）`
      fileReferences.push({
        ...(material ? { from: material } : {}),
        uri,
        role: plainText(cube ? `${role}（${cube}）` : role, limits.label),
        evidence: `第 ${line} 行`,
      })
      return
    }
    if (!known.has(lower) && !unknown.has(keyword)) unknown.set(keyword, line)
  })
  reader.push(text)
  reader.end()
  for (const [keyword, line] of unknown)
    diagnose('info', `无法识别的语句 ${keyword}（第 ${line} 行起）。`)
  // The material MTLLoader keeps for a name is the last one, so that one is keyed by the name and
  // earlier ones keep their position.
  const last = new Map(defined.map((name, position) => [name, position]))
  const keys = new Map(
    defined.map((name, position) => [
      `materials/${position}`,
      (last.get(name) === position && materialNameKey(name)) || `materials/${position}`,
    ]),
  )
  const rekey = <T extends { key?: string; from?: string }>(each: T): T => ({
    ...each,
    ...(each.key !== undefined ? { key: keys.get(each.key) ?? each.key } : {}),
    ...(each.from !== undefined ? { from: keys.get(each.from) ?? each.from } : {}),
  })
  return withinLimits({
    subresources: subresources.map(rekey),
    fileReferences: fileReferences.map(rekey),
    internal: [],
    diagnostics: diagnostics.map(rekey),
    partial: false,
    dropOrder: [['materials', 'material']],
  })
}

/**
 * The MTL text as three.js's MTLLoader should read it. MTLLoader takes everything after `-bm`, `-s`
 * and `-o` (with exactly one, three and three arguments) as the file name, so a texture statement
 * is written again with just those options, filled in with their defaults, and its file name as a
 * relative address (`\` as `/`, `%`, `?` and `#` encoded). Other lines stay as they are.
 */
export function mtlForLoader(text: string): string {
  const lines: string[] = []
  const reader = new StatementReader(({ keyword, rest }: Statement) => {
    if (!isTexture(keyword.toLowerCase())) {
      lines.push(`${keyword} ${rest}`)
      return
    }
    const { options: found, file } = readTextureStatement(rest)
    if (!file) return
    const parts = [keyword]
    const bump = found.get('-bm')
    if (bump?.length) parts.push('-bm', bump[0]!)
    for (const [option, fallback] of [
      ['-s', '1'],
      ['-o', '0'],
    ] as const) {
      const values = found.get(option)
      if (values?.length)
        parts.push(option, values[0]!, values[1] ?? fallback, values[2] ?? fallback)
    }
    parts.push(fileName(file))
    lines.push(parts.join(' '))
  })
  reader.push(text)
  reader.end()
  return `${lines.join('\n')}\n`
}
