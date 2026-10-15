// Drives the plugin pages from Playwright: a fake `window.vormio` bridge that records what the page
// reports, and pixel statistics computed in the page. Functions passed to the page must be
// self-contained, because Playwright sends them as source text.

import type { Page } from '@playwright/test'
import type { CompositionReport, NotApplicable, PluginInput } from '@vormio/plugin-sdk'

export interface BridgeState {
  input: PluginInput
  ready: string[]
  failures: { url: string; message: string }[]
  /** Inputs the viewer answered were not its format. */
  notApplicable: string[]
  violations: string[]
  listeners: ((input: PluginInput) => void)[]
  /** The viewer's subscriptions to the host's requests to show a subresource. */
  focusListeners: ((focus: { url: string; key: string }) => void)[]
  /** Shows or hides a viewer page as the host does; undefined on other pages. */
  setVisible?: (visible: boolean) => void
  thumbnail?: (
    input: PluginInput,
    size: { maxEdge: number },
  ) => Promise<ArrayBuffer | NotApplicable>
  analyze?: (input: PluginInput) => Promise<CompositionReport | NotApplicable>
}

declare global {
  interface Window {
    bridgeState: BridgeState
  }
}

/** The address of a plugin page that starts with `input` (read by the bridge, not the page). */
export function pageUrl(origin: string, entry: string, input?: PluginInput): string {
  return `${origin}/${entry}${input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`
}

/** Installs the bridge before the page's scripts run, on every navigation of `page`. */
export async function installBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const initial = new URLSearchParams(location.search).get('input')
    const state: BridgeState = {
      input: initial
        ? (JSON.parse(initial) as PluginInput)
        : { url: '', name: '', extension: '', size: 0 },
      ready: [],
      failures: [],
      notApplicable: [],
      violations: [],
      listeners: [],
      focusListeners: [],
    }
    window.bridgeState = state
    document.addEventListener('securitypolicyviolation', (event) =>
      state.violations.push(`${event.effectiveDirective} ${event.blockedURI}`),
    )

    // Like the host, a viewer stays hidden until it reports ready, and again from moving to another
    // file until it reports ready for that one. A hidden page draws no frames, so animation frame
    // callbacks and image decode() wait until it is shown. Viewer pages are the ones opened with an
    // input; thumbnail and analyzer pages run in windows that keep drawing.
    if (initial) {
      let visible = false
      const frame = window.requestAnimationFrame.bind(window)
      const cancelFrame = window.cancelAnimationFrame.bind(window)
      const decode = HTMLImageElement.prototype.decode
      /** Callbacks requested and not yet run, by the ID the page got. */
      const waiting = new Map<number, FrameRequestCallback>()
      /** Native frame requests for the waiting callbacks, while the page is visible. */
      const scheduled = new Map<number, number>()
      const decodes: (() => void)[] = []
      let next = 1
      const schedule = (id: number) =>
        scheduled.set(
          id,
          frame((time) => {
            scheduled.delete(id)
            const callback = waiting.get(id)
            waiting.delete(id)
            callback?.(time)
          }),
        )
      window.requestAnimationFrame = (callback) => {
        const id = next++
        waiting.set(id, callback)
        if (visible) schedule(id)
        return id
      }
      window.cancelAnimationFrame = (id) => {
        waiting.delete(id)
        const handle = scheduled.get(id)
        if (handle !== undefined) cancelFrame(handle)
        scheduled.delete(id)
      }
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (visible) return decode.call(this)
        return new Promise<void>((resolve, reject) =>
          decodes.push(() => void decode.call(this).then(resolve, reject)),
        )
      }
      Object.defineProperty(document, 'visibilityState', {
        get: () => (visible ? 'visible' : 'hidden'),
      })
      Object.defineProperty(document, 'hidden', { get: () => !visible })
      state.setVisible = (value) => {
        if (value === visible) return
        visible = value
        document.dispatchEvent(new Event('visibilitychange'))
        if (visible) {
          for (const id of waiting.keys()) if (!scheduled.has(id)) schedule(id)
          for (const run of decodes.splice(0)) run()
        } else {
          for (const handle of scheduled.values()) cancelFrame(handle)
          scheduled.clear()
        }
      }
    }
    Object.defineProperty(window, 'vormio', {
      value: Object.freeze({
        getInput: () => Promise.resolve(state.input),
        onInput(listener: (input: PluginInput) => void) {
          state.listeners.push(listener)
          return () => undefined
        },
        ready: (input: PluginInput) => {
          state.ready.push(input.url)
          state.setVisible?.(true)
        },
        fail: (input: PluginInput, message: string) =>
          state.failures.push({ url: input.url, message }),
        // The host moves on to another viewer; this page stays hidden.
        notApplicable: (input: PluginInput) => state.notApplicable.push(input.url),
        onThumbnailRequest(handler: BridgeState['thumbnail']) {
          state.thumbnail = handler
        },
        onAnalyzeRequest(handler: BridgeState['analyze']) {
          state.analyze = handler
        },
        onFocus(listener: BridgeState['focusListeners'][number]) {
          state.focusListeners.push(listener)
          return () => undefined
        },
      }),
    })
  })
}

/**
 * Waits until the viewer reported ready, failed or answered not applicable for `url`. Polls on a
 * timer: until it is ready, the viewer is hidden and gets no animation frames.
 */
