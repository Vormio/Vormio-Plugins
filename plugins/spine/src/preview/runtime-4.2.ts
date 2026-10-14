// The Spine 4.2 runtime; loaded only for 4.2 data. Its module has the shape of the 4.3 one that
// figure.ts is typed against, except for the calls below, which use the 4.2 names and parameters.

import * as spine from 'spine-webgl-4.2'
import { createRuntime, type Differences, type Spine } from './figure.ts'

type Scene = spine.SceneRenderer
type Skeleton = spine.Skeleton
type Texture = ReturnType<Differences['texture']>

export const runtime = createRuntime('4.2', spine as unknown as Spine, {
  texture: (scene, image) =>
    new spine.GLTexture((scene as unknown as Scene).context, image) as unknown as Texture,
  // 4.2 takes premultiplication when drawing, for the whole skeleton.
  draw: (scene, skeleton, pma) =>
    (scene as unknown as Scene).drawSkeleton(skeleton as unknown as Skeleton, pma),
  setupPose: (skeleton) => (skeleton as unknown as Skeleton).setToSetupPose(),
  setupPoseSlots: (skeleton) => (skeleton as unknown as Skeleton).setSlotsToSetupPose(),
  setSkin: (skeleton, name) => (skeleton as unknown as Skeleton).setSkinByName(name),
})
