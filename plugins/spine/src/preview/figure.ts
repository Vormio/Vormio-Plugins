// A loaded skeleton behind one interface for every runtime line: posing, skins, animation,
// measuring and drawing. The code is typed against spine-webgl 4.3; the other lines' modules have
// the same shape except for the calls in `Differences`, which each line's module (runtime-*.ts)
// supplies.

import type * as Spine43 from 'spine-webgl-4.3'
import { hasArea, union, type Bounds } from './framing.ts'
import type { PageImage } from './source.ts'
import type { RuntimeLine } from './version.ts'

export type Spine = typeof Spine43
type SceneRenderer = Spine43.SceneRenderer
type Skeleton = Spine43.Skeleton

/**
 * How physics take part when world transforms are updated: not at all, reset to the pose, or
 * stepped. Lines before 4.2 have no physics and ignore it.
 */
export type Physics = 'none' | 'reset' | 'update'

/** The calls whose names or parameters differ between the runtime lines. */
export interface Differences {
  texture(
    scene: SceneRenderer,
    image: HTMLImageElement | ImageBitmap,
    pma: boolean,
  ): Spine43.GLTexture
  draw(scene: SceneRenderer, skeleton: Skeleton, pma: boolean): void
  setupPose(skeleton: Skeleton): void
  setupPoseSlots(skeleton: Skeleton): void
  setSkin(skeleton: Skeleton, name: string): void
  updateWorldTransform(skeleton: Skeleton, physics: Physics): void
  /** Advances the skeleton's own time, which physics use; 4.1 has none. */
  advance(skeleton: Skeleton, seconds: number): void
  /**
   * Reads an atlas, giving each page, in order, the texture `texture` makes for it. From 4.0 the
   * atlas is read first and each page given its texture after, which is the default; 3.8 asks for
   * the textures while it reads.
   */
  readAtlas?(text: string, texture: (name: string, pma: boolean) => Texture): ReadAtlas
  /** Reads binary data where the runtime has no reader of its own (3.7). */
  readBinary?(loader: Spine43.AtlasAttachmentLoader, bytes: Uint8Array): Spine43.SkeletonData
}

type Texture = Spine43.GLTexture

/** An atlas whose pages have their textures, and whether to draw it premultiplied. */
export interface ReadAtlas {
  atlas: Spine43.TextureAtlas
  pma: boolean
}

/** The camera: the skeleton point at the canvas centre and skeleton units per device pixel. */
export interface Camera {
  x: number
  y: number
  unitsPerPixel: number
}

export interface Figure {
  readonly version: string
  readonly bones: number
  readonly slots: number
  readonly skins: readonly string[]
  readonly animations: readonly { name: string; duration: number }[]
  /** Pages that could not be read, as `name（reason）`; their attachments are not drawn. */
  readonly problems: readonly string[]
  readonly skin: string
  /** The animation being shown; undefined for the setup pose. */
  readonly animation: string | undefined
  /** Seconds into the animation. */
  readonly time: number
  /** Whether a non-looping animation has reached its end. */
  readonly finished: boolean
  setSkin(name: string): void
  /** Starts `name` from its beginning, or returns to the setup pose. */
  setAnimation(name: string | undefined, loop: boolean): void
  /** Advances the animation and physics by `seconds`. */
  update(seconds: number): void
  /** The bounds of what is drawn now; undefined when nothing visible is attached. */
  bounds(): Bounds | undefined
  /** The bounds of the setup pose, or of `animation` sampled over its length. */
  extent(animation?: string): Bounds | undefined
  render(camera: Camera, width: number, height: number): void
  dispose(): void
}

export interface Runtime {
  readonly line: RuntimeLine
  /** The page names of an atlas, in order. */
  pageNames(atlasText: string): string[]
  /**
   * Loads a skeleton, binary data or parsed JSON, for drawing with `scene`. Pages that failed to
   * read are replaced by a transparent pixel. Throws the runtime's error when the data cannot be
   * read.
   */
  load(
    scene: SceneRenderer,
    file: ArrayBuffer | Record<string, unknown>,
    atlasText: string,
    pages: readonly { name: string; image: PageImage }[],
  ): Figure
  /** A renderer for `canvas`; the WebGL context is created with `attributes`. */
  scene(canvas: HTMLCanvasElement, attributes: WebGLContextAttributes): SceneRenderer
}

/** Samples per second when measuring an animation; at least 10 and at most 300 in all. */
const samplesPerSecond = 30

