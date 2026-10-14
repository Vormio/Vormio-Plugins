// Fitting a skeleton into the thumbnail and the viewer. Skeleton coordinates have y up. A view is
// the skeleton point at the centre of the canvas and the scale in CSS pixels per skeleton unit. No
// DOM, so it runs in Node tests as well as in the plugin pages.

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface View {
  x: number
  y: number
  scale: number
}

/** The zoom range, relative to the scale that fits the skeleton. */
export const zoomRange = { min: 0.1, max: 32 }

/** Whether `bounds` encloses something: finite, with some width or height. */
export function hasArea(bounds: Bounds | undefined): bounds is Bounds {
  return (
    bounds !== undefined &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width >= 0 &&
    bounds.height >= 0 &&
    bounds.width + bounds.height > 0
  )
}

/** The bounds enclosing both. */
export function union(a: Bounds | undefined, b: Bounds): Bounds {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** `bounds` grown by `share` of its longer side on every edge. */
export function pad(bounds: Bounds, share: number): Bounds {
  const margin = Math.max(bounds.width, bounds.height) * share
  return {
    x: bounds.x - margin,
    y: bounds.y - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  }
}

/** The pixel size that shows `bounds` with its proportions, the longer side `maxEdge`. */
export function thumbnailSize(bounds: Bounds, maxEdge: number): { width: number; height: number } {
  const longer = Math.max(bounds.width, bounds.height, Number.EPSILON)
  return {
    width: Math.max(1, Math.round((maxEdge * bounds.width) / longer)),
    height: Math.max(1, Math.round((maxEdge * bounds.height) / longer)),
  }
}

/** The view that shows `bounds` whole and centred in `viewport`, with `margin` CSS pixels around. */
export function fitView(
  bounds: Bounds,
  viewport: { width: number; height: number },
  margin = 32,
): View {
  const room = {
    width: Math.max(1, viewport.width - margin * 2),
    height: Math.max(1, viewport.height - margin * 2),
  }
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    scale: Math.min(
      room.width / Math.max(Number.EPSILON, bounds.width),
      room.height / Math.max(Number.EPSILON, bounds.height),
    ),
  }
}

/** The view moved by a drag of (`dx`, `dy`) CSS pixels; screen y points down. */
export function panView(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x - dx / view.scale, y: view.y + dy / view.scale }
}

/**
 * The view zoomed by `factor` around the CSS point (`px`, `py`) from the top left of `viewport`,
 * within `zoomRange` of the fitting scale `fit`. The skeleton point under the cursor stays there.
 */
export function zoomAt(
  view: View,
  factor: number,
  px: number,
  py: number,
  viewport: { width: number; height: number },
  fit: number,
): View {
  const scale = Math.min(fit * zoomRange.max, Math.max(fit * zoomRange.min, view.scale * factor))
  const dx = px - viewport.width / 2
  const dy = py - viewport.height / 2
  const x = view.x + dx / view.scale
  const y = view.y - dy / view.scale
  return { x: x - dx / scale, y: y + dy / scale, scale }
}
