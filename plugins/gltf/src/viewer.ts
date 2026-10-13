import { viewer, type PluginInput } from '@vormio/plugin-sdk'
import { PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { describeProblem, explainFailures } from './companions.ts'
import { failureMessage } from './errors.ts'
import { defaultDirection, frameModel } from './framing.ts'
import { ModelLoader, type Model } from './model.ts'
import { prepareRenderer, stageScene } from './stage.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const info = document.querySelector<HTMLElement>('#info')!
const warnings = document.querySelector<HTMLUListElement>('#warnings')!
const fitButton = document.querySelector<HTMLButtonElement>('#fit')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const environment = prepareRenderer(renderer)
const loader = new ModelLoader(renderer)
const camera = new PerspectiveCamera(35, 1, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.screenSpacePanning = true
controls.zoomToCursor = true

let current: { model: Model; scene: ReturnType<typeof stageScene> } | undefined
let dirty = true
/** Until the user moves the camera, a resize frames the model again for the new shape. */
let userMoved = false

controls.addEventListener('change', () => (dirty = true))
controls.addEventListener('start', () => (userMoved = true))
renderer.setAnimationLoop(() => {
  // update() keeps returning true while damping settles.
  if (!controls.update() && !dirty) return
  dirty = false
  if (current) renderer.render(current.scene, camera)
  else renderer.clear()
})

/** Frames the whole model, looking along `direction` (from the model towards the camera). */
function frame(direction: Vector3): void {
  if (!current) return
  const framing = frameModel(current.model, direction, camera.fov, camera.aspect, 1.25)
  camera.position.copy(framing.position)
  camera.near = framing.near
  camera.far = framing.far
  camera.updateProjectionMatrix()
  controls.target.copy(framing.target)
  controls.minDistance = framing.radius * 0.02
  controls.maxDistance = framing.distance * 10
  controls.update()
  dirty = true
}

/** Frames again from the current viewing direction (F). */
function fit(): void {
  frame(camera.position.clone().sub(controls.target))
}

/** Back to the starting view (R). */
function reset(): void {
  userMoved = false
  frame(defaultDirection)
}

function resize(): void {
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (!userMoved) frame(defaultDirection)
  dirty = true
}
new ResizeObserver(resize).observe(canvas)
resize()

fitButton.addEventListener('click', fit)
resetButton.addEventListener('click', reset)
addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
  if (event.key === 'f' || event.key === 'F') fit()
  else if (event.key === 'r' || event.key === 'R') reset()
})

function clear(): void {
  current?.model.dispose()
  current = undefined
  info.textContent = ''
  warnings.replaceChildren()
  warnings.hidden = true
  fitButton.disabled = resetButton.disabled = true
  dirty = true
}

async function show(input: PluginInput, signal: AbortSignal): Promise<void> {
  clear()
  let model: Model
  try {
    model = await loader.load(input, signal)
  } catch (error) {
    throw new Error(await failureMessage(input, error))
  }
  const problems = model.failed.length ? await explainFailures(input, model.failed) : []
  if (signal.aborted) {
    model.dispose()
    return
  }

  current = { model, scene: stageScene(environment, model.root) }
  userMoved = false
  frame(defaultDirection)
  fitButton.disabled = resetButton.disabled = false
  info.textContent = `${model.triangles.toLocaleString('zh-CN')} 个三角形`
  if (problems.length) {
    const heading = document.createElement('li')
    heading.textContent = '以下贴图无法显示，相应材质只用颜色显示：'
    warnings.replaceChildren(
      heading,
      ...problems.map((problem) => {
        const item = document.createElement('li')
        item.textContent = describeProblem(problem)
        return item
      }),
    )
    warnings.hidden = false
  }
  // Render before reporting ready, so the host never shows an empty frame.
  renderer.render(current.scene, camera)
}

viewer(show)
