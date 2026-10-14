import { isNotApplicable, thumbnail } from '@vormio/plugin-sdk'
import { failureMessage, SpineError } from './errors.ts'
import type { Runtime } from './preview/figure.ts'
import { pad, thumbnailSize } from './preview/framing.ts'
import { readParts } from './preview/load.ts'
import type { RuntimeLine } from './preview/version.ts'

// The setup pose with the default skin, framed to what is visible, drawn at up to twice the size
// and scaled down for smooth edges. The background stays transparent. A page that cannot be read
// fails the thumbnail rather than drawing the skeleton with parts missing. JSON that is not a
// skeleton is not applicable: the host moves on to another thumbnail or the type icon.

const canvas = document.createElement('canvas')
const scenes = new Map<RuntimeLine, ReturnType<Runtime['scene']>>()
function sceneFor(runtime: Runtime) {
  let scene = scenes.get(runtime.line)
  if (!scene) {
    scene = runtime.scene(canvas, {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    scenes.set(runtime.line, scene)
  }
  return scene
}

thumbnail(async (input, { maxEdge }) => {
  try {
    const parts = await readParts(input)
    if (isNotApplicable(parts)) return parts
    const figure = parts.runtime.load(
      sceneFor(parts.runtime),
      parts.skeleton,
      parts.atlas,
      parts.pages,
    )
    try {
      if (figure.problems.length)
        throw new SpineError(`贴图页无法读取：${figure.problems.join('；')}`)
      const bounds = figure.bounds()
      if (!bounds) throw new SpineError('骨骼在初始姿势下没有可见的附件。')
      const framed = pad(bounds, 0.02)
      const size = thumbnailSize(framed, maxEdge)
      const scale = Math.min(2, 2048 / Math.max(size.width, size.height))
      canvas.width = Math.max(1, Math.round(size.width * scale))
      canvas.height = Math.max(1, Math.round(size.height * scale))
      // Rendering and copying happen in one task, so jobs that run at the same time cannot mix.
      figure.render(
        {
          x: framed.x + framed.width / 2,
          y: framed.y + framed.height / 2,
          unitsPerPixel: Math.max(framed.width / canvas.width, framed.height / canvas.height),
        },
        canvas.width,
        canvas.height,
      )
      const result = new OffscreenCanvas(size.width, size.height)
      const context = result.getContext('2d')!
      context.imageSmoothingQuality = 'high'
      context.drawImage(canvas, 0, 0, size.width, size.height)
      return result
    } finally {
      figure.dispose()
    }
  } catch (error) {
    throw new SpineError(failureMessage(error))
  }
})
