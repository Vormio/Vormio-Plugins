// Runs the built thumbnail and viewer pages in Chromium against the fixtures, under the host's page
// CSP, with a fake bridge (see shared/testing). Needs `node scripts/build.ts` first. The figure in
// fixtures/spine/preview has one colour per attachment, so the colours show what was drawn: in
// hero.skel and hero.json the body is blue, the head green, the arm yellow and the armored skin's
// helmet red.

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startHost, type MockHost } from '../../../shared/testing/host.ts'
import {
  focusSubresource,
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

  test('a 3.7 JSON skeleton is drawn by the 3.7 script', async ({ page }) => {
    // wizard.json (3.7): blue body, yellow head, orange arm; skins are an object in 3.7 JSON.
    const result = await thumbnailOf(page, 'wizard.json')
    expect(result.error).toBeUndefined()
    const stats = await pixelStats(page, result.png!)
    expect([stats.width, stats.height]).toEqual([258, 320])
    expect(stats.hues.blue).toBeGreaterThan(0.2)
    expect(stats.hues.yellow).toBeGreaterThan(0.1)
    expect(stats.hues.orange).toBeGreaterThan(0.05)
    expect(stats.hues.red).toBeLessThan(0.001)
    expect(host.requests).toEqual(['200 wizard.json', '200 wizard.atlas', '200 wizard.png'])
  })

  test('a 3.8 skeleton is drawn by the 3.8 script, loaded when needed', async ({ page }) => {
    // ranger.skel (3.8): orange body, green head, purple arm; its atlas uses the 3.x syntax.
    const result = await thumbnailOf(page, 'ranger.skel')
    expect(result.error).toBeUndefined()
    const stats = await pixelStats(page, result.png!)
    expect([stats.width, stats.height]).toEqual([258, 320])
    expect(stats.cornerAlpha).toBe(0)
    expect(stats.hues.orange).toBeGreaterThan(0.2)
    expect(stats.hues.green).toBeGreaterThan(0.1)
    expect(stats.hues.purple).toBeGreaterThan(0.05)
    expect(stats.hues.red).toBeLessThan(0.001)
    // Under the host's CSP, as a file of the package.
    expect(await page.evaluate(() => typeof (globalThis as { spine?: unknown }).spine)).toBe(
      'object',
    )
  })

  test('4.0 and 4.1 skeletons are drawn by their own runtimes', async ({ page }) => {
    // scout.skel (4.0): yellow body, blue head, purple arm.
    const scout = await thumbnailOf(page, 'scout.skel')
    expect(scout.error).toBeUndefined()
    const four = await pixelStats(page, scout.png!)
    expect([four.width, four.height]).toEqual([258, 320])
    expect(four.hues.yellow).toBeGreaterThan(0.2)
    expect(four.hues.blue).toBeGreaterThan(0.1)
    expect(four.hues.purple).toBeGreaterThan(0.05)
    // squire.skel (4.1): green body, purple head, blue arm.
    const squire = await thumbnailOf(page, 'squire.skel')
    expect(squire.error).toBeUndefined()
    const one = await pixelStats(page, squire.png!)
    expect(one.hues.green).toBeGreaterThan(0.2)
    expect(one.hues.purple).toBeGreaterThan(0.1)
    expect(one.hues.blue).toBeGreaterThan(0.05)
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

  test('JSON and binary skeletons of 3.7, 3.8, 4.0 and 4.1 are drawn alike', async ({ page }) => {
    await page.goto(pageUrl(host.pluginOrigin, 'skeleton-thumbnail.html'))
    // wizard.skel (3.7) goes through the plugin's own reader, wizard.json through spine-ts 3.7.
    for (const name of ['wizard', 'ranger', 'scout', 'squire']) {
      const json = await requestThumbnail(page, await host.input(`${name}.json`))
      const binary = await requestThumbnail(page, await host.input(`${name}.skel`))
      expect(json.error, name).toBeUndefined()
      expect(await pixelDifference(page, json.png!, binary.png!), name).toBeLessThan(0.001)
    }
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
    const lines = '3.7、3.8、4.0、4.1、4.2、4.3'
    expect(await failure('spine-5.0.skel')).toBe(
      `Spine 5.0.00 的数据：插件只包含这些版本的运行时：${lines}。`,
    )
    expect(await failure('spine-3.6.skel')).toBe(
      `Spine 3.6.53 的数据：插件只包含这些版本的运行时：${lines}。`,
    )
    // A JSON skeleton of another version is Spine, so it fails rather than being not applicable.
    expect(await failure('spine-3.6.json')).toBe(
      `Spine 3.6.53 的数据：插件只包含这些版本的运行时：${lines}。`,
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

  test('3.7 and 3.8 keep their own classes when both are loaded in one page', async ({ page }) => {
    await openViewer(page, 'ranger.skel')
    await expect(page.locator('#info')).toHaveText('Spine 3.8.99 · 4 根骨骼 · 3 个插槽')
    const wizard = await host.input('wizard.skel')
    await switchInput(page, wizard)
    expect(await viewerOutcome(page, wizard.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 3.7.94 · 4 根骨骼 · 3 个插槽')
    expect((await canvasStats(page)).hues.yellow).toBeGreaterThan(0.003)
    // The global now holds the 3.7 namespace, which has no binary reader (the plugin read
    // wizard.skel with its own): 3.7 did not add its classes to the 3.8 namespace.
    expect(
      await page.evaluate(
        () => typeof (globalThis as { spine?: { SkeletonBinary?: unknown } }).spine?.SkeletonBinary,
      ),
    ).toBe('undefined')
    // And 3.8 still reads its binary skeleton with its own classes.
    const ranger = await host.input('ranger.skel')
    await switchInput(page, ranger)
    expect(await viewerOutcome(page, ranger.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 3.8.99 · 4 根骨骼 · 3 个插槽')
    const stats = await canvasStats(page)
    expect(stats.hues.orange).toBeGreaterThan(0.005)
    expect(stats.hues.yellow).toBeLessThan(0.0005)
  })

  test('a 3.8 skeleton plays and switches skins', async ({ page }) => {
    const { outcome } = await openViewer(page, 'ranger.skel')
    expect(outcome).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 3.8.99 · 4 根骨骼 · 3 个插槽')
    await expect(page.locator('#play')).toHaveText('暂停')
    const before = await canvasPng(page)
    await page.waitForTimeout(300)
    expect(await pixelDifference(page, before, await canvasPng(page))).toBeGreaterThan(0.0005)
    await page.locator('#skin').selectOption('armored')
    const stats = await canvasStats(page)
    expect(stats.hues.red).toBeGreaterThan(0.003)
    expect(stats.hues.green).toBeLessThan(0.0005)
  })

  test('4.0 and 4.1 skeletons play, without physics or (4.1) skeleton time', async ({ page }) => {
    await openViewer(page, 'scout.skel')
    await expect(page.locator('#info')).toHaveText('Spine 4.0.64 · 4 根骨骼 · 3 个插槽')
    const moves = async () => {
      await expect(page.locator('#play')).toHaveText('暂停')
      const before = await canvasPng(page)
      await page.waitForTimeout(300)
      return pixelDifference(page, before, await canvasPng(page))
    }
    expect(await moves()).toBeGreaterThan(0.0005)
    const next = await host.input('squire.skel')
    await switchInput(page, next)
    expect(await viewerOutcome(page, next.url)).toEqual({ ready: true })
    await expect(page.locator('#info')).toHaveText('Spine 4.1.24 · 4 根骨骼 · 3 个插槽')
    expect(await moves()).toBeGreaterThan(0.0005)
  })

  test('the host focuses skins, animations, attachments, slots and bones by their keys', async ({
    page,
  }) => {
    const { input } = await openViewer(page, 'hero.json')
    const label = page.locator('#focus-label')
    /** Pixels marked on the overlay. */
    const marked = () =>
      page.evaluate(() => {
        const overlay = document.querySelector<HTMLCanvasElement>('#overlay')!
        const { data } = overlay.getContext('2d')!.getImageData(0, 0, overlay.width, overlay.height)
        let count = 0
        for (let index = 3; index < data.length; index += 4) if (data[index]) count++
        return count
      })
    expect(await marked()).toBe(0)

    // A skin and an animation are switched to.
    await focusSubresource(page, input.url, 'skins/1')
    await expect(page.locator('#skin')).toHaveValue('armored')
    await expect(label).toHaveText('已定位：皮肤 armored')
    await focusSubresource(page, input.url, 'animations/1')
    await expect(page.locator('#animation')).toHaveValue('blink')
    await expect(label).toHaveText('已定位：动画 blink')

    // An attachment of the default skin is outlined; one of another skin switches to that skin.
    await page.locator('#animation').selectOption('')
    await page.locator('#skin').selectOption('default')
    await focusSubresource(page, input.url, 'attachments/0')
    await expect(label).toHaveText('已定位：区域附件 body')
    await expect.poll(marked).toBeGreaterThan(100)
    await focusSubresource(page, input.url, 'attachments/3')
    await expect(page.locator('#skin')).toHaveValue('armored')
    await expect(label).toHaveText('已定位：区域附件 head（区域 helmet）')
    await expect.poll(marked).toBeGreaterThan(100)
    // The head of the default skin is not shown under the armored skin, and says so.
    await focusSubresource(page, input.url, 'attachments/2')
    await expect(label).toHaveText('已定位：区域附件 head（这个附件现在没有显示）')
    expect(await marked()).toBe(0)

    // A slot and a bone are marked.
    await focusSubresource(page, input.url, 'slots/1')
    await expect(label).toHaveText('已定位：插槽 arm')
    await expect.poll(marked).toBeGreaterThan(100)
    await focusSubresource(page, input.url, 'bones/3')
    await expect(label).toHaveText('已定位：骨骼 arm')
    await expect.poll(marked).toBeGreaterThan(20)

    // Keys the file does not have and keys for another file change nothing; clearing removes the
    // mark, and F ends the focus as well.
    await focusSubresource(page, input.url, 'bones/9')
    await focusSubresource(page, `${input.url}x`, 'skins/0')
    await expect(label).toHaveText('已定位：骨骼 arm')
    await page.locator('#focus-clear').click()
    await expect(page.locator('#focus')).toBeHidden()
    expect(await marked()).toBe(0)
    await focusSubresource(page, input.url, 'slots/0')
    await expect(page.locator('#focus')).toBeVisible()
    await page.locator('#view').focus()
    await page.keyboard.press('f')
    await expect(page.locator('#focus')).toBeHidden()

    // A binary skeleton has the same keys, read back from what its runtime read.
    const binary = await host.input('wizard.skel')
    await switchInput(page, binary)
    expect(await viewerOutcome(page, binary.url)).toEqual({ ready: true })
    await expect(page.locator('#focus')).toBeHidden()
    await page.locator('#animation').selectOption('')
    await focusSubresource(page, binary.url, 'attachments/0')
    await expect(label).toHaveText('已定位：区域附件 body')
    await expect.poll(marked).toBeGreaterThan(100)
  })
})
