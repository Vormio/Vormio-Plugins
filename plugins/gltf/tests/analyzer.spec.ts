// Runs the built analyzer page in Chromium against the fixtures, under the host's page CSP, with a
// fake bridge (see host.ts and pages.ts). Needs `node scripts/build.ts` first.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseReport } from '@vormio/plugin-sdk'
import { expect, test, type Page } from '@playwright/test'
import { analyzeGltf } from '../src/analysis.ts'
import { readGltf } from '../src/gltf-file.ts'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import { installBridge, pageUrl, requestAnalysis } from '../../../shared/testing/pages.ts'

const root = join(import.meta.dirname, '../../..')
const fixtures = join(root, 'fixtures/gltf')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/gltf'), fixtures)
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

/** What the analysis of `path` should be: the same function run in Node on the whole file. */
async function expected(path: string) {
  const bytes = await readFile(join(fixtures, path))
  const { json, container } = readGltf(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return JSON.parse(JSON.stringify(analyzeGltf(json, container)))
}

async function analyze(page: Page, path: string) {
  const result = await requestAnalysis(page, await host.input(path))
  expect(result.error, path).toBeUndefined()
  const parsed = parseReport(result.report)
  expect(parsed.ok ? [] : parsed.problems, path).toEqual([])
  return result.report!
}

test('a .gltf is analyzed from its JSON; the files it names are not read', async ({ page }) => {
  const report = await analyze(page, 'props/table.gltf')
  expect(report).toEqual(await expected('props/table.gltf'))
  expect(report.references.filter((each) => each.uri).map((each) => each.uri)).toEqual([
    'table.bin',
    'textures/wood.png',
  ])
  expect(host.requests).toEqual(['200 props/table.gltf'])
})

test('of a GLB only the header and the JSON chunk are read', async ({ page }) => {
  for (const path of ['globe.glb', 'globe-draco.glb', 'globe-meshopt.glb']) {
    host.requests.length = 0
    const report = await analyze(page, path)
    expect(report, path).toEqual(await expected(path))
    expect(host.requests[0], path).toBe(`206 ${path} 0-19`)
    expect(host.requests[1], path).toMatch(new RegExp(`^206 ${path} 20-\\d+$`))
    expect(host.requests, path).toHaveLength(2)
  }
  // The JSON chunk of the globe is small next to its 54 kB of binary data.
  const end = Number(host.requests[1]!.split('-').at(-1))
  expect(end).toBeLessThan(10_000)
})

test('analyses that overlap on one page do not mix', async ({ page }) => {
  const [table, stool] = await Promise.all([
    host.input('props/table.gltf'),
    host.input('props/stool.gltf'),
  ])
  const [first, second] = await Promise.all([
    requestAnalysis(page, table),
    requestAnalysis(page, stool),
  ])
  expect(first.report).toEqual(await expected('props/table.gltf'))
  expect(second.report).toEqual(await expected('props/stool.gltf'))
})

test('a file that cannot be read as glTF 2.0 fails with the reason', async ({ page }) => {
  const cases: [string, RegExp][] = [
    ['problems/truncated.glb', /^GLB 文件不完整：文件头声明 54000 字节，实际只有 2048 字节。$/],
    ['problems/gltf-1.gltf', /^这是 glTF 1\.0 文件，只支持 glTF 2\.0。$/],
  ]
  for (const [path, message] of cases) {
    const result = await requestAnalysis(page, await host.input(path))
    expect(result.error, path).toMatch(message)
  }
  // A truncated GLB is caught from its header: nothing past the first 20 bytes is read.
  expect(host.requests).toContain('206 problems/truncated.glb 0-19')
  expect(host.requests.filter((each) => each.includes('truncated.glb'))).toHaveLength(1)
})

test('files with problems are still analyzed, with diagnostics', async ({ page }) => {
  const missing = await analyze(page, 'problems/missing-buffer.gltf')
  expect(missing.references.find((each) => each.uri)?.uri).toBe('absent.bin')
  const unsupported = await analyze(page, 'problems/unsupported-extension.gltf')
  expect(unsupported.diagnostics.map((each) => each.message).join('\n')).toContain(
    'VORMIO_unsupported_fixture',
  )
})
