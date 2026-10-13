// Pan and zoom of a page in the viewer: page pixels to screen pixels is `screen = page * scale +
// offset`. No DOM, so it runs in Node tests as well as in the viewer page.

export interface View {
  scale: number
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The zoom range, relative to the scale that fits the page. */
export const zoomRange = { min: 0.1, max: 64 }

/** The view that shows `content` whole and centred in `viewport`, with `margin` pixels around. */
export function fitView(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 24,
): View {
  const room = {
    width: Math.max(1, viewport.width - margin * 2),
    height: Math.max(1, viewport.height - margin * 2),
  }
  const scale = Math.min(
    room.width / Math.max(1, content.width),
    room.height / Math.max(1, content.height),
  )
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  }
}

/** The view zoomed by `factor` around the screen point (`px`, `py`), within `zoomRange` of `fit`. */
export function zoomAt(view: View, factor: number, px: number, py: number, fit: number): View {
  const scale = Math.min(
    fit * zoomRange.max,
    Math.max(fit * zoomRange.min, Math.min(zoomRange.max, view.scale * factor)),
  )
  const applied = scale / view.scale
  return { scale, x: px - (px - view.x) * applied, y: py - (py - view.y) * applied }
}

/** The view that centres `rect` and lets it fill about half the viewport, never above 8×. */
export function focusView(rect: Rect, viewport: { width: number; height: number }): View {
  const scale = Math.min(
    8,
    (viewport.width * 0.5) / Math.max(1, rect.width),
    (viewport.height * 0.5) / Math.max(1, rect.height),
  )
  return {
    scale,
    x: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
  }
}

/** The page point under the screen point (`sx`, `sy`). */
export function toPage(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale }
}

/** Of the rects containing the point, the index of the smallest; -1 when none does. */
export function hit(rects: readonly (Rect | undefined)[], x: number, y: number): number {
  let found = -1
  let area = Infinity
  rects.forEach((rect, index) => {
    if (!rect || x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height)
      return
    if (rect.width * rect.height < area) {
      found = index
      area = rect.width * rect.height
    }
  })
  return found
}