export async function viewerOutcome(
  page: Page,
  url: string,
): Promise<{ ready: boolean; message?: string; notApplicable?: true }> {
  await page.waitForFunction(
    (url) =>
      window.bridgeState.ready.includes(url) ||
      window.bridgeState.notApplicable.includes(url) ||
      window.bridgeState.failures.some((failure) => failure.url === url),
    url,
    { polling: 50 },
  )
  return page.evaluate((url) => {
    const failure = window.bridgeState.failures.find((each) => each.url === url)
    if (failure) return { ready: false, message: failure.message }
    if (window.bridgeState.notApplicable.includes(url))
      return { ready: false, notApplicable: true as const }
    return { ready: true }
  }, url)
}

/** Moves the viewer to another file, as the host does when the user goes to the next one. */
export async function switchInput(page: Page, input: PluginInput): Promise<void> {
  await page.evaluate((input) => {
    window.bridgeState.input = input
    window.bridgeState.setVisible?.(false)
    for (const listener of window.bridgeState.listeners) listener(input)
  }, input)
}

/** Asks the viewer to show the subresource `key` of the file at `url`, as the host does. */
export async function focusSubresource(page: Page, url: string, key: string): Promise<void> {
  await page.evaluate(
    ({ url, key }) => {
      for (const listener of window.bridgeState.focusListeners) listener({ url, key })
    },
    { url, key },
  )
}

/**
 * Script for a viewer page: after every resize of the canvas, records what the canvas holds at
 * that moment, before the browser paints. Its ResizeObserver is created after the viewer's, so it
 * runs right after the viewer has handled the resize. Kept as text so it can also run in the
 * real host (`webContents.executeJavaScript`).
 */
export const resizeProbe = `(() => {
  const canvas = document.querySelector('#view')
  const copy = new OffscreenCanvas(1, 1)
  const frames = (window.resizeFrames = [])
  new ResizeObserver(() => {
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d')
    context.drawImage(canvas, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    let drawn = 0
    for (let index = 3; index < data.length; index += 16) if (data[index] > 0) drawn++
    frames.push({ width: canvas.width, height: canvas.height, drawn: drawn / (data.length / 16) })
  }).observe(canvas)
})()`

export interface ResizeFrame {
  width: number
  height: number
  /** Share of the canvas with something drawn on it, right after the resize. */
  drawn: number
}

export interface PixelStats {
  width: number
  height: number
  /** Share of pixels with alpha above 200. */
  opaque: number
  cornerAlpha: number
  /** Share of all pixels that are clearly this hue (saturated and not dark). */
  hues: Record<'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple', number>
}

/** Statistics of a PNG (as base64), decoded in the page. */
export function pixelStats(page: Page, base64: string): Promise<PixelStats> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const pixels = bitmap.width * bitmap.height
    const hues = { red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0 }
    let opaque = 0
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b, a] = [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!]
      if (a > 200) opaque++
      if (a < 128) continue
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max < 60 || (max - min) / max < 0.45) continue
      let hue =
        max === r
          ? ((g - b) / (max - min)) * 60
          : max === g
            ? (2 + (b - r) / (max - min)) * 60
            : (4 + (r - g) / (max - min)) * 60
      if (hue < 0) hue += 360
      if (hue < 15 || hue >= 330) hues.red++
      else if (hue < 40) hues.orange++
      else if (hue < 70) hues.yellow++
      else if (hue < 170) hues.green++
      else if (hue < 255) hues.blue++
      else hues.purple++
    }
    for (const key of Object.keys(hues) as (keyof typeof hues)[]) hues[key] /= pixels
    return {
      width: bitmap.width,
      height: bitmap.height,
      opaque: opaque / pixels,
      cornerAlpha: data[3]!,
      hues,
    }
  }, base64)
}

/** Share of pixels that differ clearly between two PNGs of the same size. */
export function pixelDifference(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [first, second] = await Promise.all([decode(a!), decode(b!)])
      if (first.length !== second.length) return 1
      let different = 0
      for (let index = 0; index < first.length; index += 4) {
        let delta = 0
        for (let channel = 0; channel < 4; channel++)
          delta += Math.abs(first[index + channel]! - second[index + channel]!)
        if (delta > 40) different++
      }
      return different / (first.length / 4)
    },
    [a, b],
  )
}

/**
 * Renders a thumbnail through the page's handler; returns the PNG as base64, the error, or that
 * the page answered exactly `{ notApplicable: true }`.
 */
export async function requestThumbnail(
  page: Page,
  input: PluginInput,
  maxEdge = 320,
): Promise<{ png?: string; error?: string; notApplicable?: true }> {
  await page.waitForFunction(() => window.bridgeState.thumbnail !== undefined)
  return page.evaluate(
    async ({ input, maxEdge }) => {
      try {
        const answer = await window.bridgeState.thumbnail!(input, { maxEdge })
        if (!(answer instanceof ArrayBuffer)) {
          if (JSON.stringify(answer) === '{"notApplicable":true}')
            return { notApplicable: true as const }
          return { error: `unexpected answer ${JSON.stringify(answer)}` }
        }
        const bytes = new Uint8Array(answer)
        let binary = ''
        for (let index = 0; index < bytes.length; index += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
        return { png: btoa(binary) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    { input, maxEdge },
  )
}

/**
 * Runs the analyzer page's handler on `input`; returns the report, the error message, or that the
 * page answered exactly `{ notApplicable: true }`.
 */
export async function requestAnalysis(
  page: Page,
  input: PluginInput,
): Promise<{ report?: CompositionReport; error?: string; notApplicable?: true }> {
  await page.waitForFunction(() => window.bridgeState.analyze !== undefined)
  return page.evaluate(async (input) => {
    try {
      // The host receives the report through structured clone; JSON keeps the test to plain data.
      const answer = JSON.stringify(await window.bridgeState.analyze!(input))
      if (answer === '{"notApplicable":true}') return { notApplicable: true as const }
      return { report: JSON.parse(answer) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, input)
}
