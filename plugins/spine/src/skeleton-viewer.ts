import { isNotApplicable, viewer, type NotApplicable, type PluginInput } from '@vormio/plugin-sdk'
import { failureMessage, SpineError } from './errors.ts'
import type { Figure, Runtime } from './preview/figure.ts'
import { fitView, panView, zoomAt, type Bounds, type View } from './preview/framing.ts'
import { readParts } from './preview/load.ts'
import type { RuntimeLine } from './preview/version.ts'
import { skeletonJson } from './skeleton-binary.ts'
import { analyzeSkeleton, type SkeletonKey } from './skeleton.ts'

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
const overlay = document.querySelector<HTMLCanvasElement>('#overlay')!
const focusBox = document.querySelector<HTMLElement>('#focus')!
const focusLabel = document.querySelector<HTMLElement>('#focus-label')!
const focusClear = document.querySelector<HTMLButtonElement>('#focus-clear')!

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
/** The shown file: what reads its keys back (see `keysOf`). */
let shown: { input: PluginInput; runtime: Runtime; json?: Record<string, unknown> } | undefined
/** What each key of the analyzer's report stands for, read when the host first asks. */
let keys: Map<string, SkeletonKey> | undefined
/** The part the host asked to show, until the next one, F or another file. */
let focused: { entry: SkeletonKey; label: string } | undefined
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
    drawFocus()
    return
  }
  figure.render(
    { x: view.x, y: view.y, unitsPerPixel: 1 / (view.scale * ratio()) },
    canvas.width,
    canvas.height,
  )
  drawFocus()
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
  canvas.width = overlay.width = Math.max(1, Math.round(canvas.clientWidth * ratio()))
  canvas.height = overlay.height = Math.max(1, Math.round(canvas.clientHeight * ratio()))
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
  clearFocus()
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
  clearFocus()
  shown = undefined
  keys = undefined
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
    shown = {
      input,
      runtime: parts.runtime,
      json: parts.skeleton instanceof ArrayBuffer ? undefined : parts.skeleton,
    }
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

// --- Focus ----------------------------------------------------------------------------------------

/** The colour of the marks: amber, visible over most skeletons and on both themes. */
const accent = '#f59e0b'

/**
 * What the keys of this file's report stand for. They are the analyzer's own: a JSON skeleton is
 * analyzed as the analyzer page does; a binary one is written back as JSON the way the analyzer
 * page writes it (skeleton-binary.ts), from the data this runtime read.
 */
function keysOf(): Map<string, SkeletonKey> | undefined {
  if (keys || !shown || !figure) return keys
  const json =
    shown.json ??
    skeletonJson(
      shown.runtime.spine,
      shown.runtime.line,
      figure.data as Parameters<typeof skeletonJson>[2],
    )
  keys = new Map()
  try {
    analyzeSkeleton(json, shown.input.name, keys)
  } catch {
    // A skeleton the analyzer refuses has no keys the host could ask for.
  }
  return keys
}

function clearFocus(): void {
  focused = undefined
  focusBox.hidden = true
  drawFocus()
}
focusClear.addEventListener('click', clearFocus)

/**
 * Shows the part `key` of the analyzer's report: switches to a skin, plays an animation, or marks
 * an attachment, a slot or a bone on the skeleton; an attachment of another skin switches to that
 * skin first. Keys this file does not have are ignored.
 */
function focus(key: string, input: PluginInput): void {
  if (!figure || !shown || shown.input.url !== input.url) return
  const entry = keysOf()?.get(key)
  if (!entry) return
  clearFocus()
  const name = entry.written ?? entry.name
  let label = `已定位：${entry.kind} ${entry.name}`
  switch (entry.collection) {
    case 'skins':
      if (figure.skins.includes(name)) {
        figure.setSkin(name)
        skinSelect.value = name
        showAnimation(figure.animation)
      }
      break
    case 'animations':
      if (figure.animations.some((each) => each.name === name)) showAnimation(name)
      break
    case 'attachments':
      // Attachments of the default skin show under every skin.
      if (entry.skin && entry.skin !== 'default' && entry.skin !== figure.skin) {
        figure.setSkin(entry.skin)
        skinSelect.value = entry.skin
        showAnimation(figure.animation)
      }
      break
    case 'slots':
    case 'bones':
      break
    default:
      label += '（画面中没有可以标出的部分）'
  }
  focused = { entry, label }
  focusBox.hidden = false
  drawFocus()
}

/** Draws the mark of the focused attachment, slot or bone over the skeleton, as it is now. */
function drawFocus(): void {
  const context = overlay.getContext('2d')
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, overlay.width, overlay.height)
  if (!focused || !figure) return
  const { entry } = focused
  let note = ''
  // Skeleton coordinates have y up; the view puts `view.x, view.y` at the centre of the canvas.
  const scale = view.scale * ratio()
  const toCanvas = (x: number, y: number): [number, number] => [
    overlay.width / 2 + (x - view.x) * scale,
    overlay.height / 2 - (y - view.y) * scale,
  ]
  context.strokeStyle = accent
  context.fillStyle = 'rgb(245 158 11 / 25%)'
  context.lineWidth = 2 * ratio()
  context.lineJoin = 'round'

  if (entry.collection === 'bones') {
    const bone = figure.bone(entry.written ?? entry.name)
    if (bone) {
      const [x1, y1] = toCanvas(bone[0], bone[1])
      const [x2, y2] = toCanvas(bone[2], bone[3])
      context.beginPath()
      context.arc(x1, y1, 4 * ratio(), 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.beginPath()
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
      context.stroke()
    }
  } else if (entry.collection === 'attachments' || entry.collection === 'slots') {
    const slot = entry.collection === 'slots' ? (entry.written ?? entry.name) : entry.slot!
    const drawn = entry.collection === 'slots' || figure.draws(entry.skin!, slot, entry.attachment!)
    const outline = drawn ? figure.outline(slot) : undefined
    if (outline) {
      const { vertices, triangles } = outline
      const point = (index: number) => toCanvas(vertices[index * 2]!, vertices[index * 2 + 1]!)
      context.beginPath()
      if (triangles?.length)
        for (let index = 0; index + 2 < triangles.length; index += 3) {
          const [a, b, c] = [triangles[index]!, triangles[index + 1]!, triangles[index + 2]!]
          context.moveTo(...point(a))
          context.lineTo(...point(b))
          context.lineTo(...point(c))
          context.closePath()
        }
      else {
        context.moveTo(...point(0))
        for (let index = 1; index < vertices.length / 2; index++) context.lineTo(...point(index))
        context.closePath()
      }
      context.fill()
      context.stroke()
    } else
      note =
        entry.collection === 'slots' ? '（插槽现在没有可见的附件）' : '（这个附件现在没有显示）'
  }
  focusLabel.textContent = focused.label + note
}

viewer(show, { focus })
