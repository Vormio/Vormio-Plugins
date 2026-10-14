import { isNotApplicable, viewer, type NotApplicable, type PluginInput } from '@vormio/plugin-sdk'
import { failureMessage, SpineError } from './errors.ts'
import type { Figure, Runtime } from './preview/figure.ts'
import { fitView, panView, zoomAt, type Bounds, type View } from './preview/framing.ts'
import { readParts } from './preview/load.ts'
import type { RuntimeLine } from './preview/version.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const warnings = document.querySelector<HTMLUListElement>('#warnings')!
const skinSelect = document.querySelector<HTMLSelectElement>('#skin')!
const animationSelect = document.querySelector<HTMLSelectElement>('#animation')!
const playButton = document.querySelector<HTMLButtonElement>('#play')!
const loopButton = document.querySelector<HTMLButtonElement>('#loop')!
const speedSelect = document.querySelector<HTMLSelectElement>('#speed')!
const fitButton = document.querySelector<HTMLButtonElement>('#fit')!
const info = document.querySelector<HTMLElement>('#info')!
const detail = document.querySelector<HTMLElement>('#detail')!

// One WebGL context for the canvas; each runtime line draws through a renderer of its own on it.
const attributes: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: true,
}
const gl = canvas.getContext('webgl', attributes)
const scenes = new Map<RuntimeLine, ReturnType<Runtime['scene']>>()
function sceneFor(runtime: Runtime) {
  let scene = scenes.get(runtime.line)
  if (!scene) {
    scene = runtime.scene(canvas, attributes)
    scenes.set(runtime.line, scene)
  }
  return scene
}

let figure: Figure | undefined
/** What the fitted view encloses: the setup pose, or the shown animation over its length. */
let extent: Bounds | undefined
let view: View = { x: 0, y: 0, scale: 1 }
/** The scale that fits the extent, for the zoom range. */
let fitScale = 1
/** Until the user pans or zooms, a resize or another animation fits the view again. */
let userMoved = false
let playing = false
let loop = true
let speed = 1
let frame = 0
let lastTime = 0

const ratio = () => Math.min(devicePixelRatio, 2)
const viewport = () => ({ width: canvas.clientWidth, height: canvas.clientHeight })
const seconds = (value: number) => `${value.toFixed(2)} 秒`
/** Room around the fitted skeleton, in CSS pixels; the toolbar and the footer sit over the canvas. */
const fitMargin = 60

function draw(): void {
  if (!figure) {
    gl?.clearColor(0, 0, 0, 0)
    gl?.clear(gl.COLOR_BUFFER_BIT)
    return
  }
  figure.render(
    { x: view.x, y: view.y, unitsPerPixel: 1 / (view.scale * ratio()) },
    canvas.width,
    canvas.height,
  )
}

function updateDetail(): void {
  if (!figure) {
    detail.textContent = ''
    return
  }
  const shown = figure.animations.find((each) => each.name === figure!.animation)
  detail.textContent = shown
    ? `${shown.name} · ${figure.time.toFixed(2)} / ${seconds(shown.duration)}`
    : '初始姿势'
}

function updateInfo(): void {
  info.textContent = figure
    ? `Spine ${figure.version} · ${figure.bones} 根骨骼 · ${figure.slots} 个插槽`
    : ''
}

function updateWarnings(): void {
  const lines: string[] = []
  if (figure?.problems.length)
    lines.push(`贴图页无法读取，用到它的附件不显示：${figure.problems.join('；')}`)
  if (figure && !extent) lines.push('骨骼在这个皮肤与动画下没有可见的附件。')
  warnings.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement('li')
      item.textContent = line
      return item
    }),
  )
  warnings.hidden = !lines.length
}

function updateControls(): void {
  const animated = !!figure?.animation
  playButton.disabled = !animated
  playButton.textContent = playing ? '暂停' : '播放'
  loopButton.disabled = speedSelect.disabled = !animated
  loopButton.setAttribute('aria-pressed', String(loop))
  fitButton.disabled = !figure
}

function fit(): void {
  if (!figure) return
  view = extent ? fitView(extent, viewport(), fitMargin) : { x: 0, y: 0, scale: 1 }
  fitScale = view.scale
  draw()
}

function resize(): void {
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio()))
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio()))
  if (!userMoved) fit()
  // Resizing clears the canvas; draw before the browser paints.
  draw()
}
new ResizeObserver(resize).observe(canvas)

// --- Playback ---------------------------------------------------------------------------------------

