import { thumbnail } from '@vormio/plugin-sdk'
import { parseAtlas } from './atlas.ts'
import { SpineError } from './errors.ts'
import { describePageProblem, loadPage, readText } from './source.ts'

// The first page image that can be read, scaled to fit the requested size with its proportions
// kept; the background stays transparent. An atlas whose pages all fail has no thumbnail, and the
// host shows its type icon.
thumbnail(async (input, { maxEdge }) => {
  const { pages } = parseAtlas(await readText(input))
  const problems: string[] = []
  for (const page of pages) {
    const loaded = await loadPage(input, page)
    if ('problem' in loaded) {
      problems.push(describePageProblem(page, loaded.problem))
      continue
    }
    const { image } = loaded
    try {
      const scale = maxEdge / Math.max(image.width, image.height)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')!
      // Enlarged pages keep their pixels sharp; reduced ones are smoothed.
      context.imageSmoothingEnabled = scale < 1
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)
      return canvas
    } finally {
      image.close()
    }
  }
  throw new SpineError(`贴图页都无法显示：${problems.join('；')}`.slice(0, 400))
})
