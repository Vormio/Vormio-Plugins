import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAtlas } from '../src/atlas.ts'
import { fitView, focusView, hit, toPage, zoomAt, zoomRange } from '../src/view.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')

test('regions know where they lie on their page; a rotated region covers its height across', async () => {
  const atlas = parseAtlas(await readFile(join(fixtures, 'basic/hero.atlas'), 'utf8'))
  assert.deepEqual(atlas.pages[0]?.size, { width: 128, height: 64 })
  const arm = atlas.regions.find((each) => each.name === 'arm')!
  assert.equal(arm.degrees, 90)
  assert.deepEqual([arm.width, arm.height], [12, 40])
  assert.deepEqual(arm.rect, { x: 66, y: 34, width: 40, height: 12 })
  const helmet = atlas.regions.find((each) => each.name === 'helmet')!
  assert.equal(helmet.page, 1)
  assert.deepEqual(helmet.rect, { x: 44, y: 2, width: 18, height: 32 })
})

test('the 3.x syntax: xy and size, rotate true', async () => {
  const atlas = parseAtlas(await readFile(join(fixtures, 'legacy/goblin.atlas'), 'utf8'))
  assert.deepEqual(
    atlas.regions.map((each) => [each.name, each.degrees, each.rect]),
    [
      ['body', 0, { x: 2, y: 2, width: 40, height: 40 }],
      ['head', 90, { x: 44, y: 2, width: 30, height: 18 }],
    ],
  )
})

test('rotation by degrees, and a region without a position', () => {
  const atlas = parseAtlas(
    'p.png\nsize: 64, 64\na\nbounds: 0, 0, 10, 20\nrotate: 270\nb\nbounds: 0, 0, 10, 20\nrotate: 180\nc\n',
  )
  assert.deepEqual(
    atlas.regions.map((each) => each.rect),
    [{ x: 0, y: 0, width: 20, height: 10 }, { x: 0, y: 0, width: 10, height: 20 }, undefined],
  )
})

test('fitting centres the page with a margin', () => {
  const view = fitView({ width: 200, height: 100 }, { width: 448, height: 448 }, 24)
  assert.equal(view.scale, 2)
  assert.deepEqual([view.x, view.y], [24, 124])
})

test('zooming keeps the point under the cursor in place and stays within range', () => {
  const view = { scale: 1, x: 10, y: 20 }
  const zoomed = zoomAt(view, 2, 110, 70, 1)
  const before = toPage(view, 110, 70)
  const after = toPage(zoomed, 110, 70)
  assert.equal(zoomed.scale, 2)
  assert.deepEqual(after, before)
  assert.equal(zoomAt(view, 1e9, 0, 0, 1).scale, zoomRange.max)
  assert.equal(zoomAt(view, 1e-9, 0, 0, 1).scale, zoomRange.min)
})

test('focusing a region centres it, never above 8×', () => {
  const view = focusView({ x: 10, y: 10, width: 4, height: 4 }, { width: 400, height: 300 })
  assert.equal(view.scale, 8)
  const centre = toPage(view, 200, 150)
  assert.deepEqual(centre, { x: 12, y: 12 })
})

test('a point hits the smallest region containing it', () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 100 },
    undefined,
    { x: 10, y: 10, width: 10, height: 10 },
  ]
  assert.equal(hit(rects, 15, 15), 2)
  assert.equal(hit(rects, 50, 50), 0)
  assert.equal(hit(rects, 100, 50), -1)
})
