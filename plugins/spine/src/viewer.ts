import { viewer, type PluginInput } from '@vormio/plugin-sdk'
import { parseAtlas, regionName, type Atlas, type AtlasRegion } from './atlas.ts'
import { describePageProblem, loadPage, readText, type PageImage } from './source.ts'
import { fitView, focusView, hit, toPage, zoomAt, type View } from './view.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const context = canvas.getContext('2d')!
const warnings = document.querySelector<HTMLUListElement>('#warnings')!
const pageSelect = document.querySelector<HTMLSelectElement>('#page')!
const boxesButton = document.querySelector<HTMLButtonElement>('#boxes')!
const fitButton = document.querySelector<HTMLButtonElement>('#fit')!
const info = document.querySelector<HTMLElement>('#info')!
const detail = document.querySelector<HTMLElement>('#detail')!
const search = document.querySelector<HTMLInputElement>('#search')!
const list = document.querySelector<HTMLUListElement>('#regions')!
const more = document.querySelector<HTMLElement>('#more')!

/** At most this many regions are listed; searching narrows the list. */
const listLimit = 1000

interface Shown {
  input: PluginInput
  atlas: Atlas
  /** Page images, loaded when a page is first shown. */
  images: Map<number, Promise<PageImage>>
  page: number
  /** The current page's image once loaded, or why it cannot be shown. */
  image?: PageImage
}

let shown: Shown | undefined
let view: View = { scale: 1, x: 0, y: 0 }
/** The scale that fits the current page, for the zoom range. */
let fitScale = 1
let selected = -1
let hovered = -1
let showBoxes = true
/** Until the user pans or zooms, a resize fits the page again. */
let userMoved = false
const css = getComputedStyle(document.documentElement)
const color = (name: string) => css.getPropertyValue(name).trim()

/** The current page's size: its image, else its `size`, else the extent of its regions. */
function pageSize(): { width: number; height: number } {
  if (!shown) return { width: 1, height: 1 }
  if (shown.image && 'image' in shown.image)
    return { width: shown.image.image.width, height: shown.image.image.height }
  const page = shown.atlas.pages[shown.page]!
  if (page.size && page.size.width > 0 && page.size.height > 0) return page.size
  let width = 1
  let height = 1
  for (const region of shown.atlas.regions)
    if (region.page === shown.page && region.rect) {
      width = Math.max(width, region.rect.x + region.rect.width)
      height = Math.max(height, region.rect.y + region.rect.height)
    }
  return { width, height }
}

const viewport = () => ({ width: canvas.clientWidth, height: canvas.clientHeight })
const regionsOnPage = () =>
  shown
    ? shown.atlas.regions.map((each) => (each.page === shown!.page ? each.rect : undefined))
    : []

function draw(): void {
  const ratio = Math.min(devicePixelRatio, 2)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!shown) return
  const { width, height } = pageSize()
  const left = view.x
  const top = view.y
  const right = view.x + width * view.scale
  const bottom = view.y + height * view.scale

  // A checkerboard under the page shows its transparent parts.
  context.save()
  context.beginPath()
  context.rect(left, top, right - left, bottom - top)
  context.clip()
  context.fillStyle = color('--check-a')
  context.fillRect(left, top, right - left, bottom - top)
  context.fillStyle = color('--check-b')
  const cell = 8
  const { width: screenWidth, height: screenHeight } = viewport()
  for (
    let y = Math.floor(Math.max(0, top) / cell) * cell;
    y < Math.min(bottom, screenHeight);
    y += cell
  )
    for (
      let x = Math.floor(Math.max(0, left) / cell) * cell;
      x < Math.min(right, screenWidth);
      x += cell
    )
      if ((x / cell + y / cell) % 2) context.fillRect(x, y, cell, cell)
  if (shown.image && 'image' in shown.image) {
    // Enlarged pixels stay sharp, so single pixels can be told apart.
    context.imageSmoothingEnabled = view.scale < 2
    context.drawImage(shown.image.image, left, top, right - left, bottom - top)
  }
  context.restore()

  const rects = regionsOnPage()
  const outline = (index: number, style: string, lineWidth: number, fill?: string) => {
    const rect = rects[index]
    if (!rect) return
    // Half-pixel offsets keep one-pixel lines crisp.
    const x = Math.round(view.x + rect.x * view.scale) + 0.5
    const y = Math.round(view.y + rect.y * view.scale) + 0.5
    const w = Math.max(1, Math.round(rect.width * view.scale) - 1)
    const h = Math.max(1, Math.round(rect.height * view.scale) - 1)
    if (fill) {
      context.fillStyle = fill
      context.fillRect(x, y, w, h)
    }
    context.strokeStyle = style
    context.lineWidth = lineWidth
    context.strokeRect(x, y, w, h)
  }
  if (showBoxes)
    rects.forEach((_, index) => {
      if (index !== selected && index !== hovered) outline(index, color('--box'), 1)
    })
  if (hovered >= 0 && hovered !== selected) outline(hovered, color('--accent'), 1.5)
  if (selected >= 0) outline(selected, color('--accent'), 2, 'rgb(37 99 235 / 22%)')
}

