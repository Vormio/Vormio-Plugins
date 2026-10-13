import { Box3, MathUtils, Sphere, Vector3 } from 'three'

/** Where a camera goes to show a whole model, and the clipping range that keeps it visible. */
export interface Framing {
  target: Vector3
  position: Vector3
  /** Distance from the camera to the target. */
  distance: number
  /** Radius of the model's bounding sphere; a scale for zoom limits. */
  radius: number
  near: number
  far: number
}

/** From the model towards the camera: front, slightly right and above (glTF faces +Z, +Y up). */
export const defaultDirection = new Vector3(0.55, 0.42, 1).normalize()

const point = new Vector3()
const right = new Vector3()
const up = new Vector3()
const worldUp = new Vector3(0, 1, 0)

/**
 * Places a perspective camera on `direction` from the centre of `box` at the smallest distance that
 * keeps all eight corners inside the view, with `margin` (1.1 = 10 % room) around them.
 */
export function frameBox(
  box: Box3,
  direction: Vector3,
  verticalFov: number,
  aspect: number,
  margin = 1.1,
): Framing {
  const corners: number[] = []
  for (let index = 0; index < 8; index++)
    corners.push(
      index & 1 ? box.max.x : box.min.x,
      index & 2 ? box.max.y : box.min.y,
      index & 4 ? box.max.z : box.min.z,
    )
  return framePoints(corners, box, direction, verticalFov, aspect, margin)
}

/**
 * Frames a model by its vertices (world positions) when it has them; tighter than its bounding box
 * for round shapes. Falls back to the box corners for models with too many vertices.
 */
export function frameModel(
  model: { box: Box3; points?: ArrayLike<number> },
  direction: Vector3,
  verticalFov: number,
  aspect: number,
  margin = 1.1,
): Framing {
  return model.points
    ? framePoints(model.points, model.box, direction, verticalFov, aspect, margin)
    : frameBox(model.box, direction, verticalFov, aspect, margin)
}

/**
 * Like `frameBox`, but keeps the given points (x, y, z triples, all inside `box`) in view instead of
 * the corners. The camera still aims at the centre of `box`.
 */
export function framePoints(
  points: ArrayLike<number>,
  box: Box3,
  direction: Vector3,
  verticalFov: number,
  aspect: number,
  margin = 1.1,
): Framing {
  const target = box.getCenter(new Vector3())
  const radius = Math.max(box.getBoundingSphere(new Sphere()).radius, 1e-6)
  const back = direction.clone().normalize()
  // Looking straight up or down: any horizontal axis will do as the screen's right.
  right.crossVectors(worldUp, back)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  up.crossVectors(back, right).normalize()

  const tanVertical = Math.tan(MathUtils.degToRad(verticalFov) / 2)
  const tanHorizontal = tanVertical * Math.max(aspect, 1e-6)
  let distance = 0
  for (let index = 0; index + 2 < points.length; index += 3) {
    point.set(points[index]!, points[index + 1]!, points[index + 2]!).sub(target)
    const toward = point.dot(back)
    distance = Math.max(
      distance,
      toward + (margin * Math.abs(point.dot(right))) / tanHorizontal,
      toward + (margin * Math.abs(point.dot(up))) / tanVertical,
    )
  }
  // A flat model seen edge-on still needs the camera outside it.
  distance = Math.max(distance, radius * 1.05)
  return {
    target,
    position: target.clone().addScaledVector(back, distance),
    distance,
    radius,
    near: radius / 100,
    far: distance + radius * 100,
  }
}
