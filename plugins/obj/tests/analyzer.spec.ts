// Runs the built analyzer page in Chromium against the fixtures, under the host's page CSP, with a
// fake bridge (see shared/testing). Needs `node scripts/build.ts` first.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseReport } from '@vormio/plugin-sdk'
import { expect, test, type Page } from '@playwright/test'
import { analyzeMtl } from '../src/mtl-file.ts'
import { analyzeObj } from '../src/obj-file.ts'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import { installBridge, pageUrl, requestAnalysis } from '../../../shared/testing/pages.ts'

const root = join(import.meta.dirname, '../../..')
const fixtures = join(root, 'fixtures/obj')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/obj'), fixtures)
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

async function analyze(page: Page, path: string) {
  const result = await requestAnalysis(page, await host.input(path))
  expect(result.error, path).toBeUndefined()
  const parsed = parseReport(result.report)
  expect(parsed.ok ? [] : parsed.problems, path).toEqual([])
  return result.report!
}

test('OBJ and MTL reports match the analysis in Node; only the file itself is read', async ({
  page,
}) => {
  for (const path of [
    'basic/table.obj',
    'layout/model/crate.obj',
    'problems/bad-index.obj',
    'no-material/marker.obj',
  ]) {
    host.requests.length = 0
    const text = await readFile(join(fixtures, path), 'utf8')
    expect(await analyze(page, path), path).toEqual(JSON.parse(JSON.stringify(analyzeObj(text))))
    expect(host.requests, path).toEqual([`200 ${path}`])
  }
  for (const path of [
    'basic/table.mtl',
    'layout/materials/paint.mtl',
    'problems/library-issues.mtl',
  ]) {
    const text = await readFile(join(fixtures, path), 'utf8')
    expect(await analyze(page, path), path).toEqual(JSON.parse(JSON.stringify(analyzeMtl(text))))
  }
})

test('compiled object files and text without OBJ statements are not applicable', async ({
  page,
}) => {
  for (const path of [
    'not-obj/compiled-msvc.obj',
    'not-obj/compiled-gcc.obj',
    'not-obj/notes.obj',
  ]) {
    const result = await requestAnalysis(page, await host.input(path))
    expect(result, path).toEqual({ notApplicable: true })
  }
})

test('overlapping analyses do not mix', async ({ page }) => {
  const [table, crate] = await Promise.all([
    host.input('basic/table.obj'),
    host.input('layout/model/crate.obj'),
  ])
  const results = await page.evaluate(
    ([a, b]) =>
      Promise.all([window.bridgeState.analyze!(a), window.bridgeState.analyze!(b)]).then((each) =>
        JSON.parse(JSON.stringify(each)),
      ),
    [table, crate] as const,
  )
  expect(results[0].references[0].uri).toBe('table.mtl')
  expect(results[1].references[0].uri).toBe('base.mtl')
})
