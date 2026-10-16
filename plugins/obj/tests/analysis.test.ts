import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseReport, reportLimits, type CompositionReport } from '@vormio/plugin-sdk'
import { analyzeMtl, mtlForLoader, readTextureStatement } from '../src/mtl-file.ts'
import { fileName } from '../src/names.ts'
import {
  analyzeObj,
  looksBinary,
  NotObjError,
  ObjAnalysis,
  StatementReader,
  summarizeObj,
  type Statement,
} from '../src/obj-file.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/obj')
const text = (path: string) => readFile(join(fixtures, path), 'utf8')
function accepted(report: CompositionReport): CompositionReport {
  const parsed = parseReport(report)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.problems.join('\n'))
  return report
}
const obj = async (path: string) => accepted(analyzeObj(await text(path)))
const mtl = async (path: string) => accepted(analyzeMtl(await text(path)))
const names = (report: CompositionReport) =>
  report.subresources.map(
    (each) => `${each.kind} ${each.name}${each.parent ? ` ⊂ ${each.parent}` : ''}`,
  )
const references = (report: CompositionReport) =>
  report.references.map((each) =>
    each.uri !== undefined || each.uris !== undefined
      ? `${each.from ?? '文件'} → ${each.uri ?? each.uris!.join(' | ')}${each.uriKey ? ` ▸ ${each.uriKey}` : ''}（${each.role}，${each.evidence}）`
      : `${each.from} → ${each.key}（${each.role}，${each.evidence}）`,
  )
const messages = (report: CompositionReport) => report.diagnostics.map((each) => each.message)

test('objects, the groups in them, the materials they use and the library', async () => {
  const report = await obj('basic/table.obj')
  assert.deepEqual(names(report), [
    '对象 Top（6 个面）',
    '对象 Legs（24 个面）',
    '组 top（6 个面） ⊂ objects/0',
    '组 legs-front（12 个面） ⊂ objects/1',
    '组 legs-back（12 个面） ⊂ objects/1',
    '材质 Wood',
    '材质 Metal',
  ])
  assert.deepEqual(references(report), [
    '文件 → table.mtl（材质库，第 2 行）',
    // With one library, each material is the one of its name there, by the MTL analyzer's key.
    'materials/0 → table.mtl ▸ material:Wood（材质定义，第 5 行）',
    'materials/1 → table.mtl ▸ material:Metal（材质定义，第 32 行）',
    'groups/0 → materials/0（使用材质，第 5 行）',
    'groups/1 → materials/1（使用材质，第 32 行）',
    'groups/2 → materials/1（使用材质，第 32 行）',
  ])
  assert.deepEqual(report.diagnostics, [])
})

