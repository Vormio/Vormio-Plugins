// Runs the built viewer and thumbnail pages in Chromium against the fixtures, under the host's page
// CSP, with a fake bridge (see host.ts and pages.ts). Needs `node scripts/build.ts` first.

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import {
  installBridge,
  pageUrl,
  pixelDifference,
  pixelStats,
  requestThumbnail,
  resizeProbe,
  switchInput,
  viewerOutcome,
  type PixelStats,
  type ResizeFrame,
} from '../../../shared/testing/pages.ts'

const root = join(import.meta.dirname, '../../..')
let host: MockHost

test.beforeAll(async () => {
  host = await startHost(join(root, 'dist/gltf'), join(root, 'fixtures/gltf'))
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

async function thumbnailPage(page: Page): Promise<void> {
  await page.goto(pageUrl(host.pluginOrigin, 'thumbnail.html'))
}

async function thumbnailOf(page: Page, path: string) {
  const result = await requestThumbnail(page, await host.input(path))
  expect(result.error).toBeUndefined()
  return { png: result.png!, stats: await pixelStats(page, result.png!) }
}

async function openViewer(page: Page, path: string) {
  const input = await host.input(path)
  await page.goto(pageUrl(host.pluginOrigin, 'viewer.html', input))
  return { input, outcome: await viewerOutcome(page, input.url) }
}

/** How many hue classes cover a visible share of the picture. */
function hueCount(stats: PixelStats): number {
  return Object.values(stats.hues).filter((share) => share > 0.005).length
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
  test('a textured cube, with its buffer and texture read next to it', async ({ page }) => {
    await thumbnailPage(page)
    const { stats } = await thumbnailOf(page, 'cube/cube.gltf')
    expect(stats.width).toBe(320)
    expect(stats.height).toBe(320)
    expect(stats.cornerAlpha).toBe(0)
    expect(stats.opaque).toBeGreaterThan(0.2)
    for (const hue of ['red', 'green', 'blue', 'yellow'] as const)
      expect(stats.hues[hue], hue).toBeGreaterThan(0.01)
    expect(host.requests).toEqual([
      '200 cube/cube.gltf',
      '200 cube/cube.bin',
      '200 cube/textures/quadrants.png',
    ])
  })

  test('companions in sibling folders and with escaped names', async ({ page }) => {
    await thumbnailPage(page)
    const { stats } = await thumbnailOf(page, 'crate/scene/crate.gltf')
    expect(stats.opaque).toBeGreaterThan(0.15)
    expect(stats.hues.orange).toBeGreaterThan(0.1)
    // The loader reads the buffer and the texture at the same time, in either order.
    expect(host.requests[0]).toBe('200 crate/scene/crate.gltf')
    expect(host.requests.slice(1).sort()).toEqual([
      '200 crate/buffers/crate.bin',
      '200 crate/textures/crate color.png',
    ])
  })

  test('GLB with an embedded texture, and the same model with Draco and meshopt geometry', async ({
    page,
  }) => {
    await thumbnailPage(page)
    const plain = await thumbnailOf(page, 'globe.glb')
    // Framed by its vertices, the sphere fills most of the square.
    expect(plain.stats.opaque).toBeGreaterThan(0.5)
    // Half of the eight stripes face the camera.
    expect(hueCount(plain.stats)).toBeGreaterThanOrEqual(4)
    for (const compressed of ['globe-draco.glb', 'globe-meshopt.glb']) {
      const { png } = await thumbnailOf(page, compressed)
      // Quantised geometry moves edges by a pixel at most.
      expect(await pixelDifference(page, plain.png, png), compressed).toBeLessThan(0.03)
    }
  })

  test('a missing texture falls back to the material colour', async ({ page }) => {
    await thumbnailPage(page)
    const { stats } = await thumbnailOf(page, 'problems/missing-texture.gltf')
    expect(stats.opaque).toBeGreaterThan(0.2)
    expect(Object.values(stats.hues).reduce((sum, share) => sum + share)).toBeLessThan(0.01)
    expect(host.requests).toContain('404 problems/textures/absent.png')
  })

  test('files that cannot be shown fail with a reason', async ({ page }) => {
    await thumbnailPage(page)
    const cases: [string, RegExp][] = [
      ['problems/missing-buffer.gltf', /^模型无法加载：absent\.bin（文件不存在）$/],
      ['problems/unsupported-extension.gltf', /VORMIO_unsupported_fixture/],
      ['problems/truncated.glb', /GLB 文件不完整/],
      ['problems/gltf-1.gltf', /只支持 glTF 2\.0/],
    ]
    for (const [path, message] of cases) {
      const result = await requestThumbnail(page, await host.input(path))
      expect(result.error, path).toMatch(message)
    }
  })

  test('jobs that overlap on one page do not mix', async ({ page }) => {
    await thumbnailPage(page)
    const [cube, crate] = await Promise.all([
      host.input('cube/cube.gltf'),
      host.input('crate/scene/crate.gltf'),
    ])
    const [first, second] = await Promise.all([
      requestThumbnail(page, cube),
      requestThumbnail(page, crate),
    ])
    const cubeStats = await pixelStats(page, first.png!)
    const crateStats = await pixelStats(page, second.png!)
    expect(cubeStats.hues.blue).toBeGreaterThan(0.01)
    expect(crateStats.hues.blue).toBe(0)
  })
})

test.describe('viewer', () => {
  test('shows the textured model and reports ready', async ({ page }) => {
    const { outcome } = await openViewer(page, 'cube/cube.gltf')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('12 个三角形')
    await expect(page.locator('#warnings')).toBeHidden()
    const stats = await pixelStats(page, await settledCanvas(page))
    for (const hue of ['red', 'green', 'blue', 'yellow'] as const)
      expect(stats.hues[hue], hue).toBeGreaterThan(0.005)
  })

  test('drag rotates, the wheel zooms, and the buttons frame the model again', async ({ page }) => {
    await openViewer(page, 'globe.glb')
    const canvas = page.locator('#view')
    const box = (await canvas.boundingBox())!
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const start = await settledCanvas(page)
    const startStats = await pixelStats(page, start)

    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x + 160, centre.y + 20, { steps: 8 })
    await page.mouse.up()
    const rotated = await settledCanvas(page)
    expect(await pixelDifference(page, start, rotated)).toBeGreaterThan(0.05)

    await page.mouse.wheel(0, -600)
    const zoomed = await pixelStats(page, await settledCanvas(page))
    const coverage = (stats: typeof zoomed) =>
      Object.values(stats.hues).reduce((sum, share) => sum + share)
    expect(coverage(zoomed)).toBeGreaterThan(coverage(startStats) * 1.3)

    await page.getByRole('button', { name: '适应' }).click()
    const fitted = await pixelStats(page, await settledCanvas(page))
    expect(Math.abs(coverage(fitted) - coverage(startStats))).toBeLessThan(
      coverage(startStats) * 0.15,
    )

    await page.getByRole('button', { name: '重置视角' }).click()
    expect(await pixelDifference(page, start, await settledCanvas(page))).toBeLessThan(0.01)
  })

  test('keeps the model on screen while the view is resized', async ({ page }) => {
    await openViewer(page, 'cube/cube.gltf')
    await settledCanvas(page)
    await page.evaluate(resizeProbe)
    // Like dragging the edge of the view: a series of sizes, one per frame or so.
    for (let step = 1; step <= 12; step++) {
      await page.setViewportSize({ width: 960 - step * 25, height: 600 - step * 10 })
      await page.waitForTimeout(30)
    }
    const frames = await page.evaluate(
      () => (window as unknown as { resizeFrames: ResizeFrame[] }).resizeFrames,
    )
    // The first entry is the observer's initial report, before any resize.
    const resized = frames.slice(1)
    expect(resized.length).toBeGreaterThan(5)
    for (const frame of resized)
      expect(frame.drawn, `${frame.width}×${frame.height}`).toBeGreaterThan(0.1)
  })

  test('moves to the next file on the same page', async ({ page }) => {
    await openViewer(page, 'cube/cube.gltf')
    const globe = await host.input('globe-draco.glb')
    await switchInput(page, globe)
    expect(await viewerOutcome(page, globe.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('2,208 个三角形')
    const stats = await pixelStats(page, await settledCanvas(page))
    expect(hueCount(stats)).toBeGreaterThanOrEqual(4)
  })

  test('lists textures it could not read and still shows the model', async ({ page }) => {
    const { outcome } = await openViewer(page, 'problems/missing-texture.gltf')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#warnings')).toBeVisible()
    await expect(page.locator('#warnings')).toContainText('textures/absent.png（文件不存在）')
  })

  test('plays the first animation, pauses, and goes to a time with the slider', async ({
    page,
  }) => {
    const { outcome } = await openViewer(page, 'animated/robot.glb')
    // Ready without animation frames: the first frame of "Wave" was drawn before reporting.
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('48 个三角形 · 2 段动画')
    await expect(page.locator('#playback')).toBeVisible()
    await expect(page.locator('#clip option')).toHaveText(['Wave（2.00 秒）', '动画 2（1.00 秒）'])
    const play = page.locator('#play')
    await expect(play).toHaveText('暂停')

    // Playing: the picture and the clock keep changing.
    const canvas = page.locator('#view')
    const first = (await canvas.screenshot()).toString('base64')
    await page.waitForTimeout(400)
    const later = (await canvas.screenshot()).toString('base64')
    expect(await pixelDifference(page, first, later)).toBeGreaterThan(0.002)
    await expect(page.locator('#clock')).not.toHaveText('0.00 / 2.00 秒')

    // Paused: nothing moves.
    await play.click()
    await expect(play).toHaveText('播放')
    const paused = await settledCanvas(page)
    await page.waitForTimeout(300)
    expect(await settledCanvas(page)).toBe(paused)

    // The slider: the same time gives the same picture.
    const seek = (time: number) =>
      page.locator('#time').evaluate((input: HTMLInputElement, time) => {
        input.value = String(time)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, time)
    await seek(1)
    await expect(page.locator('#clock')).toHaveText('1.00 / 2.00 秒')
    const bent = await settledCanvas(page)
    await seek(0)
    const straight = await settledCanvas(page)
    expect(await pixelDifference(page, bent, straight)).toBeGreaterThan(0.002)
    await seek(1)
    expect(await pixelDifference(page, bent, await settledCanvas(page))).toBeLessThan(0.001)

    // The space bar plays again; it is not taken from the buttons.
    await canvas.focus()
    await page.keyboard.press(' ')
    await expect(play).toHaveText('暂停')
  })

  test('another clip, reduced motion, and a file without animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openViewer(page, 'animated/robot.glb')
    await expect(page.locator('#play')).toHaveText('播放')
    await expect(page.locator('#clock')).toHaveText('0.00 / 2.00 秒')
    const still = await settledCanvas(page)
    await page.waitForTimeout(300)
    expect(await settledCanvas(page)).toBe(still)

    // The second clip moves only the blue cube; it starts at its own beginning.
    const blueBefore = (await pixelStats(page, still)).hues.blue
    await page.locator('#clip').selectOption('1')
    await expect(page.locator('#clock')).toHaveText('0.00 / 1.00 秒')
    await page.locator('#time').evaluate((input: HTMLInputElement) => {
      input.value = '0.5'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const raised = await pixelStats(page, await settledCanvas(page))
    expect(raised.hues.blue).toBeGreaterThan(0.001)
    expect(Math.abs(raised.hues.blue - blueBefore)).toBeLessThan(blueBefore)

    const cube = await host.input('cube/cube.gltf')
    await switchInput(page, cube)
    expect(await viewerOutcome(page, cube.url)).toEqual({ ready: true })
    await expect(page.locator('#playback')).toBeHidden()
    await expect(page.locator('#info')).toHaveText('12 个三角形')
  })

  test('explains why a file cannot be shown', async ({ page }) => {
    const cases: [string, string][] = [
      ['problems/missing-buffer.gltf', '模型无法加载：absent.bin（文件不存在）'],
      [
        'problems/unsupported-extension.gltf',
        '这个文件需要不支持的 glTF 扩展：VORMIO_unsupported_fixture。',
      ],
      ['problems/truncated.glb', 'GLB 文件不完整'],
      ['problems/gltf-1.gltf', '这是 glTF 1.0 文件，只支持 glTF 2.0。'],
    ]
    for (const [path, message] of cases) {
      const { outcome } = await openViewer(page, path)
      expect(outcome.ready, path).toBe(false)
      expect(outcome.message, path).toContain(message)
    }
  })
})
