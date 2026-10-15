// Checks the references from a skeleton's attachments to atlas regions against the runtimes: every
// region name a runtime looks up while reading the skeleton must be reported, by the key the atlas
// analyzer gives the region it finds, and nothing else. The keys are a contract between the two
// analyzers (Vormio/Vormio-Core#3): the host connects them only within one build of the plugin.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { parseReport } from '@vormio/plugin-sdk'
import { analyzeAtlas } from '../src/atlas.ts'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'
import { nodeRuntime, type Spine } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')

/** 3.7 and 3.8 ask for each page texture while reading the atlas, and take the page size from it. */
type Atlas38 = new (text: string, loader: () => unknown) => InstanceType<Spine['TextureAtlas']>
const texture = { setFilters() {}, setWraps() {}, getImage: () => ({ width: 128, height: 128 }) }

/** The region names the runtime of `line` looks up while reading the skeleton JSON at `path`. */
async function lookups(line: string, path: string, atlasText: string): Promise<string[]> {
  const spine = await nodeRuntime(line)
  const atlas =
    line === '3.7' || line === '3.8'
      ? new (spine.TextureAtlas as unknown as Atlas38)(atlasText, () => texture)
      : new spine.TextureAtlas(atlasText)
  const names: string[] = []
  const findRegion = atlas.findRegion.bind(atlas)
  atlas.findRegion = (name: string) => {
    names.push(name)
    return findRegion(name)
  }
  const json = JSON.parse(await readFile(join(fixtures, path), 'utf8')) as object
  new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json)
  return names
}

const skeletons = [
  ['3.7', 'preview/wizard.json'],
  ['3.8', 'preview/ranger.json'],
  ['3.8', 'legacy/goblin.json'],
  ['4.0', 'preview/scout.json'],
  ['4.1', 'preview/squire.json'],
  ['4.2', 'preview/hero.json'],
  // Sequence attachments, linked meshes and attachments named apart from their region.
  ['4.2', 'basic/hero.json'],
  ['4.3', 'preview/knight.json'],
] as const

for (const [line, path] of skeletons)
  test(`${path}: the regions the ${line} runtime looks up are the reported ones`, async () => {
    const atlasPath = path.replace(/\.json$/, '.atlas')
    const atlasText = await readFile(join(fixtures, atlasPath), 'utf8')
    const looked = await lookups(line, path, atlasText)
    assert.ok(looked.length > 0)

    const text = await readFile(join(fixtures, path), 'utf8')
    const report = analyzeSkeleton(readSkeletonJson(text), basename(path))
    assert.ok(parseReport(report).ok)
    const regions = report.references.filter((each) => each.uriKey !== undefined)
    assert.deepEqual(
      [...new Set(regions.map((each) => each.uriKey))].sort(),
      [...new Set(looked.map((name) => `region:${name}`))].sort(),
    )
    for (const each of regions) {
      assert.equal(each.uri, basename(atlasPath))
      assert.equal(each.inferred, '与骨骼文件同名')
      assert.ok(each.from?.startsWith('attachments/'), each.from)
    }
    // Each one names a region of the paired atlas's report.
    const keys = new Set(analyzeAtlas(atlasText).subresources.map((each) => each.key))
    for (const each of regions) assert.ok(keys.has(each.uriKey!), each.uriKey)
  })
