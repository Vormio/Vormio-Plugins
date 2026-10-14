import { notApplicable, thumbnail } from '@vormio/plugin-sdk'
import { PerspectiveCamera, WebGLRenderer } from 'three'
import { failureMessage } from './errors.ts'
import { defaultDirection, frameModel } from './framing.ts'
import { loadModel, type Model } from './model.ts'
import { NotObjError } from './obj-file.ts'
import { prepareRenderer, stageScene } from './stage.ts'

// The same loading, staging and framing as the viewer, drawn once at twice the size and scaled down
// for smooth edges. The background stays transparent. Material libraries and textures that cannot
// be read leave parts grey; the thumbnail is drawn all the same.
const canvas = document.createElement('canvas')
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
})
renderer.setPixelRatio(1)
const environment = prepareRenderer(renderer)
const camera = new PerspectiveCamera(30, 1, 0.01, 100)

thumbnail(async (input, { maxEdge }) => {
  let model: Model
  try {
    model = await loadModel(input)
  } catch (error) {
    if (error instanceof NotObjError) return notApplicable()
    throw new Error(failureMessage(error))
  }
  try {
    const scene = stageScene(environment, model.root)
    const size = Math.min(maxEdge * 2, 2048)
    renderer.setSize(size, size, false)
    const framing = frameModel(model, defaultDirection, camera.fov, 1, 1.1)
    camera.position.copy(framing.position)
    camera.lookAt(framing.target)
    camera.near = framing.near
    camera.far = framing.far
    camera.updateProjectionMatrix()
    // Rendering and copying happen in one task, so jobs that run at the same time cannot mix.
    renderer.render(scene, camera)
    const result = new OffscreenCanvas(maxEdge, maxEdge)
    const context = result.getContext('2d')!
    context.imageSmoothingQuality = 'high'
    context.drawImage(canvas, 0, 0, maxEdge, maxEdge)
    return result
  } finally {
    model.dispose()
  }
})
