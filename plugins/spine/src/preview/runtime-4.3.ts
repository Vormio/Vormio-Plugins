// The Spine 4.3 runtime; loaded only for 4.3 data.

import * as spine from 'spine-webgl-4.3'
import { createRuntime } from './figure.ts'

export const runtime = createRuntime('4.3', spine, {
  // 4.3 textures know whether they are premultiplied, and drawing follows the texture.
  texture: (scene, image, pma) => new spine.GLTexture(scene.context, image, pma),
  draw: (scene, skeleton) => scene.drawSkeleton(skeleton),
  setupPose: (skeleton) => skeleton.setupPose(),
  setupPoseSlots: (skeleton) => skeleton.setupPoseSlots(),
  setSkin: (skeleton, name) => skeleton.setSkin(name),
})
