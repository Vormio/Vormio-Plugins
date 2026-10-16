// The composition report of a binary skeleton must be the report of the same export in JSON, except
// for evidence: both are read by the runtime of their line (the binary through the plugin's own
// analysis of what the runtime read), so the two forms of one skeleton show the same composition.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseReport, type CompositionReport } from '@vormio/plugin-sdk'
import { SpineError } from '../src/errors.ts'
import {
  analyzeSkeletonBinary,
  movedSlots,
  skeletonJson,
  standInLoader,
} from '../src/skeleton-binary.ts'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'
import { requireRuntimeLine, skeletonVersion, type RuntimeLine } from '../src/preview/version.ts'
import { nodeRuntime } from './node-runtime.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')

/** A report without evidence, which a binary file cannot give. */
const withoutEvidence = (report: CompositionReport) => ({
  ...report,
  references: report.references.map(({ evidence: _evidence, ...reference }) => reference),
})

async function binaryReport(line: RuntimeLine, path: string): Promise<CompositionReport> {
  const spine = await nodeRuntime(line)
  const bytes = new Uint8Array(await readFile(join(fixtures, path)))
  return analyzeSkeletonBinary(spine, line, bytes, path.split('/').at(-1)!)
}

const pairs = [
  ['3.7', 'preview/wizard'],
  ['3.8', 'preview/ranger'],
  ['4.0', 'preview/scout'],
  ['4.1', 'preview/squire'],
  ['4.2', 'preview/hero'],
  ['4.3', 'preview/knight'],
] as const

for (const [line, base] of pairs)
  test(`${base}.skel gives the report of ${base}.json, without evidence (${line})`, async () => {
    const binary = await binaryReport(line, `${base}.skel`)
    assert.ok(parseReport(binary).ok)
    assert.ok(binary.references.every((reference) => reference.evidence === undefined))
    const text = await readFile(join(fixtures, `${base}.json`), 'utf8')
    const json = analyzeSkeleton(readSkeletonJson(text), `${base.split('/').at(-1)}.json`)
    assert.deepEqual(binary, withoutEvidence(json))
    assert.ok(binary.subresources.length > 0)
  })

// The structure fixtures cover what the figures do not: every attachment type, sequences, linked
// meshes in other skins and slots, skins with bones and constraints, every constraint (4.3 in one
// list, with sliders), events with audio, and every timeline. They are JSON, so the runtime reads
// them with its JSON reader into the same data classes its binary reader makes; written back by the
// plugin and analyzed, they must give the report of the file itself.
const structures = [
  ['3.7', 'legacy/druid.json'],
  ['3.8', 'legacy/goblin.json'],
  ['4.2', 'basic/hero.json'],
  ['4.3', 'basic/paladin.json'],
  ['4.3', 'preview/knight.json'],
] as const

for (const [line, path] of structures)
  test(`${path}: what the ${line} runtime reads, written back, gives the file's own report`, async () => {
    const spine = await nodeRuntime(line)
    const text = await readFile(join(fixtures, path), 'utf8')
    const data = new spine.SkeletonJson(standInLoader(spine, line)).readSkeletonData(
      JSON.parse(text) as object,
    )
    const name = path.split('/').at(-1)!
    const written = analyzeSkeleton(skeletonJson(spine, line, data), name)
    const original = analyzeSkeleton(readSkeletonJson(text), name)
    assert.ok(original.subresources.length > 0)
    assert.deepEqual(withoutEvidence(written), withoutEvidence(original))
  })

test('a binary skeleton the runtime cannot read fails with the runtime’s reason', async () => {
  const spine = await nodeRuntime('4.2')
  const bytes = new Uint8Array(await readFile(join(fixtures, 'preview/truncated.skel')))
  assert.throws(
    () => analyzeSkeletonBinary(spine, '4.2', bytes, 'truncated.skel'),
    (error: unknown) =>
      error instanceof SpineError && error.message.startsWith('Spine 运行时无法读取这个骨骼：'),
  )
})

test('versions without a runtime in the package fail with the versions it has', async () => {
  for (const name of ['spine-3.6.skel', 'spine-5.0.skel']) {
    const version = skeletonVersion(new Uint8Array(await readFile(join(fixtures, 'preview', name))))
    assert.ok(version)
    assert.throws(
      () => requireRuntimeLine(version),
      (error: unknown) =>
        error instanceof SpineError &&
        error.message.endsWith('插件只包含这些版本的运行时：3.7、3.8、4.0、4.1、4.2、4.3。'),
    )
  }
  assert.equal(skeletonVersion(new TextEncoder().encode('not a skeleton at all')), undefined)
})

test('a draw order key lists the slots outside a longest increasing run of the order', () => {
  assert.deepEqual(movedSlots([0, 1, 2]), [])
  assert.deepEqual(movedSlots([0, 3, 1, 2, 4]), [3])
  assert.deepEqual(movedSlots([4, 0, 1, 2, 3]), [4])
  assert.deepEqual(movedSlots([0, 2, 3, 4, 1, 5]), [1])
  assert.deepEqual(movedSlots([3, 2, 1, 0]).length, 3)
  assert.deepEqual(movedSlots([]), [])
})
