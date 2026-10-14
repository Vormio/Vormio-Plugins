import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseReport, type CompositionReport } from '@vormio/plugin-sdk'
import { limits, serializedSize } from '../../../shared/report.ts'
import { analyzeAtlas } from '../src/atlas.ts'
import { SpineError } from '../src/errors.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')
/** The report, after checking that the host would accept it. */
function accepted(report: CompositionReport): CompositionReport {
  const parsed = parseReport(report)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.problems.join('\n'))
  return report
}
const analyzeFixture = async (path: string) =>
  accepted(analyzeAtlas(await readFile(join(fixtures, path), 'utf8')))
const rows = (report: CompositionReport) =>
  report.subresources.map((each) => [each.key, each.kind, each.name, each.parent])
const messages = (report: CompositionReport) => report.diagnostics.map((each) => each.message)

test('a 4.x atlas: pages, the regions on them and the page images', async () => {
  const report = await analyzeFixture('basic/hero.atlas')
  assert.deepEqual(rows(report), [
    ['pages/0', '页面', 'hero.png', undefined],
    ['pages/1', '页面', 'hero_2.png', undefined],
    ['regions/0', '区域', 'torso', 'pages/0'],
    ['regions/1', '区域', 'head-front', 'pages/0'],
    ['regions/2', '区域', 'head-blink01', 'pages/0'],
    ['regions/3', '区域', 'head-blink02', 'pages/0'],
    ['regions/4', '区域', 'head-blink03', 'pages/0'],
    ['regions/5', '区域', 'arm', 'pages/0'],
    ['regions/6', '区域', 'cape', 'pages/1'],
    ['regions/7', '区域', 'cape-armored', 'pages/1'],
    ['regions/8', '区域', 'helmet', 'pages/1'],
  ])
  assert.deepEqual(report.references, [
    { from: 'pages/0', uri: 'hero.png', role: '贴图页', evidence: '第 1 行' },
    { from: 'pages/1', uri: 'hero_2.png', role: '贴图页', evidence: '第 20 行' },
  ])
  assert.deepEqual(report.diagnostics, [])
  assert.equal(report.partial, undefined)
})

test('the 3.x syntax: a leading blank line, indented xy/size/orig/offset and index -1', async () => {
  const report = await analyzeFixture('legacy/goblin.atlas')
  assert.deepEqual(rows(report), [
    ['pages/0', '页面', 'goblin.png', undefined],
    ['regions/0', '区域', 'body', 'pages/0'],
    ['regions/1', '区域', 'head', 'pages/0'],
  ])
  assert.deepEqual(report.references, [
    { from: 'pages/0', uri: 'goblin.png', role: '贴图页', evidence: '第 2 行' },
  ])
  assert.deepEqual(report.diagnostics, [])
})

test('page names are file names: % ? and # are encoded so the host reads them as written', async () => {
  const report = await analyzeFixture('layout/atlases/props.atlas')
  assert.deepEqual(
    report.references.map((each) => each.uri),
    ['../textures/props sheet.png', '../textures/badge %231 100%25.png'],
  )
  // The display name stays as written.
  assert.equal(report.subresources[1]?.name, '../textures/badge #1 100%.png')
})

test('frames and duplicates: index is part of the name; a repeated name and index is a warning', async () => {
  const report = await analyzeFixture('problems/duplicate-region.atlas')
  assert.deepEqual(
    report.subresources.map((each) => each.name),
    ['present.png', 'a', 'a', 'b（帧 1）', 'b（帧 2）'],
  )
  assert.deepEqual(report.diagnostics, [
    {
      severity: 'warning',
      message: '第 5 行的区域 a 与第 3 行重名，Spine 只会使用第一个。',
      key: 'regions/1',
    },
  ])
})

test('a missing page image is still reported; the host decides it is missing', async () => {
  const report = await analyzeFixture('problems/missing-page.atlas')
  assert.deepEqual(
    report.references.map((each) => each.uri),
    ['present.png', 'absent.png'],
  )
})

test('a truncated atlas keeps what it has and says what is wrong', async () => {
  const report = await analyzeFixture('problems/truncated.atlas')
  assert.equal(report.subresources.length, 3)
  assert.deepEqual(messages(report), [
    '第 6 行区域字段 bounds 的值不是 4 个数字。',
    '第 5 行的区域 b 没有位置（bounds 或 xy）。',
  ])
})

test('text that is not an atlas fails with the reason', async () => {
  const text = await readFile(join(fixtures, 'problems/not-an-atlas.atlas'), 'utf8')
  assert.throws(
    () => analyzeAtlas(text),
    (error) =>
      error instanceof SpineError &&
      error.message ===
        '不是 Spine 或 libGDX 图集：第 1 行的页面名后面应当是页面字段（例如 size: 1024, 512）。',
  )
  assert.throws(() => analyzeAtlas(''), /图集中没有任何页面/)
  assert.throws(() => analyzeAtlas('\n\n  \n'), /图集中没有任何页面/)
})

test('CRLF, a byte order mark, unknown fields and fields before the first page', () => {
  const report = accepted(
    analyzeAtlas(
      '﻿version: 9\r\n\r\npage.png\r\nsize: 8, 8\r\nmystery: 1\r\nscale: 0.5\r\nr\r\nbounds: 0, 0, 4, 4\r\norigin: 2, 2\r\n',
    ),
  )
  assert.deepEqual(
    report.subresources.map((each) => each.name),
    ['page.png', 'r'],
  )
  // Unknown region fields are Spine's name/value pairs and pass without comment.
  assert.deepEqual(messages(report), [
    '第 1 行的字段 version 在第一个页面之前，已忽略。',
    '第 5 行的页面字段 mystery 无法识别。',
  ])
})

test('names are plain text and overlong page names are not listed', () => {
  const long = `${'x'.repeat(limits.uri + 10)}.png`
  const report = accepted(
    analyzeAtlas(`${long}\nsize: 8, 8\nline\u0007break\nbounds: 0, 0, 1, 1\n`),
  )
  assert.equal(report.references.length, 0)
  assert.match(messages(report)[0]!, /页面文件名超过 2048 个字符，没有列出/)
  assert.equal(report.subresources[0]?.name.length, limits.name)
  assert.equal(report.subresources[1]?.name, 'line break')
})

test('a very large atlas gives a partial report that keeps every page', () => {
  const lines: string[] = []
  for (let page = 0; page < 3; page++) {
    lines.push(`page-${page}.png`, 'size: 4096, 4096')
    for (let region = 0; region < 4000; region++)
      lines.push(`region-${page}-${region}`, `bounds: 0, 0, 1, 1`)
    lines.push('')
  }
  const report = accepted(analyzeAtlas(lines.join('\n')))
  assert.equal(report.partial, true)
  assert.equal(report.subresources.length, limits.subresources)
  assert.equal(report.subresources.filter((each) => each.kind === '页面').length, 3)
  assert.equal(report.references.length, 3)
  assert.ok(serializedSize(report) <= limits.size)
  assert.match(messages(report).at(-1)!, /对象超过 10,000 个/)
})
