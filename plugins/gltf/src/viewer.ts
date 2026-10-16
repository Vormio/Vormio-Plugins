import { viewer, type PluginInput } from '@vormio/plugin-sdk'
import {
  AnimationMixer,
  Box3,
  LoopRepeat,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Camera,
  type Mesh,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { describeProblem, explainFailures } from '../../../shared/companions.ts'
import { failureMessage } from './errors.ts'
import { Highlight, resolveFocus, type FocusTarget } from './focus.ts'
import { defaultDirection, frameModel, type Framing } from './framing.ts'
import { measure, ModelLoader, type Model } from './model.ts'
import { prepareRenderer, stageScene } from './stage.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const info = document.querySelector<HTMLElement>('#info')!
const warnings = document.querySelector<HTMLUListElement>('#warnings')!
const fitButton = document.querySelector<HTMLButtonElement>('#fit')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!
const playback = document.querySelector<HTMLElement>('#playback')!
const clipSelect = document.querySelector<HTMLSelectElement>('#clip')!
const playButton = document.querySelector<HTMLButtonElement>('#play')!
const timeInput = document.querySelector<HTMLInputElement>('#time')!
const clock = document.querySelector<HTMLElement>('#clock')!
const variantSelect = document.querySelector<HTMLSelectElement>('#variant')!
const cameraSelect = document.querySelector<HTMLSelectElement>('#camera')!
const focusBox = document.querySelector<HTMLElement>('#focus')!
const focusLabel = document.querySelector<HTMLElement>('#focus-label')!
const focusClear = document.querySelector<HTMLButtonElement>('#focus-clear')!

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const environment = prepareRenderer(renderer)
const loader = new ModelLoader(renderer)
const camera = new PerspectiveCamera(35, 1, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.screenSpacePanning = true
controls.zoomToCursor = true

let current:
  | {
      model: Model
      input: PluginInput
      scene: ReturnType<typeof stageScene>
      /** Present when the file has animations; `action` plays the chosen clip. */
      mixer?: AnimationMixer
      action?: AnimationAction
    }
  | undefined
let dirty = true
/** Until the user moves the camera, a resize frames the model again for the new shape. */
let userMoved = false
let playing = false
/** While the time slider is dragged, it sets the time instead of the clock. */
let scrubbing = false
/** When the previous frame was drawn while playing, for the time step of the next one. */
let previousFrame: number | undefined
/** A camera from the file the view looks through, until the user moves the view. */
let fileCamera: Camera | undefined
/** The subresource the host asked to show, until the next one, F, R or another file. */
let focused: { key: string; target: FocusTarget } | undefined
const highlight = new Highlight()

function render(): void {
  dirty = false
  if (current) renderer.render(current.scene, fileCamera ?? camera)
  else renderer.clear()
}

controls.addEventListener('change', () => (dirty = true))
controls.addEventListener('start', () => {
  userMoved = true
  if (fileCamera) takeOver()
})
renderer.setAnimationLoop((now: number) => {
  if (playing && !scrubbing && current?.action) {
    // At most 0.1 s per frame, so coming back to a hidden page does not jump ahead.
    const step = previousFrame === undefined ? 0 : Math.min((now - previousFrame) / 1000, 0.1)
    current.mixer!.update(step)
    showTime()
    dirty = true
  }
  previousFrame = playing ? now : undefined
  // update() keeps returning true while damping settles.
  if (controls.update() || dirty) render()
})

/** Frames the whole model, looking along `direction` (from the model towards the camera). */
function frame(direction: Vector3): void {
  if (!current) return
  place(frameModel(current.model, direction, camera.fov, camera.aspect, 1.25))
}

function place(framing: Framing): void {
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

/** Frames the current pose again from the current viewing direction (F). */
function fit(): void {
  clearFocus()
  if (fileCamera) takeOver()
  if (current?.action) Object.assign(current.model, measure(current.model.root))
  frame(camera.position.clone().sub(controls.target))
}

/** Back to the starting view (R). */
function reset(): void {
  clearFocus()
  lookThrough(undefined)
  userMoved = false
  frame(defaultDirection)
}

function resize(): void {
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  fitFileCamera()
  if (!userMoved) frame(defaultDirection)
  // Resizing clears the canvas. ResizeObserver runs after this frame's animation callbacks but
  // before it is painted, so draw now; waiting for the next frame shows an empty view in between.
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
  else if (event.key === ' ') {
    // Buttons, the clip list and the slider handle the space bar themselves.
    const target = event.target
    if (
      target instanceof HTMLButtonElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLInputElement
    )
      return
    event.preventDefault()
    setPlaying(!playing)
  }
})

// --- Cameras in the file ----------------------------------------------------------------------------

/** The vertical half-size of each orthographic camera as the file gives it. */
const fileHeights = new WeakMap<OrthographicCamera, number>()

/**
 * Fits a file camera's projection to the view: a perspective camera keeps its vertical field of
 * view, an orthographic one its vertical size; the width follows the view instead of the file's
 * aspect ratio, so the picture is not stretched.
 */
function fitFileCamera(): void {
  if (fileCamera instanceof PerspectiveCamera) {
    fileCamera.aspect = camera.aspect
    fileCamera.updateProjectionMatrix()
  } else if (fileCamera instanceof OrthographicCamera) {
    if (!fileHeights.has(fileCamera)) fileHeights.set(fileCamera, fileCamera.top)
    const height = fileHeights.get(fileCamera)!
    fileCamera.top = height
    fileCamera.bottom = -height
    fileCamera.right = height * camera.aspect
    fileCamera.left = -height * camera.aspect
    fileCamera.updateProjectionMatrix()
  }
}

/** Looks through the file's camera at `index`, or the free camera for undefined. */
function lookThrough(index: number | undefined): void {
  fileCamera = index === undefined ? undefined : current?.model.cameras[index]?.camera
  cameraSelect.value = fileCamera ? String(index) : 'free'
  fitFileCamera()
  dirty = true
}

/**
 * Moving the view leaves the file camera: the free camera starts where it was and looks the same
 * way, at the depth of the model's centre.
 */
function takeOver(): void {
  const from = fileCamera
  if (!from || !current) return
  lookThrough(undefined)
  from.updateMatrixWorld(true)
  const position = new Vector3().setFromMatrixPosition(from.matrixWorld)
  const forward = new Vector3(0, 0, -1).transformDirection(from.matrixWorld)
  const { box } = current.model
  const depth = Math.max(
    box.getCenter(new Vector3()).sub(position).dot(forward),
    box.getSize(new Vector3()).length() / 2,
  )
  camera.position.copy(position)
  controls.target.copy(position).addScaledVector(forward, depth)
  controls.update()
}

cameraSelect.addEventListener('change', () => {
  userMoved = true
  lookThrough(cameraSelect.value === 'free' ? undefined : Number(cameraSelect.value))
})

// --- Material variants ----------------------------------------------------------------------------

variantSelect.addEventListener('change', async () => {
  const shown = current
  if (!shown) return
  const value = variantSelect.value
  // A variant replaces materials, the dimmed copies included: the highlight is made again after.
  highlight.clear()
  const failures = await shown.model.selectVariant(value === 'default' ? undefined : Number(value))
  if (current !== shown) return
  if (focused) {
    const again = resolveFocus(shown.model, focused.key, container(shown.input))
    if (again) highlight.apply(shown.model.root, again.meshes)
  }
  if (failures.length) showProblems(await explainFailures(shown.input, failures))
  dirty = true
})

/** Lists textures that could not be read, after the ones listed before. */
function showProblems(problems: Awaited<ReturnType<typeof explainFailures>>): void {
  if (!problems.length) return
  if (!warnings.childElementCount) {
    const heading = document.createElement('li')
    heading.textContent = '以下贴图无法显示，相应材质只用颜色显示：'
    warnings.append(heading)
  }
  warnings.append(
    ...problems.map((problem) => {
      const item = document.createElement('li')
      item.textContent = describeProblem(problem)
      return item
    }),
  )
  warnings.hidden = false
}

/** Fills a list with `first` and one option for each name; shown only when there are names. */
function fillList(list: HTMLSelectElement, first: [string, string], names: string[]): void {
  const option = ([value, text]: [string, string]) => {
    const element = document.createElement('option')
    element.value = value
    element.textContent = text
    return element
  }
  list.replaceChildren(option(first), ...names.map((name, index) => option([String(index), name])))
  list.value = first[0]
  list.hidden = names.length === 0
}

// --- Animation ------------------------------------------------------------------------------------

function showTime(): void {
  const action = current?.action
  if (!action) return
  const duration = action.getClip().duration
  const time = Math.min(action.time, duration)
  clock.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} 秒`
  if (!scrubbing) timeInput.value = String(time)
}

function setPlaying(value: boolean): void {
  if (!current?.action) return
  playing = value
  playButton.textContent = playing ? '暂停' : '播放'
  playButton.setAttribute('aria-pressed', String(playing))
}

/** Plays the clip at `index` from its start, keeping whether it plays or is paused. */
function choose(index: number): void {
  if (!current?.mixer) return
  const { clip } = current.model.animations[index]!
  current.mixer.stopAllAction()
  current.action = current.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play()
  current.action.time = 0
  current.mixer.update(0)
  timeInput.max = String(clip.duration)
  showTime()
  dirty = true
}

function seek(time: number): void {
  if (!current?.action) return
  current.action.time = time
  current.mixer!.update(0)
  showTime()
  dirty = true
}

clipSelect.addEventListener('change', () => choose(Number(clipSelect.value)))
playButton.addEventListener('click', () => setPlaying(!playing))
timeInput.addEventListener('pointerdown', () => (scrubbing = true))
timeInput.addEventListener('input', () => seek(Number(timeInput.value)))
for (const type of ['pointerup', 'pointercancel', 'change'])
  timeInput.addEventListener(type, () => (scrubbing = false))

/** Shows the controls for a model with animations, posed at the start of its first clip. */
function prepareAnimations(model: Model): void {
  if (!current || !model.animations.length) return
  current.mixer = new AnimationMixer(model.root)
  clipSelect.replaceChildren(
    ...model.animations.map(({ name, clip }, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `${name}（${clip.duration.toFixed(2)} 秒）`
      return option
    }),
  )
  clipSelect.disabled = model.animations.length < 2
  choose(0)
  // The first frame decides the framing. Playing starts with the first animation frame, which
  // comes only once the host shows the page.
  Object.assign(model, measure(model.root))
  setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches)
  playback.hidden = false
}

function clear(): void {
  clearFocus()
  current?.mixer?.stopAllAction()
  current?.mixer?.uncacheRoot(current.model.root)
  current?.model.dispose()
  current = undefined
  info.textContent = ''
  warnings.replaceChildren()
  warnings.hidden = true
  fitButton.disabled = resetButton.disabled = true
  fileCamera = undefined
  variantSelect.hidden = cameraSelect.hidden = true
  playback.hidden = true
  playing = false
  previousFrame = undefined
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

  current = { model, input, scene: stageScene(environment, model.root) }
  prepareAnimations(model)
  fillList(variantSelect, ['default', '默认材质'], model.variants)
  fillList(
    cameraSelect,
    ['free', '自由视角'],
    model.cameras.map(({ name }) => name),
  )
  userMoved = false
  frame(defaultDirection)
  fitButton.disabled = resetButton.disabled = false
  const clips = model.animations.length ? ` · ${model.animations.length} 段动画` : ''
  info.textContent = `${model.triangles.toLocaleString('zh-CN')} 个三角形${clips}`
  showProblems(problems)
  // Render before reporting ready, so the host never shows an empty frame.
  render()
}

// --- Focus ----------------------------------------------------------------------------------------

const container = (input: PluginInput) => (input.extension === 'glb' ? 'glb' : 'gltf')

function clearFocus(): void {
  highlight.clear()
  focused = undefined
  focusBox.hidden = true
  dirty = true
}
focusClear.addEventListener('click', clearFocus)

/** Frames `meshes` in their current pose from the current viewing direction. */
function frameMeshes(meshes: Mesh[]): void {
  const box = new Box3()
  const points: Float32Array[] = []
  let complete = true
  for (const mesh of meshes) {
    const part = measure(mesh)
    box.union(part.box)
    if (part.points) points.push(part.points)
    else complete = false
  }
  if (box.isEmpty()) return
  if (fileCamera) takeOver()
  let all: Float32Array | undefined
  if (complete) {
    all = new Float32Array(points.reduce((sum, each) => sum + each.length, 0))
    let offset = 0
    for (const each of points) {
      all.set(each, offset)
      offset += each.length
    }
  }
  const direction = camera.position.clone().sub(controls.target)
  place(frameModel({ box, points: all }, direction, camera.fov, camera.aspect, 1.25))
  userMoved = true
}

/**
 * Shows the subresource `key` of the analyzer's report: frames and keeps the meshes it stands for
 * while the rest is dimmed, looks through a camera, or plays an animation. Keys this file does not
 * have are ignored.
 */
function focus(key: string, input: PluginInput): void {
  if (!current || current.input.url !== input.url) return
  const target = resolveFocus(current.model, key, container(input))
  if (!target) return
  clearFocus()
  focused = { key, target }
  let label = `已定位：${target.label}`
  if (target.camera !== undefined) {
    userMoved = true
    lookThrough(target.camera)
  } else if (target.animation !== undefined && current.mixer) {
    clipSelect.value = String(target.animation)
    choose(target.animation)
    setPlaying(true)
  } else if (target.whole) {
    if (fileCamera) takeOver()
    frame(camera.position.clone().sub(controls.target))
  } else if (target.meshes.length) {
    highlight.apply(current.model.root, target.meshes)
    frameMeshes(target.meshes)
  } else label += '（画面中没有可以标出的部分）'
  focusLabel.textContent = label
  focusBox.hidden = false
  dirty = true
}

viewer(show, { focus })