test('two libraries, one in a sibling folder; faces outside groups belong to the object', async () => {
  const report = await obj('layout/model/crate.obj')
  assert.deepEqual(references(report), [
    '文件 → base.mtl（材质库，第 1 行）',
    '文件 → ../materials/paint.mtl（材质库，第 2 行）',
    // With two, which one defines a material is not written in the OBJ: both are candidates, the
    // last one first, as the previews take the last library that defines a material.
    'materials/0 → ../materials/paint.mtl | base.mtl ▸ material:Body（材质定义，第 4 行）',
    'materials/1 → ../materials/paint.mtl | base.mtl ▸ material:Label（材质定义，第 29 行）',
    'objects/0 → materials/0（使用材质，第 4 行）',
    'objects/0 → materials/1（使用材质，第 29 行）',
  ])
  // Several names on one mtllib line, and the implicit object before the first `o`.
  const both = accepted(analyzeObj('mtllib a.mtl b.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))
  assert.deepEqual(references(both).slice(0, 2), [
    '文件 → a.mtl（材质库，第 1 行）',
    '文件 → b.mtl（材质库，第 1 行）',
  ])
  assert.deepEqual(names(both), ['对象 默认（1 个面）'])
  assert.deepEqual(messages(both), [
    '第 1 行的 mtllib 列出 2 个材质库，按空格分开读取；文件名中的空格无法写进 OBJ。',
  ])
})

test('materials are connected to the one library by the keys its MTL report gives them', async () => {
  // The contract between the two analyzers: each uriKey is a key of the library's report.
  const report = await obj('basic/table.obj')
  const library = await mtl('basic/table.mtl')
  const keys = new Set(library.subresources.map((each) => each.key))
  const definitions = report.references.filter((each) => each.uriKey !== undefined)
  assert.equal(definitions.length, 2)
  for (const each of definitions) assert.ok(keys.has(each.uriKey!), each.uriKey)
  // The same library named twice is still one library; an empty or overlong name has no key.
  const long = 'm'.repeat(200)
  const twice = accepted(
    analyzeObj(
      ['mtllib a.mtl', 'mtllib a.mtl', 'usemtl', 'f 1 1 1', `usemtl ${long}`, 'usemtl Ok'].join(
        '\n',
      ),
    ),
  )
  assert.deepEqual(
    twice.references.flatMap((each) => (each.uriKey ? [`${each.from} ▸ ${each.uriKey}`] : [])),
    ['materials/2 ▸ material:Ok'],
  )
})

test('with several libraries, each material lists them as candidates, the last one first', async () => {
  // Every candidate's report has the keys (Vormio/Vormio-Core#9: the host resolves to the first).
  const report = await obj('layout/model/crate.obj')
  const definitions = report.references.filter((each) => each.uris !== undefined)
  assert.deepEqual(
    definitions.map((each) => [each.from, each.uriKey, each.uris]),
    [
      ['materials/0', 'material:Body', ['../materials/paint.mtl', 'base.mtl']],
      ['materials/1', 'material:Label', ['../materials/paint.mtl', 'base.mtl']],
    ],
  )
  for (const path of ['layout/materials/paint.mtl', 'layout/model/base.mtl']) {
    const keys = new Set((await mtl(path)).subresources.map((each) => each.key))
    for (const each of definitions) assert.ok(keys.has(each.uriKey!), `${path} ${each.uriKey}`)
  }
  // A library named again keeps its first place, as the previews read each library once.
  const again = accepted(
    analyzeObj('mtllib a.mtl\nmtllib b.mtl\nmtllib a.mtl\nusemtl M\nf 1 1 1\n'),
  )
  assert.deepEqual(again.references.find((each) => each.uris)?.uris, ['b.mtl', 'a.mtl'])
  // At most 16 candidates; a file naming more connects no material and says so.
  const naming = (count: number) =>
    accepted(
      analyzeObj(
        [
          ...Array.from({ length: count }, (_, i) => `mtllib lib${i}.mtl`),
          'usemtl M',
          'v 0 0 0',
          'f 1 1 1',
        ].join('\n'),
      ),
    )
  assert.equal(
    naming(reportLimits.candidates).references.find((each) => each.uris)?.uris?.length,
    16,
  )
  const tooMany = naming(reportLimits.candidates + 1)
  assert.equal(
    tooMany.references.some((each) => each.uriKey !== undefined),
    false,
  )
  assert.deepEqual(messages(tooMany), [
    '文件指定了 17 个材质库，超过 16 个，没有把材质连到材质库中的定义。',
  ])
})

test('library names: Windows separators become /, and %, ? and # are encoded', () => {
  assert.equal(fileName('..\\materials\\a b.mtl'), '../materials/a b.mtl')
  assert.equal(fileName('100%#1?.mtl'), '100%25%231%3F.mtl')
  const report = accepted(analyzeObj('mtllib ..\\shared\\paint#1.mtl\nv 0 0 0\n'))
  assert.equal(report.references[0]?.uri, '../shared/paint%231.mtl')
})

test('problems in the faces and statements become diagnostics', async () => {
  const report = await obj('problems/bad-index.obj')
  assert.deepEqual(names(report), ['对象 Broken（3 个面）'])
  assert.deepEqual(messages(report), [
    '2 处面引用了不存在的顶点、贴图坐标或法线，第一处在第 6 行。',
    '文件包含自由曲线或曲面（第 8 行起），查看器与缩略图不显示它们。',
    '无法识别的语句 zz（第 9 行起）。',
  ])
  // Negative indices count back from the last vertex; one past the start is wrong.
  const relative = accepted(analyzeObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nf -4 -2 -1\n'))
  assert.deepEqual(messages(relative), ['第 5 行的面引用了不存在的顶点、贴图坐标或法线。'])
  const noLibrary = accepted(analyzeObj('usemtl Paint\nv 0 0 0\n'))
  assert.deepEqual(messages(noLibrary), ['文件使用了材质（usemtl），但没有指定材质库（mtllib）。'])
})

test('text without OBJ statements and binary files are not OBJ', async () => {
  assert.throws(() => analyzeObj(''), NotObjError)
  const notes = await text('not-obj/notes.obj')
  assert.throws(() => analyzeObj(notes), NotObjError)
  assert.throws(() => summarizeObj('# only a comment\n'), NotObjError)
  for (const path of ['not-obj/compiled-msvc.obj', 'not-obj/compiled-gcc.obj'])
    assert.ok(looksBinary(await readFile(join(fixtures, path))), path)
  for (const path of ['basic/table.obj', 'not-obj/notes.obj'])
    assert.ok(!looksBinary(await readFile(join(fixtures, path))), path)
})

test('statements across chunk boundaries, CRLF, continued lines and comments', () => {
  const statements: Statement[] = []
  const reader = new StatementReader((statement) => statements.push(statement))
  for (const chunk of [
    '﻿# comment\r\nv 1 2',
    ' 3\r\nf 1 \\\n 2 3\n',
    'o Name with # sign\n',
    'g a',
  ])
    reader.push(chunk)
  reader.end()
  assert.deepEqual(statements, [
    { keyword: 'v', rest: '1 2 3', line: 2 },
    { keyword: 'f', rest: '1   2 3', line: 3 },
    { keyword: 'o', rest: 'Name with # sign', line: 5 },
    { keyword: 'g', rest: 'a', line: 6 },
  ])
  const analysis = new ObjAnalysis()
  const streamed = new StatementReader((statement) => analysis.statement(statement))
  const whole = 'o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 3\n'
  for (let at = 0; at < whole.length; at += 3) streamed.push(whole.slice(at, at + 3))
  streamed.end()
  assert.deepEqual(analysis.report(), analyzeObj(whole))
})

test('what the previews need: the libraries in order and whether anything can be drawn', async () => {
  assert.deepEqual(summarizeObj(await text('layout/model/crate.obj')), {
    libraries: ['base.mtl', '../materials/paint.mtl'],
    elements: 12,
  })
  assert.deepEqual(summarizeObj('v 0 0 0\nmtllib a.mtl a.mtl\n'), {
    libraries: ['a.mtl'],
    elements: 0,
  })
})

test('MTL: materials and the textures they name, with options and Windows paths', async () => {
  const report = await mtl('basic/table.mtl')
  assert.deepEqual(names(report), ['材质 Wood', '材质 Metal'])
  // Materials are keyed by name, which an OBJ's usemtl refers to.
  assert.deepEqual(
    report.subresources.map((each) => each.key),
    ['material:Wood', 'material:Metal'],
  )
  assert.deepEqual(references(report), [
    'material:Wood → textures/wood grain.png（漫反射贴图，第 4 行）',
  ])
  const paint = await mtl('layout/materials/paint.mtl')
  assert.deepEqual(references(paint), [
    'material:Label → ../textures/stripes %232.png（漫反射贴图，第 7 行）',
    'material:Label → ../textures/stripes %232.png（凹凸贴图，第 8 行）',
  ])
})

test('MTL: problems and every kind of texture statement', async () => {
  const report = await mtl('problems/library-issues.mtl')
  // MTLLoader keeps the later of two materials of a name, so that one has the name key.
  assert.deepEqual(
    report.subresources.map((each) => each.key),
    ['materials/0', 'material:Twice'],
  )
  assert.deepEqual(references(report), [
    '文件 → orphan.png（漫反射贴图，第 1 行）',
    'material:Twice → sky top.png（反射贴图（cube_top），第 7 行）',
    'material:Twice → sky bottom.png（反射贴图（cube_bottom），第 8 行）',
    'material:Twice → rough.png（粗糙度贴图，第 9 行）',
    'material:Twice → custom.png（贴图（map_Xyz），第 10 行）',
  ])
  assert.deepEqual(
    report.diagnostics.map((each) => each.key),
    [undefined, 'material:Twice', 'material:Twice', undefined],
  )
  assert.deepEqual(messages(report), [
    '第 1 行的 map_Kd 在第一个 newmtl 之前，不属于任何材质。',
    '第 4 行又定义了名为 Twice 的材质（第 2 行已有），使用这个名称时按后一个显示。',
    '第 6 行的 map_Ks 没有文件名。',
    '无法识别的语句 zz（第 11 行起）。',
  ])
})

test('texture options are skipped by their argument counts; the rest is the file name', () => {
  const read = (rest: string) => {
    const { options, file } = readTextureStatement(rest)
    return { options: Object.fromEntries(options), file }
  }
  assert.deepEqual(read('-s 2 2 -o 0.5 -clamp on -mm 0 1 my  wood.png'), {
    options: { '-s': ['2', '2'], '-o': ['0.5'], '-clamp': ['on'], '-mm': ['0', '1'] },
    file: 'my  wood.png',
  })
  // -o takes up to three numbers; a name that looks like a number after them is the file.
  assert.deepEqual(read('-o 1 2 3 4.png'), { options: { '-o': ['1', '2', '3'] }, file: '4.png' })
  assert.deepEqual(read('-bm 0.3 -imfchan l bump.tga'), {
    options: { '-bm': ['0.3'], '-imfchan': ['l'] },
    file: 'bump.tga',
  })
  // A name starting with a dash that is no option.
  assert.deepEqual(read('-texture.png'), { options: {}, file: '-texture.png' })
})

test('MTLLoader gets only the options it understands, with encoded file names', async () => {
  assert.equal(
    mtlForLoader(await text('layout/materials/paint.mtl')),
    [
      'newmtl Body',
      'Kd 0.1 0.6 0.2',
      'newmtl Label',
      'Kd 1 1 1',
      'map_Kd -s 1 1 1 -o 0 0 0 ../textures/stripes %232.png',
      'bump -bm 0.5 ../textures/stripes %232.png',
      '',
    ].join('\n'),
  )
  assert.equal(
    mtlForLoader('newmtl A\nmap_Kd -s 2 tex.png\nmap_Ka\n'),
    'newmtl A\nmap_Kd -s 2 1 1 tex.png\n',
  )
})

test('a very large OBJ gives a partial report that keeps the libraries and materials', () => {
  const lines = ['mtllib big.mtl', 'usemtl Only', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0']
  for (let index = 0; index < reportLimits.subresources + 50; index++)
    lines.push(`o Part${index}`, `g piece${index}`, 'f 1 2 3')
  const report = accepted(analyzeObj(lines.join('\n')))
  assert.equal(report.partial, true)
  assert.equal(report.subresources.length, reportLimits.subresources)
  assert.ok(report.subresources.some((each) => each.key === 'materials/0'))
  assert.equal(report.references[0]?.uri, 'big.mtl')
})