function describeRegion(region: AtlasRegion): string {
  const parts = [regionName(region)]
  if (region.rect) {
    parts.push(`${region.width} × ${region.height}`)
    parts.push(`位置 ${region.rect.x}, ${region.rect.y}`)
  } else parts.push('没有位置')
  if (region.degrees) parts.push(`旋转 ${region.degrees}°`)
  return parts.join(' · ')
}

function updateDetail(): void {
  const index = hovered >= 0 ? hovered : selected
  const region = index >= 0 ? shown?.atlas.regions[index] : undefined
  detail.textContent = region ? describeRegion(region) : ''
}

function updateInfo(): void {
  if (!shown) {
    info.textContent = ''
    return
  }
  const { atlas, page } = shown
  const { width, height } = pageSize()
  const count = atlas.regions.filter((each) => each.page === page).length
  const position = atlas.pages.length > 1 ? `页面 ${page + 1}/${atlas.pages.length} · ` : ''
  info.textContent = `${position}${atlas.pages[page]!.name} · ${width} × ${height} · ${count} 个区域`
}

function updateWarnings(): void {
  const page = shown?.atlas.pages[shown.page]
  if (!page || !shown?.image || !('problem' in shown.image)) {
    warnings.replaceChildren()
    warnings.hidden = true
    return
  }
  const item = document.createElement('li')
  item.textContent = `贴图页无法显示，只显示区域框：${describePageProblem(page, shown.image.problem)}`
  warnings.replaceChildren(item)
  warnings.hidden = false
}

function fit(): void {
  if (!shown) return
  view = fitView(pageSize(), viewport())
  fitScale = view.scale
  draw()
}

function resize(): void {
  const ratio = Math.min(devicePixelRatio, 2)
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio))
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio))
  if (!userMoved) fit()
  else fitScale = fitView(pageSize(), viewport()).scale
  // Resizing clears the canvas; draw before the browser paints.
  draw()
}
new ResizeObserver(resize).observe(canvas)

/** Shows page `index` of the current atlas, loading its image the first time. */
async function showPage(index: number, signal?: AbortSignal): Promise<void> {
  if (!shown) return
  const current = shown
  current.page = index
  current.image = undefined
  pageSelect.value = String(index)
  hovered = -1
  let image = current.images.get(index)
  if (!image) {
    image = loadPage(current.input, current.atlas.pages[index]!)
    current.images.set(index, image)
  }
  const loaded = await image
  if (signal?.aborted || shown !== current || current.page !== index) return
  current.image = loaded
  userMoved = false
  fit()
  updateInfo()
  updateWarnings()
  updateDetail()
}