function tick(now: number): void {
  frame = 0
  if (!figure || !playing) return
  // A hidden page gets no frames; do not jump by the time it was away.
  const delta = Math.min(0.1, (now - lastTime) / 1000)
  lastTime = now
  figure.update(delta * speed)
  draw()
  updateDetail()
  if (figure.finished) {
    playing = false
    updateControls()
    return
  }
  frame = requestAnimationFrame(tick)
}

function setPlaying(value: boolean): void {
  playing = value && !!figure?.animation
  if (playing && figure?.finished) figure.setAnimation(figure.animation, loop)
  if (playing && !frame) {
    lastTime = performance.now()
    frame = requestAnimationFrame(tick)
  }
  if (!playing && frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  updateControls()
}

/** Shows `name` from its start, or the setup pose, and fits the view to it unless moved. */
function showAnimation(name: string | undefined): void {
  if (!figure) return
  extent = figure.extent(name)
  figure.setAnimation(name, loop)
  animationSelect.value = name ?? ''
  if (!userMoved) fit()
  draw()
  updateDetail()
  updateWarnings()
  setPlaying(!!name)
}

// --- Pointer and keys ------------------------------------------------------------------------------

let drag: { x: number; y: number } | undefined
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !figure) return
  canvas.setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY }
})
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!dx && !dy) return
  canvas.classList.add('dragging')
  view = panView(view, dx, dy)
  drag = { x: event.clientX, y: event.clientY }
  userMoved = true
  draw()
})
canvas.addEventListener('pointerup', () => {
  drag = undefined
  canvas.classList.remove('dragging')
})
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!figure) return
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect()
    view = zoomAt(
      view,
      Math.exp(-event.deltaY * 0.0015),
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      viewport(),
      fitScale,
    )
    userMoved = true
    draw()
  },
  { passive: false },
)

function refit(): void {
  userMoved = false
  fit()
}
skinSelect.addEventListener('change', () => {
  if (!figure) return
  figure.setSkin(skinSelect.value)
  showAnimation(figure.animation)
})
animationSelect.addEventListener('change', () => showAnimation(animationSelect.value || undefined))
playButton.addEventListener('click', () => setPlaying(!playing))
loopButton.addEventListener('click', () => {
  loop = !loop
  // Looping changes how the track ends, so the animation starts again.
  showAnimation(figure?.animation)
})
speedSelect.addEventListener('change', () => (speed = Number(speedSelect.value)))
fitButton.addEventListener('click', refit)
addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return
  if (event.key === 'f' || event.key === 'F') refit()
  else if (event.key === ' ' && figure?.animation) {
    event.preventDefault()
    setPlaying(!playing)
  }
})

// --- Inputs ----------------------------------------------------------------------------------------

function options(select: HTMLSelectElement, items: { value: string; label: string }[]): void {
  select.replaceChildren(
    ...items.map(({ value, label }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    }),
  )
}

function clear(): void {
  setPlaying(false)
  figure?.dispose()
  figure = extent = undefined
  userMoved = false
  skinSelect.replaceChildren()
  skinSelect.hidden = true
  animationSelect.replaceChildren()
  animationSelect.disabled = true
  updateInfo()
  updateDetail()
  updateWarnings()
  updateControls()
  draw()
}

/**
 * Shows a skeleton. JSON that is not a skeleton is not applicable: the host, which keeps the page
 * hidden until it is ready, moves on to another viewer or its built-in text preview.
 */
async function show(input: PluginInput, signal: AbortSignal): Promise<void | NotApplicable> {
  clear()
  let loaded: Figure
  try {
    const parts = await readParts(input, signal)
    if (signal.aborted) return
    if (isNotApplicable(parts)) return parts
    loaded = parts.runtime.load(sceneFor(parts.runtime), parts.skeleton, parts.atlas, parts.pages)
  } catch (error) {
    if (signal.aborted) return
    throw new SpineError(failureMessage(error))
  }
  if (signal.aborted) {
    loaded.dispose()
    return
  }
  figure = loaded
  options(
    skinSelect,
    figure.skins.map((name) => ({ value: name, label: `皮肤：${name}` })),
  )
  skinSelect.value = figure.skin
  skinSelect.hidden = figure.skins.length < 2
  options(animationSelect, [
    { value: '', label: '初始姿势' },
    ...figure.animations.map(({ name, duration }) => ({
      value: name,
      label: `${name}（${seconds(duration)}）`,
    })),
  ])
  animationSelect.disabled = false
  updateInfo()
  // The first animation plays, as in Spine's own player; a skeleton without any shows its setup pose.
  showAnimation(figure.animations[0]?.name)
}

viewer(show)
