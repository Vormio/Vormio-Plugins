import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { defaultDirection, frameBox } from '../src/framing.ts'

/** Projects the box corners through a camera placed as `frameBox` says; returns NDC extents. */
function project(box: Box3, direction: Vector3, fov: number, aspect: number, margin: number) {
  const framing = frameBox(box, direction, fov, aspect, margin)
  const camera = new PerspectiveCamera(fov, aspect, framing.near, framing.far)
  camera.position.copy(framing.position)
  camera.lookAt(framing.target)
  camera.updateMatrixWorld()
  let x = 0
  let y = 0
  let depth = -Infinity
  for (let index = 0; index < 8; index++) {
    const corner = new Vector3(
      index & 1 ? box.max.x : box.min.x,
      index & 2 ? box.max.y : box.min.y,
      index & 4 ? box.max.z : box.min.z,
    ).project(camera)
    x = Math.max(x, Math.abs(corner.x))
    y = Math.max(y, Math.abs(corner.y))
    depth = Math.max(depth, corner.z)
  }
  return { x, y, depth, framing }
}

test('a unit cube seen from the front at 90° fits exactly', () => {
  const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
  const framing = frameBox(box, new Vector3(0, 0, 1), 90, 1, 1)
  assert.ok(Math.abs(framing.distance - 2) < 1e-9)
  assert.deepEqual(framing.position.toArray(), [0, 0, 2])
})

test('every corner stays in view with the requested margin', () => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let run = 0; run < 200; run++) {
    const centre = new Vector3(random() * 50, random() * 50, random() * 50)
    const size = new Vector3(Math.abs(random()) * 20, Math.abs(random()) * 5, Math.abs(random()))
    const box = new Box3().setFromCenterAndSize(centre, size)
    const direction = new Vector3(random(), random(), random())
    if (direction.lengthSq() < 1e-3) continue
    const aspect = 0.3 + Math.abs(random()) * 3
    const { x, y, depth } = project(box, direction, 35, aspect, 1.15)
    assert.ok(x <= 1 / 1.15 + 1e-6 && y <= 1 / 1.15 + 1e-6, `run ${run}: ${x}, ${y}`)
    // The tightest side touches the margin: the model is not framed too loosely.
    assert.ok(Math.max(x, y) > 1 / 1.15 - 0.2, `run ${run}: loose ${x}, ${y}`)
    assert.ok(depth < 1, `run ${run}: beyond the far plane`)
  }
})

test('looking straight down still frames the model', () => {
  const box = new Box3(new Vector3(-2, 0, -1), new Vector3(2, 0.1, 1))
  const { x, y } = project(box, new Vector3(0, 1, 0), 35, 1.5, 1.1)
  // three's lookAt tilts an exactly vertical view by 1e-4, hence the looser tolerance.
  assert.ok(x <= 1 / 1.1 + 1e-3 && y <= 1 / 1.1 + 1e-3, `${x}, ${y}`)
})

test('a point-sized model still gets a usable camera', () => {
  const box = new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1))
  const framing = frameBox(box, defaultDirection, 35, 1)
  assert.ok(framing.distance > 0 && framing.near > 0 && framing.far > framing.distance)
})
