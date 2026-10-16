// Runs the built viewer and thumbnail pages in Chromium against the fixtures, under the host's page
// CSP, with a fake bridge (see shared/testing). Needs `node scripts/build.ts` first.

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import {
  installBridge,
  pageUrl,
  pixelStats,
  requestThumbnail,
  switchInput,
  viewerOutcome,
} from '../../../shared/testing/pages.ts'
import { focusSubresource, pixelDifference } from '../../../shared/testing/pages.ts'

const root = join(import.meta.dirname, '../../..')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/obj'), join(root, 'fixtures/obj'))
})
test.afterAll(() => host.close())
test.beforeEach(async ({ page }) => {
  host.requests.length = 0
  await installBridge(page)
})
test.afterEach(async ({ page }) => {
  // The pages work entirely within the CSP: nothing they do is blocked.
  expect(await page.evaluate(() => window.bridgeState.violations)).toEqual([])
})

async function thumbnailOf(page: Page, path: string) {
  const result = await requestThumbnail(page, await host.input(path))
  expect(result.error, path).toBeUndefined()
  expect(result.notApplicable, path).toBeUndefined()
  return pixelStats(page, result.png!)
}

async function openViewer(page: Page, path: string) {
  const input = await host.input(path)
  await page.goto(pageUrl(host.pluginOrigin, 'viewer.html', input))
  return viewerOutcome(page, input.url)
}

/** The canvas once the camera has settled. */
async function settledCanvas(page: Page): Promise<string> {
  let previous = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = (await page.locator('#view').screenshot()).toString('base64')
    if (current === previous) return current
    previous = current
    await page.waitForTimeout(100)
  }
  return previous
}

test.describe('thumbnails', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pageUrl(host.pluginOrigin, 'thumbnail.html'))
  })

  test('a textured model with its library and a texture in a subfolder', async ({ page }) => {
    const stats = await thumbnailOf(page, 'basic/table.obj')
    expect(stats.width).toBe(320)
    expect(stats.cornerAlpha).toBe(0)
    expect(stats.opaque).toBeGreaterThan(0.1)
    expect(stats.hues.orange).toBeGreaterThan(0.02)
    expect(host.requests).toEqual([
      '200 basic/table.obj',
      '200 basic/table.mtl',
      '200 basic/textures/wood grain.png',
    ])
  })

  test('libraries in sibling folders: the later one wins, its textures load next to it', async ({
    page,
  }) => {
    const stats = await thumbnailOf(page, 'layout/model/crate.obj')
    // Body is green from ../materials/paint.mtl, not red from base.mtl.
    expect(stats.hues.green).toBeGreaterThan(0.05)
    expect(stats.hues.red).toBeLessThan(0.005)
    expect(host.requests).toContain('200 layout/textures/stripes #2.png')
  })

  test('TGA and BMP textures', async ({ page }) => {
    const stats = await thumbnailOf(page, 'formats/blocks.obj')
    expect(stats.hues.orange).toBeGreaterThan(0.02)
    expect(stats.hues.green).toBeGreaterThan(0.02)
  })

  test('without materials: vertex colours, or grey', async ({ page }) => {
    const marker = await thumbnailOf(page, 'no-material/marker.obj')
    expect(Object.values(marker.hues).filter((share) => share > 0.005).length).toBeGreaterThan(2)
    const plain = await thumbnailOf(page, 'no-material/plain.obj')
    expect(plain.opaque).toBeGreaterThan(0.1)
    expect(Object.values(plain.hues).reduce((sum, share) => sum + share)).toBeLessThan(0.01)
  })

  test('a missing library, texture or material leaves the part grey', async ({ page }) => {
    for (const path of [
      'problems/missing-library.obj',
      'problems/missing-texture.obj',
      'problems/unknown-material.obj',
    ]) {
      const stats = await thumbnailOf(page, path)
      expect(stats.opaque, path).toBeGreaterThan(0.1)
    }
    // The red of the material stays when its texture is missing; it is not drawn black.
    const textured = await thumbnailOf(page, 'problems/missing-texture.obj')
    expect(textured.hues.red).toBeGreaterThan(0.05)
    expect(host.requests).toContain('404 problems/absent.mtl')
    expect(host.requests).toContain('404 problems/absent.png')
  })

  test('compiled object files and other text are not applicable; broken files fail', async ({
    page,
  }) => {
    for (const path of [
      'not-obj/compiled-msvc.obj',
      'not-obj/compiled-gcc.obj',
      'not-obj/notes.obj',
    ]) {
      const result = await requestThumbnail(page, await host.input(path))
      expect(result, path).toEqual({ notApplicable: true })
    }
    // Only the file itself was read.
    expect(host.requests.every((each) => each.includes('not-obj/'))).toBe(true)
    const truncated = await requestThumbnail(page, await host.input('problems/truncated.obj'))
    expect(truncated.error).toBe('这个文件中没有可以显示的面、线或点。')
  })
})

