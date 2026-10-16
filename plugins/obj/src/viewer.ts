import { notApplicable, viewer, type PluginInput } from '@vormio/plugin-sdk'
import { PerspectiveCamera, Vector3, WebGLRenderer, type Material, type Mesh } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { describeProblem, explainFailures } from '../../../shared/companions.ts'
import { failureMessage } from './errors.ts'
import { focusMesh, Highlight } from './focus.ts'
import { defaultDirection, frameModel } from './framing.ts'
import { loadModel, measure, type Model } from './model.ts'
import { NotObjError } from './obj-file.ts'
import { prepareRenderer, stageScene } from './stage.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const info = document.querySelector<HTMLElement>('#info')!
const warnings = document.querySelector<HTMLUListElement>('#warnings')!
const fitButton = document.querySelector<HTMLButtonElement>('#fit')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!
const focusBox = document.querySelector<HTMLElement>('#focus')!
const focusLabel = document.querySelector<HTMLElement>('#focus-label')!
const focusClear = document.querySelector<HTMLButtonElement>('#focus-clear')!

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const environment = prepareRenderer(renderer)
const camera = new PerspectiveCamera(35, 1, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.screenSpacePanning = true
controls.zoomToCursor = true

let current: { model: Model; input: PluginInput; scene: ReturnType<typeof stageScene> } | undefined
let dirty = true
/** Until the user moves the camera, a resize frames the model again for the new shape. */
let userMoved = false

function render(): void {
  dirty = false
  if (current) renderer.render(current.scene, camera)
  else renderer.clear()
}

controls.addEventListener('change', () => (dirty = true))
controls.addEventListener('start', () => (userMoved = true))
renderer.setAnimationLoop(() => {
  // update() keeps returning true while damping settles.
  if (controls.update() || dirty) render()
})

/** Frames the whole model, looking along `direction` (from the model towards the camera). */
function frame(direction: Vector3): void {
  if (!current) return
  place(frameModel(current.model, direction, camera.fov, camera.aspect, 1.25))
}

function place(framing: ReturnType<typeof frameModel>): void {
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
  clearFocus()
  frame(camera.position.clone().sub(controls.target))
}

/** Back to the starting view (R). */
function reset(): void {
  clearFocus()
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
  // Resizing clears the canvas; draw now rather than show an empty view until the next frame.
  render()
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
  clearFocus()
  current?.model.dispose()
  current = undefined
  info.textContent = ''
  warnings.replaceChildren()
  warnings.hidden = true
  fitButton.disabled = resetButton.disabled = true
  dirty = true
}

async function show(input: PluginInput, signal: AbortSignal) {
  clear()
  let model: Model
  try {
    model = await loadModel(input, signal)
  } catch (error) {
    if (error instanceof NotObjError) return notApplicable()
    throw new Error(failureMessage(error))
  }
  const problems = [
    ...(model.failed.length
      ? (await explainFailures(input, model.failed)).map(describeProblem)
      : []),
    ...model.missingMaterials.map((name) => `材质 ${name}（材质库中没有定义）`),
  ]
  if (signal.aborted) {
    model.dispose()
    return
  }

  current = { model, input, scene: stageScene(environment, model.root) }
  userMoved = false
  frame(defaultDirection)
  fitButton.disabled = resetButton.disabled = false
  const triangles = `${model.triangles.toLocaleString('zh-CN')} 个三角形`
  info.textContent = `${triangles} · ${model.materials.toLocaleString('zh-CN')} 个材质`
  if (problems.length) {
    const heading = document.createElement('li')
    heading.textContent = '以下内容无法显示，相应部分只用颜色显示：'
    warnings.replaceChildren(
      heading,
      ...problems.map((problem) => {
        const item = document.createElement('li')
        item.textContent = problem
        return item
      }),
    )
    warnings.hidden = false
  }
  // Render before reporting ready, so the host never shows an empty frame.
  render()
}

// --- Focus ----------------------------------------------------------------------------------------

const highlight = new Highlight()
/** The faces the host asked to show, drawn over the model, until the next key, F, R or file. */
let overlay: Mesh | undefined
/** Only the latest request is shown when several overlap. */
let request = 0

function clearFocus(): void {
  request++
  highlight.clear()
  if (overlay) {
    overlay.removeFromParent()
    overlay.geometry.dispose()
    ;(overlay.material as Material).dispose()
    overlay = undefined
  }
  focusBox.hidden = true
  dirty = true
}
focusClear.addEventListener('click', clearFocus)

/**
 * Shows the object, group or material `key` of the analyzer's report: its faces are drawn in the
 * highlight colour over the model, which is dimmed, and framed. The file is read again for them,
 * with the analyzer's own reading, so they are the faces the report counts. Keys this file does not
 * have are ignored.
 */
async function focus(key: string, input: PluginInput): Promise<void> {
  if (!current || current.input.url !== input.url) return
  const shown = current
  const asked = ++request
  const found = await focusMesh(input, key).catch(() => undefined)
  if (!found || current !== shown || asked !== request) {
    found?.mesh?.geometry.dispose()
    return
  }
  clearFocus()
  let label = `已定位：${found.label}`
  if (found.mesh) {
    overlay = found.mesh
    shown.model.root.add(overlay)
    highlight.apply(shown.model.root, [overlay])
    const direction = camera.position.clone().sub(controls.target)
    const part = measure(overlay)
    const framing = frameModel(part, direction, camera.fov, camera.aspect, 1.25)
    place(framing)
    userMoved = true
  } else label += '（画面中没有可以标出的面）'
  focusLabel.textContent = label
  focusBox.hidden = false
  dirty = true
}

viewer(show, { focus })
