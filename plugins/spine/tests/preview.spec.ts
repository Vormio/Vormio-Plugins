// Runs the built thumbnail and viewer pages in Chromium against the fixtures, under the host's page
// CSP, with a fake bridge (see shared/testing). Needs `node scripts/build.ts` first. The figure in
// fixtures/spine/preview has one colour per attachment, so the colours show what was drawn: in
// hero.skel and hero.json the body is blue, the head green, the arm yellow and the armored skin's
// helmet red.

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import {
  installBridge,
  pageUrl,
  pixelDifference,
  pixelStats,
  requestThumbnail,
  switchInput,
  viewerOutcome,
} from '../../../shared/testing/pages.ts'

const root = join(import.meta.dirname, '../../..')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/spine'), join(root, 'fixtures/spine/preview'))
})
test.afterAll(() => host.close())
test.beforeEach(async ({ page }) => {
  host.requests.length = 0
  await installBridge(page)
})
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.bridgeState.violations)).toEqual([])
})

async function thumbnailOf(page: Page, path: string) {
  await page.goto(pageUrl(host.pluginOrigin, 'skeleton-thumbnail.html'))
  return requestThumbnail(page, await host.input(path))
}

async function openViewer(page: Page, path: string) {
  const input = await host.input(path)
  await page.goto(pageUrl(host.pluginOrigin, 'skeleton-viewer.html', input))
  return { input, outcome: await viewerOutcome(page, input.url) }
}

/** What the viewer's canvas shows, as a PNG in base64. */
const canvasPng = async (page: Page) =>
  (await page.locator('#view').screenshot()).toString('base64')
const canvasStats = async (page: Page) => pixelStats(page, await canvasPng(page))

test.describe('thumbnails', () => {
  test('the setup pose of a 4.2 skeleton, framed with its proportions', async ({ page }) => {
    const result = await thumbnailOf(page, 'hero.skel')
    expect(result.error).toBeUndefined()
    const stats = await pixelStats(page, result.png!)
    // The figure is 64 × 80 units, with a small margin.
    expect([stats.width, stats.height]).toEqual([258, 320])
    expect(stats.cornerAlpha).toBe(0)
    expect(stats.hues.blue).toBeGreaterThan(0.2)
    expect(stats.hues.green).toBeGreaterThan(0.1)
    expect(stats.hues.yellow).toBeGreaterThan(0.05)
    expect(stats.hues.red).toBeLessThan(0.001)
    // The skeleton, its atlas and the atlas's page; nothing else.
    expect(host.requests).toEqual(['200 hero.skel', '200 hero.atlas', '200 hero.png'])
  })

  test('a 4.3 skeleton is drawn by the 4.3 runtime', async ({ page }) => {
    const result = await thumbnailOf(page, 'knight.skel')
    expect(result.error).toBeUndefined()
    const stats = await pixelStats(page, result.png!)
    expect(stats.hues.purple).toBeGreaterThan(0.2)
    expect(stats.hues.orange).toBeGreaterThan(0.1)
    expect(stats.hues.green).toBeGreaterThan(0.05)
  })

  test('a JSON skeleton is drawn like the binary one, with the same atlas', async ({ page }) => {
    const json = await thumbnailOf(page, 'hero.json')
    expect(json.error).toBeUndefined()
    expect(host.requests).toEqual(['200 hero.json', '200 hero.atlas', '200 hero.png'])
    const binary = await requestThumbnail(page, await host.input('hero.skel'))
    expect(await pixelDifference(page, json.png!, binary.png!)).toBeLessThan(0.001)
    const knight = await requestThumbnail(page, await host.input('knight.json'))
    const stats = await pixelStats(page, knight.png!)
    expect(stats.hues.purple).toBeGreaterThan(0.2)
    expect(stats.hues.orange).toBeGreaterThan(0.1)
  })

  test('JSON that is not a skeleton is not applicable, from the file alone', async ({ page }) => {
    await page.goto(pageUrl(host.pluginOrigin, 'skeleton-thumbnail.html'))
    const paths = ['settings.json', 'table.json', 'notes.json']
    for (const path of paths)
      expect(await requestThumbnail(page, await host.input(path)), path).toEqual({
        notApplicable: true,
      })
    // No atlas is looked for before answering.
    expect(host.requests).toEqual(paths.map((path) => `200 ${path}`))
    // The same page goes on drawing skeletons.
    expect((await requestThumbnail(page, await host.input('hero.json'))).error).toBeUndefined()
  })

  test('each problem fails with its reason', async ({ page }) => {
    await page.goto(pageUrl(host.pluginOrigin, 'skeleton-thumbnail.html'))
    const failure = async (path: string) =>
      (await requestThumbnail(page, await host.input(path))).error
    expect(await failure('orphan.skel')).toBe('找不到同名图集 orphan.atlas（文件不存在）')
    expect(await failure('torn.skel')).toBe('贴图页无法读取：torn.png（文件不存在）')
    expect(await failure('spine-4.1.skel')).toBe(
      'Spine 4.1.24 的数据：插件只包含 Spine 4.2 与 4.3 的运行时。',
    )
    expect(await failure('spine-3.8.skel')).toBe(
      'Spine 3.8.99 的数据：插件只包含 Spine 4.2 与 4.3 的运行时。',
    )
    // A JSON skeleton of another version is Spine, so it fails rather than being not applicable.
    expect(await failure('spine-3.8.json')).toBe(
      'Spine 3.8.99 的数据：插件只包含 Spine 4.2 与 4.3 的运行时。',
    )
    expect(await failure('truncated.skel')).toMatch(/^Spine 运行时无法读取这个骨骼：/)
    expect(await failure('empty.skel')).toBe('骨骼在初始姿势下没有可见的附件。')
    expect(await failure('hero.png')).toBe('不是 Spine 的二进制骨骼文件：文件开头没有 Spine 版本。')
  })
})

