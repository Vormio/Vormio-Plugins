import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fitView,
  hasArea,
  pad,
  panView,
  thumbnailSize,
  union,
  zoomAt,
  zoomRange,
} from '../src/preview/framing.ts'

const viewport = { width: 800, height: 600 }

test('fitting centres the bounds and leaves a margin', () => {
  const view = fitView({ x: -16, y: 0, width: 64, height: 80 }, viewport, 32)
  assert.deepEqual(view, { x: 16, y: 40, scale: (600 - 64) / 80 })
})

test('zooming keeps the skeleton point under the cursor, within the range', () => {
  const view = { x: 10, y: 20, scale: 2 }
  const zoomed = zoomAt(view, 1.5, 600, 100, viewport, 2)
  const under = (v: typeof view) => ({
    x: v.x + (600 - 400) / v.scale,
    y: v.y - (100 - 300) / v.scale,
  })
  assert.equal(zoomed.scale, 3)
  assert.deepEqual(under(zoomed), under(view))
  assert.equal(zoomAt(view, 1000, 0, 0, viewport, 2).scale, 2 * zoomRange.max)
  assert.equal(zoomAt(view, 0.001, 0, 0, viewport, 2).scale, 2 * zoomRange.min)
})

test('dragging moves the skeleton with the pointer; screen y points down', () => {
  assert.deepEqual(panView({ x: 0, y: 0, scale: 2 }, 10, 10), { x: -5, y: 5, scale: 2 })
})

test('thumbnails keep the proportions of the bounds', () => {
  assert.deepEqual(thumbnailSize({ x: 0, y: 0, width: 64, height: 80 }, 320), {
    width: 256,
    height: 320,
  })
  assert.deepEqual(thumbnailSize({ x: 0, y: 0, width: 100, height: 0 }, 320), {
    width: 320,
    height: 1,
  })
  assert.deepEqual(pad({ x: 0, y: 0, width: 50, height: 100 }, 0.1), {
    x: -10,
    y: -10,
    width: 70,
    height: 120,
  })
})

test('empty and infinite bounds have no area; union encloses both', () => {
  assert.equal(hasArea(undefined), false)
  assert.equal(hasArea({ x: 0, y: 0, width: 0, height: 0 }), false)
  assert.equal(hasArea({ x: Infinity, y: Infinity, width: -Infinity, height: -Infinity }), false)
  assert.equal(hasArea({ x: 0, y: 0, width: 1, height: 0 }), true)
  assert.deepEqual(
    union({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: -5, width: 10, height: 5 }),
    {
      x: 0,
      y: -5,
      width: 15,
      height: 15,
    },
  )
})
