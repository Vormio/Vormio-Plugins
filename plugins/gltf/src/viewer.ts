import { viewer, type PluginInput } from '@vormio/plugin-sdk'
import {
  AnimationMixer,
  LoopRepeat,
  PerspectiveCamera,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { describeProblem, explainFailures } from './companions.ts'
import { failureMessage } from './errors.ts'
import { defaultDirection, frameModel } from './framing.ts'
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

function render(): void {
  dirty = false
  if (current) renderer.render(current.scene, camera)
  else renderer.clear()
}

controls.addEventListener('change', () => (dirty = true))
controls.addEventListener('start', () => (userMoved = true))
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

/** Frames the current pose again from the current viewing direction (F). */
function fit(): void {
  if (current?.action) Object.assign(current.model, measure(current.model.root))
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
  current?.mixer?.stopAllAction()
  current?.mixer?.uncacheRoot(current.model.root)
  current?.model.dispose()
  current = undefined
  info.textContent = ''
  warnings.replaceChildren()
  warnings.hidden = true
  fitButton.disabled = resetButton.disabled = true
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

  current = { model, scene: stageScene(environment, model.root) }
  prepareAnimations(model)
  userMoved = false
  frame(defaultDirection)
  fitButton.disabled = resetButton.disabled = false
  const clips = model.animations.length ? ` · ${model.animations.length} 段动画` : ''
  info.textContent = `${model.triangles.toLocaleString('zh-CN')} 个三角形${clips}`
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
  render()
}

viewer(show)
