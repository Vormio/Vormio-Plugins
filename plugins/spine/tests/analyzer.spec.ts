// Runs the built analyzer page in Chromium against the fixtures, under the host's page CSP, with a
// fake bridge (see shared/testing). Needs `node scripts/build.ts` first.

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseReport } from '@vormio/plugin-sdk'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import { installBridge, pageUrl, requestAnalysis } from '../../../shared/testing/pages.ts'
import { analyzeAtlas } from '../src/atlas.ts'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'

const root = join(import.meta.dirname, '../../..')
const fixtures = join(root, 'fixtures/spine')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/spine'), fixtures)
})
test.afterAll(() => host.close())
test.beforeEach(async ({ page }) => {
  host.requests.length = 0
  await installBridge(page)
  await page.goto(pageUrl(host.pluginOrigin, 'analyzer.html'))
})
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.bridgeState.violations)).toEqual([])
})

/** What the analysis of `path` should be: the same functions run in Node on the file. */
async function expected(path: string) {
  const text = await readFile(join(fixtures, path), 'utf8')
  const report = path.endsWith('.json')
    ? analyzeSkeleton(readSkeletonJson(text), basename(path))
    : analyzeAtlas(text)
  return JSON.parse(JSON.stringify(report))
}

async function analyze(page: Page, path: string) {
  const result = await requestAnalysis(page, await host.input(path))
  expect(result.error, path).toBeUndefined()
  const parsed = parseReport(result.report)
  expect(parsed.ok ? [] : parsed.problems, path).toEqual([])
  return result.report!
}

test('an atlas is analyzed from its text; the page images are not read', async ({ page }) => {
  const report = await analyze(page, 'basic/hero.atlas')
  expect(report).toEqual(await expected('basic/hero.atlas'))
  expect(host.requests).toEqual(['200 basic/hero.atlas'])
})

test('atlases in both syntaxes and with encoded page names', async ({ page }) => {
  for (const path of ['legacy/goblin.atlas', 'layout/atlases/props.atlas'])
    expect(await analyze(page, path), path).toEqual(await expected(path))
})

test('a JSON skeleton is analyzed from its text alone', async ({ page }) => {
  for (const path of ['basic/hero.json', 'legacy/goblin.json', 'preview/knight.json'])
    expect(await analyze(page, path), path).toEqual(await expected(path))
  // The atlas of the same name comes from the file name the host gives; it is not read.
  const report = await analyze(page, 'preview/hero.json')
  expect(report.references.filter((each) => each.uri !== undefined)).toEqual([
    { uri: 'hero.atlas', role: '图集', inferred: '与骨骼文件同名' },
  ])
  expect(host.requests).toEqual([
    '200 basic/hero.json',
    '200 legacy/goblin.json',
    '200 preview/knight.json',
    '200 preview/hero.json',
  ])
})

test('JSON that is not a Spine skeleton is not applicable', async ({ page }) => {
  // An object, an object whose `skeleton` is no skeleton, an array, and text that is not JSON.
  const paths = [
    'problems/not-spine.json',
    'preview/settings.json',
    'preview/table.json',
    'preview/notes.json',
  ]
  for (const path of paths)
    expect(await requestAnalysis(page, await host.input(path)), path).toEqual({
      notApplicable: true,
    })
  expect(host.requests).toEqual(paths.map((path) => `200 ${path}`))
})

test('analyses that overlap on one page do not mix', async ({ page }) => {
  const [atlas, skeleton] = await Promise.all([
    host.input('basic/hero.atlas'),
    host.input('basic/hero.json'),
  ])
  const [first, second] = await Promise.all([
    requestAnalysis(page, atlas),
    requestAnalysis(page, skeleton),
  ])
  expect(first.report).toEqual(await expected('basic/hero.atlas'))
  expect(second.report).toEqual(await expected('basic/hero.json'))
})

test('files that cannot be analyzed fail with the reason', async ({ page }) => {
  // A Spine skeleton too old to analyze is Spine, so it fails rather than being not applicable.
  const cases: [string, RegExp][] = [
    ['problems/not-an-atlas.atlas', /^不是 Spine 或 libGDX 图集：第 1 行/],
    ['problems/spine-3.7.json', /^不支持 Spine 3\.7\.94 的骨骼文件/],
  ]
  for (const [path, message] of cases) {
    const result = await requestAnalysis(page, await host.input(path))
    expect(result.error, path).toMatch(message)
  }
  // A JSON file that cannot be read fails too: whether it is Spine is unknown.
  for (const path of ['basic/hero.atlas', 'problems/not-spine.json']) {
    const input = await host.input(path)
    const result = await requestAnalysis(page, { ...input, url: `${input.url}.gone` })
    expect(result.error, path).toBe('无法读取这个文件。')
  }
})
