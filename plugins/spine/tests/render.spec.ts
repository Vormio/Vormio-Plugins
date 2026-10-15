// Runs the built thumbnail and viewer pages in Chromium against the fixtures, under the host's page
// CSP, with a fake bridge (see shared/testing). Needs `node scripts/build.ts` first.

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import {
  focusSubresource,
  installBridge,
  pageUrl,
  pixelStats,
  requestThumbnail,
  switchInput,
  viewerOutcome,
} from '../../../shared/testing/pages.ts'
import { fitView } from '../src/view.ts'

const root = join(import.meta.dirname, '../../..')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/spine'), join(root, 'fixtures/spine'))
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
  await page.goto(pageUrl(host.pluginOrigin, 'thumbnail.html'))
  const result = await requestThumbnail(page, await host.input(path))
  expect(result.error, path).toBeUndefined()
  return pixelStats(page, result.png!)
}

async function openViewer(page: Page, path: string) {
  const input = await host.input(path)
  await page.goto(pageUrl(host.pluginOrigin, 'viewer.html', input))
  return { input, outcome: await viewerOutcome(page, input.url) }
}

/** Statistics of what the viewer's canvas shows. */
async function canvasStats(page: Page) {
  const png = (await page.locator('#view').screenshot()).toString('base64')
  return pixelStats(page, png)
}

const regionButtons = (page: Page) => page.locator('#regions button')

test.describe('thumbnails', () => {
  test('the first page, scaled to fit with its proportions', async ({ page }) => {
    const stats = await thumbnailOf(page, 'basic/hero.atlas')
    expect([stats.width, stats.height]).toEqual([320, 160])
    expect(stats.opaque).toBeGreaterThan(0.99)
    expect(stats.hues.blue).toBeGreaterThan(0.9)
    // Only the atlas and its first page are read.
    expect(host.requests).toEqual(['200 basic/hero.atlas', '200 basic/hero.png'])
  })

  test('the 3.x syntax and a page in another folder', async ({ page }) => {
    const goblin = await thumbnailOf(page, 'legacy/goblin.atlas')
    expect([goblin.width, goblin.height]).toEqual([320, 320])
    expect(goblin.hues.green).toBeGreaterThan(0.9)
    const props = await thumbnailOf(page, 'layout/atlases/props.atlas')
    expect(props.hues.yellow).toBeGreaterThan(0.9)
    expect(host.requests).toContain('200 layout/textures/props sheet.png')
  })

  test('a page that cannot be read is skipped; none at all fails with the reason', async ({
    page,
  }) => {
    const stats = await thumbnailOf(page, 'problems/missing-page.atlas')
    expect(stats.opaque).toBeGreaterThan(0.99)
    await page.goto(pageUrl(host.pluginOrigin, 'thumbnail.html'))
    const result = await requestThumbnail(page, await host.input('problems/no-images.atlas'))
    expect(result.error).toBe('贴图页都无法显示：absent.png（文件不存在）')
    const text = await requestThumbnail(page, await host.input('problems/not-an-atlas.atlas'))
    expect(text.error).toMatch(/^不是 Spine 或 libGDX 图集/)
  })
})