export function createRuntime(line: RuntimeLine, spine: Spine, differ: Differences): Runtime {
  // A transparent pixel for pages that could not be read, so their attachments draw nothing.
  const empty = new OffscreenCanvas(1, 1)
  empty.getContext('2d')
  const blank = empty.transferToImageBitmap()
  // Stands in for textures where only the page names are wanted. 3.8 also takes each page's size
  // from its texture's image.
  const placeholder = {
    setFilters() {},
    setWraps() {},
    dispose() {},
    getImage: () => ({ width: 1, height: 1 }),
  } as unknown as Texture

  const readAtlas =
    differ.readAtlas ??
    ((text: string, texture: (name: string, pma: boolean) => Texture): ReadAtlas => {
      const atlas = new spine.TextureAtlas(text)
      for (const page of atlas.pages) page.setTexture(texture(page.name, page.pma))
      return { atlas, pma: atlas.pages.some((page) => page.pma) }
    })

  return {
    line,
    pageNames: (atlasText) =>
      readAtlas(atlasText, () => placeholder).atlas.pages.map((page) => page.name),

    scene(canvas, attributes) {
      const gl = canvas.getContext('webgl', attributes)
      if (!gl) throw new Error('WebGL is not available')
      return new spine.SceneRenderer(canvas, gl, true)
    },

    load(scene, file, atlasText, pages) {
      const problems: string[] = []
      let index = 0
      const { atlas, pma } = readAtlas(atlasText, (name, pagePma) => {
        const loaded = pages[index++]?.image
        if (!loaded || 'problem' in loaded)
          problems.push(`${name}（${loaded ? loaded.problem : '没有读取'}）`)
        return differ.texture(scene, loaded && 'image' in loaded ? loaded.image : blank, pagePma)
      })
      const loader = new spine.AtlasAttachmentLoader(atlas)
      let data: Spine43.SkeletonData
      try {
        // Binary data as a byte array over the whole buffer: the 3.8 and 4.0 readers take the
        // array's buffer and read it from the start. Every line's JSON reader takes the parsed JSON.
        data = !(file instanceof ArrayBuffer)
          ? new spine.SkeletonJson(loader).readSkeletonData(file)
          : differ.readBinary
            ? differ.readBinary(loader, new Uint8Array(file))
            : new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(file))
      } catch (error) {
        atlas.dispose()
        throw error
      }
      const skeleton = new spine.Skeleton(data)
      const stateData = new spine.AnimationStateData(data)
      const state = new spine.AnimationState(stateData)
      let animation: string | undefined
      let loop = true

      const pose = (physics: Physics) => {
        state.clearTracks()
        differ.setupPose(skeleton)
        if (animation) {
          state.setAnimation(0, animation, loop)
          state.apply(skeleton)
        }
        differ.updateWorldTransform(skeleton, physics)
      }
      // getBounds rather than getBoundsRect, which 3.8 lacks.
      const offset = new spine.Vector2()
      const size = new spine.Vector2()
      const temp: number[] = []
      const bounds = (): Bounds | undefined => {
        skeleton.getBounds(offset, size, temp)
        const rect = { x: offset.x, y: offset.y, width: size.x, height: size.y }
        return hasArea(rect) ? rect : undefined
      }
      const useSkin = (name: string) => {
        differ.setSkin(skeleton, name)
        differ.setupPoseSlots(skeleton)
        pose('reset')
      }

      // The default skin, unless it shows nothing in the setup pose and another skin does. A
      // skeleton may have no skin at all.
      const skins = data.skins.map((skin) => skin.name)
      const [first] = skins
      if (first === undefined) pose('reset')
      else {
        useSkin(first)
        for (const name of skins.slice(1)) {
          if (bounds()) break
          useSkin(name)
        }
        if (!bounds()) useSkin(first)
      }

      return {
        version: data.version ?? '',
        bones: data.bones.length,
        slots: data.slots.length,
        skins,
        animations: data.animations.map(({ name, duration }) => ({ name, duration })),
        problems,
        get skin() {
          return skeleton.skin?.name ?? ''
        },
        get animation() {
          return animation
        },
        get time() {
          const entry = state.tracks[0]
          if (!entry) return 0
          const duration = entry.animation?.duration ?? 0
          return loop && duration > 0
            ? entry.trackTime % duration
            : Math.min(entry.trackTime, duration)
        },
        get finished() {
          const entry = state.tracks[0]
          return !!entry && !loop && entry.trackTime >= (entry.animation?.duration ?? 0)
        },
        setSkin: useSkin,
        setAnimation(name, repeat) {
          animation = name
          loop = repeat
          pose('reset')
        },
        update(seconds) {
          state.update(seconds)
          state.apply(skeleton)
          differ.advance(skeleton, seconds)
          differ.updateWorldTransform(skeleton, 'update')
        },
        bounds,
        extent(name) {
          let result: Bounds | undefined
          const measure = (time: number) => {
            state.clearTracks()
            differ.setupPose(skeleton)
            if (name) {
              const entry = state.setAnimation(0, name, false)
              entry.trackTime = time
              state.apply(skeleton)
            }
            differ.updateWorldTransform(skeleton, 'none')
            const current = bounds()
            if (current) result = union(result, current)
          }
          const duration = name ? (data.findAnimation(name)?.duration ?? 0) : 0
          const samples = Math.min(300, Math.max(10, Math.ceil(duration * samplesPerSecond)))
          if (!name || duration <= 0) measure(0)
          else for (let index = 0; index <= samples; index++) measure((duration * index) / samples)
          // Measuring moved the skeleton; put the shown animation back at its start.
          pose('reset')
          return result
        },
        render(camera, width, height) {
          const gl = scene.context.gl
          gl.viewport(0, 0, width, height)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          scene.camera.setViewport(width, height)
          scene.camera.position.set(camera.x, camera.y, 0)
          scene.camera.zoom = camera.unitsPerPixel
          scene.begin()
          differ.draw(scene, skeleton, pma)
          scene.end()
        },
        dispose() {
          atlas.dispose()
        },
      }
    },
  }
}
