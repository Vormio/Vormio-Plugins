// The calls as the runtime lines before 4.3 name them (3.8 to 4.2): setToSetupPose, setSkinByName,
// textures that do not know whether they are premultiplied, and premultiplication given when
// drawing. Lines before 4.2 have no physics, and 4.1 keeps no skeleton time.

import type { Differences, Physics } from './figure.ts'

interface ClassicSkeleton {
  setToSetupPose(): void
  setSlotsToSetupPose(): void
  setSkinByName(name: string): void
  updateWorldTransform(physics?: number): void
  update?(delta: number): void
}

interface ClassicScene {
  context: never
  drawSkeleton(skeleton: never, premultipliedAlpha: boolean): void
}

/** The parts of a classic runtime module these calls need. */
export interface ClassicSpine {
  GLTexture: new (context: never, image: HTMLImageElement | ImageBitmap) => unknown
  /** From 4.2. */
  Physics?: Record<Physics, number>
}

type Texture = ReturnType<Differences['texture']>
const classic = (skeleton: unknown) => skeleton as ClassicSkeleton
const scene = (value: unknown) => value as ClassicScene

export function classicDifferences(spine: ClassicSpine): Differences {
  const { Physics } = spine
  return {
    texture: (renderer, image) => new spine.GLTexture(scene(renderer).context, image) as Texture,
    draw: (renderer, skeleton, pma) => scene(renderer).drawSkeleton(skeleton as never, pma),
    setupPose: (skeleton) => classic(skeleton).setToSetupPose(),
    setupPoseSlots: (skeleton) => classic(skeleton).setSlotsToSetupPose(),
    setSkin: (skeleton, name) => classic(skeleton).setSkinByName(name),
    updateWorldTransform: (skeleton, physics) =>
      Physics
        ? classic(skeleton).updateWorldTransform(Physics[physics])
        : classic(skeleton).updateWorldTransform(),
    advance: (skeleton, seconds) => classic(skeleton).update?.(seconds),
  }
}