test.describe('viewer', () => {
  test('shows the first page with its regions, and lists every region', async ({ page }) => {
    const { outcome } = await openViewer(page, 'basic/hero.atlas')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('页面 1/2 · hero.png · 128 × 64 · 6 个区域')
    await expect(page.locator('#page')).toBeVisible()
    await expect(regionButtons(page)).toHaveCount(9)
    const stats = await canvasStats(page)
    expect(stats.hues.blue).toBeGreaterThan(0.2)
    // Region boxes are drawn in orange over the page.
    expect(stats.hues.orange).toBeGreaterThan(0.001)
    // The second page is read only when it is shown.
    expect(host.requests).toEqual(['200 basic/hero.atlas', '200 basic/hero.png'])
  })

  test('choosing a region in the list shows its page and selects it', async ({ page }) => {
    await openViewer(page, 'basic/hero.atlas')
    await regionButtons(page).filter({ hasText: 'cape-armored' }).click()
    await expect(page.locator('#page')).toHaveValue('1')
    await expect(page.locator('#info')).toHaveText('页面 2/2 · hero_2.png · 64 × 64 · 3 个区域')
    await expect(page.locator('#detail')).toHaveText('cape-armored · 40 × 40 · 位置 2, 2')
    await expect(regionButtons(page).filter({ hasText: 'cape-armored' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect((await canvasStats(page)).hues.red).toBeGreaterThan(0.2)
    expect(host.requests).toContain('200 basic/hero_2.png')
  })

  test('the host focuses a region or a page by its key in the atlas report', async ({ page }) => {
    const { input } = await openViewer(page, 'basic/hero.atlas')
    const current = (name: string) =>
      expect(regionButtons(page).filter({ hasText: name })).toHaveAttribute('aria-current', 'true')
    // A region on another page: the page is switched to and the region selected and framed.
    await focusSubresource(page, input.url, 'region:helmet')
    await expect(page.locator('#page')).toHaveValue('1')
    await expect(page.locator('#detail')).toHaveText('helmet · 18 × 32 · 位置 44, 2')
    await current('helmet')
    // A search that hides the region is cleared, so the list shows it.
    await page.locator('#search').fill('cape')
    await focusSubresource(page, input.url, 'region:head-front')
    await expect(page.locator('#search')).toHaveValue('')
    await expect(page.locator('#page')).toHaveValue('0')
    await current('head-front')
    // A page key switches to the page; keys that are not in the atlas and other files are ignored.
    await focusSubresource(page, input.url, 'pages/1')
    await expect(page.locator('#info')).toHaveText('页面 2/2 · hero_2.png · 64 × 64 · 3 个区域')
    await expect(page.locator('#detail')).toHaveText('')
    await focusSubresource(page, input.url, 'region:absent')
    await focusSubresource(page, `${input.url}x`, 'region:torso')
    await expect(page.locator('#info')).toHaveText('页面 2/2 · hero_2.png · 64 × 64 · 3 个区域')
    await expect(page.locator('#regions button[aria-current="true"]')).toHaveCount(0)
    // The same key again shows it again.
    await focusSubresource(page, input.url, 'region:helmet')
    await current('helmet')
    await focusSubresource(page, input.url, 'region:helmet')
    await current('helmet')
  })

  test('a later region of the same name is focused by its position', async ({ page }) => {
    const { input } = await openViewer(page, 'problems/duplicate-region.atlas')
    await focusSubresource(page, input.url, 'regions/1')
    await expect(page.locator('#detail')).toHaveText('a · 8 × 8 · 位置 8, 0')
    await focusSubresource(page, input.url, 'region:a')
    await expect(page.locator('#detail')).toHaveText('a · 8 × 8 · 位置 0, 0')
  })

  test('clicking a region on the canvas selects it; search narrows the list', async ({ page }) => {
    await openViewer(page, 'basic/hero.atlas')
    const canvas = page.locator('#view')
    const box = (await canvas.boundingBox())!
    // The same fitting as the viewer: the page is 128 × 64; head-front is at 34, 2, 30 × 30.
    const view = fitView({ width: 128, height: 64 }, { width: box.width, height: box.height })
    await canvas.click({ position: { x: view.x + 49 * view.scale, y: view.y + 17 * view.scale } })
    await expect(page.locator('#detail')).toHaveText('head-front · 30 × 30 · 位置 34, 2')
    // The rotated arm reports its size before rotation.
    await canvas.click({ position: { x: view.x + 86 * view.scale, y: view.y + 40 * view.scale } })
    await expect(page.locator('#detail')).toHaveText('arm · 12 × 40 · 位置 66, 34 · 旋转 90°')
    await page.locator('#search').fill('blink')
    await expect(regionButtons(page)).toHaveCount(3)
    await page.locator('#search').fill('nothing')
    await expect(page.locator('#more')).toHaveText('没有符合的区域。')
  })

  test('region boxes can be hidden and the view fitted again', async ({ page }) => {
    await openViewer(page, 'basic/hero.atlas')
    await page.locator('#view').focus()
    await page.keyboard.press('b')
    await expect(page.locator('#boxes')).toHaveAttribute('aria-pressed', 'false')
    expect((await canvasStats(page)).hues.orange).toBeLessThan(0.0005)
    await page.locator('#boxes').click()
    await expect(page.locator('#boxes')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#fit')).toBeEnabled()
  })

  test('page names with a space, # and % are read from another folder', async ({ page }) => {
    await openViewer(page, 'layout/atlases/props.atlas')
    await page.locator('#page').selectOption('1')
    await expect(page.locator('#info')).toContainText('badge #1 100%.png')
    await expect(page.locator('#warnings')).toBeHidden()
    expect(host.requests).toContain('200 layout/textures/badge #1 100%.png')
  })

  test('a page image that cannot be read shows its boxes and the reason', async ({ page }) => {
    const { outcome } = await openViewer(page, 'problems/no-images.atlas')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toHaveText(
      '贴图页无法显示，只显示区域框：absent.png（文件不存在）',
    )
    await expect(page.locator('#info')).toHaveText('absent.png · 16 × 16 · 1 个区域')
    await expect(page.locator('#page')).toBeHidden()
  })

  test('text that is not an atlas fails with the reason', async ({ page }) => {
    const { outcome } = await openViewer(page, 'problems/not-an-atlas.atlas')
    expect(outcome.ready).toBe(false)
    expect(outcome.message).toMatch(/^不是 Spine 或 libGDX 图集/)
  })

  test('moving to another atlas replaces everything', async ({ page }) => {
    await openViewer(page, 'basic/hero.atlas')
    await regionButtons(page).first().click()
    const next = await host.input('legacy/goblin.atlas')
    await switchInput(page, next)
    await viewerOutcome(page, next.url)
    await expect(page.locator('#info')).toHaveText('goblin.png · 64 × 64 · 2 个区域')
    await expect(regionButtons(page)).toHaveCount(2)
    await expect(page.locator('#detail')).toHaveText('')
    await expect(page.locator('#page')).toBeHidden()
    expect((await canvasStats(page)).hues.green).toBeGreaterThan(0.2)
  })
})