test.describe('viewer', () => {
  test('plays the first animation and describes the skeleton', async ({ page }) => {
    const { outcome } = await openViewer(page, 'hero.skel')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 4.2.43 · 4 根骨骼 · 3 个插槽')
    await expect(page.locator('#animation')).toHaveValue('wave')
    await expect(page.locator('#play')).toHaveText('暂停')
    await expect(page.locator('#detail')).toContainText('wave · ')
    await expect(page.locator('#license')).toHaveText(
      '包含 Spine Runtimes：每个使用者都需要自己的 Spine Editor 许可证',
    )
    await expect(page.locator('#skin')).toBeVisible()
    await expect(page.locator('#warnings')).toBeHidden()
    const stats = await canvasStats(page)
    expect(stats.hues.blue).toBeGreaterThan(0.005)
    expect(stats.hues.green).toBeGreaterThan(0.003)
    expect(stats.hues.yellow).toBeGreaterThan(0.001)
    // The arm moves while the animation plays, and stays still once paused.
    const before = await canvasPng(page)
    await page.waitForTimeout(300)
    expect(await pixelDifference(page, before, await canvasPng(page))).toBeGreaterThan(0.0005)
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveText('播放')
    const paused = await canvasPng(page)
    await page.waitForTimeout(300)
    expect(await pixelDifference(page, paused, await canvasPng(page))).toBe(0)
  })

  test('switching the skin swaps the head for the helmet', async ({ page }) => {
    await openViewer(page, 'hero.skel')
    await page.locator('#skin').selectOption('armored')
    await expect(page.locator('#skin')).toHaveValue('armored')
    const stats = await canvasStats(page)
    expect(stats.hues.red).toBeGreaterThan(0.003)
    expect(stats.hues.green).toBeLessThan(0.0005)
  })

  test('the setup pose has nothing to play; space plays and pauses an animation', async ({
    page,
  }) => {
    await openViewer(page, 'hero.skel')
    await page.locator('#animation').selectOption('')
    await expect(page.locator('#detail')).toHaveText('初始姿势')
    await expect(page.locator('#play')).toBeDisabled()
    await page.locator('#animation').selectOption('blink')
    await expect(page.locator('#play')).toHaveText('暂停')
    await page.locator('#view').focus()
    await page.keyboard.press(' ')
    await expect(page.locator('#play')).toHaveText('播放')
    await expect(page.locator('#fit')).toBeEnabled()
  })

  test('a page that cannot be read leaves its attachments out, with the reason', async ({
    page,
  }) => {
    const { outcome } = await openViewer(page, 'torn.skel')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toContainText(
      '贴图页无法读取，用到它的附件不显示：torn.png（文件不存在）',
    )
  })

  test('a JSON skeleton shows like the binary one', async ({ page }) => {
    const { outcome } = await openViewer(page, 'knight.json')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 4.3.13 · 4 根骨骼 · 3 个插槽')
    await expect(page.locator('#animation')).toHaveValue('wave')
    await expect(page.locator('#play')).toHaveText('暂停')
    expect((await canvasStats(page)).hues.purple).toBeGreaterThan(0.005)
  })

  test('JSON that is not a skeleton is not applicable while the page stays hidden', async ({
    page,
  }) => {
    const { outcome } = await openViewer(page, 'settings.json')
    expect(outcome).toEqual({ ready: false, notApplicable: true })
    expect(await page.evaluate(() => document.hidden)).toBe(true)
    expect(host.requests).toEqual(['200 settings.json'])
    // The host may move the same page on to a skeleton, and on again to JSON that is not one.
    const skeleton = await host.input('hero.json')
    await switchInput(page, skeleton)
    expect(await viewerOutcome(page, skeleton.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 4.2.43 · 4 根骨骼 · 3 个插槽')
    const table = await host.input('table.json')
    await switchInput(page, table)
    expect(await viewerOutcome(page, table.url)).toEqual({ ready: false, notApplicable: true })
    await expect(page.locator('#info')).toHaveText('')
    await expect(page.locator('#animation')).toBeDisabled()
  })

  test('a skeleton without its atlas fails with the reason', async ({ page }) => {
    const { outcome } = await openViewer(page, 'orphan.skel')
    expect(outcome).toEqual({ ready: false, message: '找不到同名图集 orphan.atlas（文件不存在）' })
  })

  test('moving to a 4.3 skeleton replaces everything', async ({ page }) => {
    await openViewer(page, 'hero.skel')
    await page.locator('#skin').selectOption('armored')
    const next = await host.input('knight.skel')
    await switchInput(page, next)
    expect(await viewerOutcome(page, next.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 4.3.13 · 4 根骨骼 · 3 个插槽')
    await expect(page.locator('#skin')).toHaveValue('default')
    const stats = await canvasStats(page)
    expect(stats.hues.purple).toBeGreaterThan(0.005)
    expect(stats.hues.blue).toBeLessThan(0.0005)
  })
})