test.describe('viewer', () => {
  test('shows the model, its triangles and materials, and reports ready', async ({ page }) => {
    expect(await openViewer(page, 'basic/table.obj')).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('60 个三角形 · 2 个材质')
    await expect(page.locator('#warnings')).toBeHidden()
    const stats = await pixelStats(page, await settledCanvas(page))
    expect(stats.hues.orange).toBeGreaterThan(0.01)
  })

  test('lists what could not be loaded and still shows the model', async ({ page }) => {
    expect(await openViewer(page, 'problems/missing-texture.obj')).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toContainText('absent.png（文件不存在）')
    const library = await host.input('problems/missing-library.obj')
    await switchInput(page, library)
    expect(await viewerOutcome(page, library.url)).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toContainText('absent.mtl（文件不存在）')
    await expect(page.locator('#warnings')).toContainText('材质 Paint（材质库中没有定义）')
    const unknown = await host.input('problems/unknown-material.obj')
    await switchInput(page, unknown)
    expect(await viewerOutcome(page, unknown.url)).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toHaveText(/材质 Ghost（材质库中没有定义）/)
    await expect(page.locator('#warnings')).not.toContainText('absent')
  })

  test('the host focuses objects, groups and materials by their keys', async ({ page }) => {
    const input = await host.input('basic/table.obj')
    await page.goto(pageUrl(host.pluginOrigin, 'viewer.html', input))
    expect(await viewerOutcome(page, input.url)).toEqual({ ready: true })
    const focusBox = page.locator('#focus')
    const label = page.locator('#focus-label')
    const before = await settledCanvas(page)
    const amber = async () => {
      const { hues } = await pixelStats(page, await settledCanvas(page))
      return hues.orange + hues.yellow
    }

    // A group: its faces are drawn in the highlight colour and framed; the rest is dimmed.
    await focusSubresource(page, input.url, 'groups/1')
    await expect(label).toHaveText(/^已定位：组 legs-front（\d+ 个面）$/)
    // The wooden top is dimmed and the front legs are amber.
    await expect.poll(amber).toBeGreaterThan(0.03)
    const legs = await settledCanvas(page)
    expect(await pixelDifference(page, before, legs)).toBeGreaterThan(0.02)

    // Keys the file does not have, and keys for another file, change nothing.
    await focusSubresource(page, input.url, 'groups/9')
    await focusSubresource(page, input.url, 'material:Wood')
    await focusSubresource(page, `${input.url}x`, 'objects/0')
    await page.waitForTimeout(300)
    expect(await pixelDifference(page, legs, await settledCanvas(page))).toBeLessThan(0.01)
    await expect(label).toHaveText(/legs-front/)

    // An object and a material, each replacing the one before.
    await focusSubresource(page, input.url, 'objects/0')
    await expect(label).toHaveText(/^已定位：对象 Top（\d+ 个面）$/)
    await focusSubresource(page, input.url, 'materials/1')
    await expect(label).toHaveText('已定位：材质 Metal')
    const metal = await settledCanvas(page)

    // Clearing takes the overlay and the dimming away and keeps the view.
    await page.locator('#focus-clear').click()
    await expect(focusBox).toBeHidden()
    expect(await pixelDifference(page, metal, await settledCanvas(page))).toBeGreaterThan(0.01)

    // R goes back to the starting view and ends the focus.
    await focusSubresource(page, input.url, 'objects/1')
    await expect(focusBox).toBeVisible()
    await page.locator('#view').focus()
    await page.keyboard.press('r')
    await expect(focusBox).toBeHidden()
    expect(await pixelDifference(page, before, await settledCanvas(page))).toBeLessThan(0.01)
  })

  test('answers not applicable for compiled object files, and explains broken files', async ({
    page,
  }) => {
    expect(await openViewer(page, 'not-obj/compiled-msvc.obj')).toEqual({
      ready: false,
      notApplicable: true,
    })
    const outcome = await openViewer(page, 'problems/truncated.obj')
    expect(outcome).toEqual({ ready: false, message: '这个文件中没有可以显示的面、线或点。' })
  })
})