function select(index: number, focus: boolean): void {
  if (!shown) return
  selected = index
  for (const button of list.querySelectorAll<HTMLButtonElement>('button'))
    button.setAttribute('aria-current', String(Number(button.dataset.region) === index))
  updateDetail()
  const region = shown.atlas.regions[index]
  if (!region) {
    draw()
    return
  }
  const reveal = () => {
    if (focus && region.rect) {
      view = focusView(region.rect, viewport())
      userMoved = true
    }
    draw()
  }
  if (region.page !== shown.page) void showPage(region.page).then(reveal)
  else reveal()
  list
    .querySelector<HTMLButtonElement>(`button[data-region="${index}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function renderList(): void {
  if (!shown) {
    list.replaceChildren()
    more.hidden = true
    return
  }
  const query = search.value.trim().toLowerCase()
  const multiple = shown.atlas.pages.length > 1
  const matches = shown.atlas.regions
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => !query || regionName(region).toLowerCase().includes(query))
  list.replaceChildren(
    ...matches.slice(0, listLimit).map(({ region, index }) => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.region = String(index)
      button.setAttribute('aria-current', String(index === selected))
      button.title = describeRegion(region)
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = regionName(region)
      button.append(name)
      if (multiple) {
        const page = document.createElement('span')
        page.className = 'page'
        page.textContent = `页 ${region.page + 1}`
        button.append(page)
      }
      button.addEventListener('click', () => select(index, true))
      item.append(button)
      return item
    }),
  )
  more.hidden = matches.length <= listLimit
  more.textContent = `另有 ${matches.length - listLimit} 个区域没有列出，可以搜索名称。`
  if (!matches.length) {
    more.hidden = false
    more.textContent = query ? '没有符合的区域。' : '这个图集没有区域。'
  }
}

// --- Pointer and keys ------------------------------------------------------------------------------

let drag: { x: number; y: number; moved: boolean } | undefined
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !shown) return
  canvas.setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, moved: false }
})
canvas.addEventListener('pointermove', (event) => {
  if (!shown) return
  if (drag) {
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    canvas.classList.add('dragging')
    view = { ...view, x: view.x + dx, y: view.y + dy }
    drag.x = event.clientX
    drag.y = event.clientY
    userMoved = true
    draw()
    return
  }
  const bounds = canvas.getBoundingClientRect()
  const point = toPage(view, event.clientX - bounds.left, event.clientY - bounds.top)
  const found = hit(regionsOnPage(), point.x, point.y)
  if (found !== hovered) {
    hovered = found
    updateDetail()
    draw()
  }
})
canvas.addEventListener('pointerup', (event) => {
  const click = drag && !drag.moved
  drag = undefined
  canvas.classList.remove('dragging')
  if (!click || !shown) return
  const bounds = canvas.getBoundingClientRect()
  const point = toPage(view, event.clientX - bounds.left, event.clientY - bounds.top)
  select(hit(regionsOnPage(), point.x, point.y), false)
})
canvas.addEventListener('pointerleave', () => {
  if (hovered < 0) return
  hovered = -1
  updateDetail()
  draw()
})
canvas.addEventListener('dblclick', (event) => {
  if (!shown) return
  const bounds = canvas.getBoundingClientRect()
  const point = toPage(view, event.clientX - bounds.left, event.clientY - bounds.top)
  const found = hit(regionsOnPage(), point.x, point.y)
  if (found >= 0) select(found, true)
})
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!shown) return
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect()
    view = zoomAt(
      view,
      Math.exp(-event.deltaY * 0.0015),
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      fitScale,
    )
    userMoved = true
    draw()
  },
  { passive: false },
)

function toggleBoxes(): void {
  showBoxes = !showBoxes
  boxesButton.setAttribute('aria-pressed', String(showBoxes))
  draw()
}
boxesButton.addEventListener('click', toggleBoxes)
fitButton.addEventListener('click', () => {
  userMoved = false
  fit()
})
pageSelect.addEventListener('change', () => void showPage(Number(pageSelect.value)))
search.addEventListener('input', renderList)
addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
  if (event.key === 'f' || event.key === 'F') {
    userMoved = false
    fit()
  } else if (event.key === 'b' || event.key === 'B') toggleBoxes()
})

// --- Inputs ----------------------------------------------------------------------------------------

function clear(): void {
  if (shown)
    for (const image of shown.images.values())
      void image.then((loaded) => 'image' in loaded && loaded.image.close())
  shown = undefined
  selected = hovered = -1
  search.value = ''
  pageSelect.replaceChildren()
  pageSelect.hidden = true
  fitButton.disabled = true
  renderList()
  updateInfo()
  updateWarnings()
  updateDetail()
  draw()
}

async function show(input: PluginInput, signal: AbortSignal): Promise<void> {
  clear()
  const atlas = parseAtlas(await readText(input, signal))
  if (signal.aborted) return
  shown = { input, atlas, images: new Map(), page: 0 }
  pageSelect.replaceChildren(
    ...atlas.pages.map((page, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `页面 ${index + 1}：${page.name}`
      return option
    }),
  )
  pageSelect.hidden = atlas.pages.length < 2
  fitButton.disabled = false
  renderList()
  // A page image that cannot be read is shown as boxes with a warning, not as a failure.
  await showPage(0, signal)
}

viewer(show)
