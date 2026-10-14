import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseReport, type CompositionReport } from '@vormio/plugin-sdk'
import { limits, serializedSize } from '../../../shared/report.ts'
import { NotSpineError, SpineError } from '../src/errors.ts'
import { analyzeSkeleton, readSkeletonJson } from '../src/skeleton.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine')
function accepted(report: CompositionReport): CompositionReport {
  const parsed = parseReport(report)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.problems.join('\n'))
  return report
}
const analyzeText = (text: string) => accepted(analyzeSkeleton(readSkeletonJson(text)))
const analyzeFixture = async (path: string) =>
  analyzeText(await readFile(join(fixtures, path), 'utf8'))
const analyzeJson = (value: object) => analyzeText(JSON.stringify(value))
const links = (report: CompositionReport, from: string) =>
  report.references.filter((each) => each.from === from).map((each) => `${each.role} → ${each.key}`)
const messages = (report: CompositionReport) => report.diagnostics.map((each) => each.message)
const minimal = { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }] }

test('a 4.2 skeleton: every kind of object, in display order', async () => {
  const report = await analyzeFixture('basic/hero.json')
  const count = (kind: string) => report.subresources.filter((each) => each.kind === kind).length
  assert.deepEqual(
    ['骨骼', '插槽', 'IK 约束', '变换约束', '路径约束', '物理约束', '皮肤', '事件', '动画'].map(
      count,
    ),
    [7, 9, 1, 1, 1, 1, 2, 2, 2],
  )
  const attachments = report.subresources.filter((each) => each.key.startsWith('attachments/'))
  assert.deepEqual(
    attachments.map((each) => [each.kind, each.name, each.parent]),
    [
      ['网格附件', 'cape', 'skins/0'],
      ['区域附件', 'arm', 'skins/0'],
      ['区域附件', 'torso', 'skins/0'],
      ['区域附件', 'head（区域 head-front）', 'skins/0'],
      ['区域附件', 'head-blink（区域 head-blink，3 帧）', 'skins/0'],
      ['区域附件', 'arm', 'skins/0'],
      ['裁剪附件', 'clip', 'skins/0'],
      ['路径附件', 'spline', 'skins/0'],
      ['包围盒附件', 'hitbox', 'skins/0'],
      ['点附件', 'muzzle', 'skins/0'],
      ['链接网格附件', 'cape（区域 cape-armored）', 'skins/1'],
      ['区域附件', 'head（区域 helmet）', 'skins/1'],
    ],
  )
  // Attachments follow the skins; events and animations come last.
  const keys = report.subresources.map((each) => each.key.split('/')[0])
  assert.deepEqual(
    [...new Set(keys)],
    [
      'bones',
      'slots',
      'ik',
      'transform',
      'path',
      'physics',
      'skins',
      'attachments',
      'events',
      'animations',
    ],
  )
  assert.equal(
    report.subresources.find((each) => each.key === 'events/0')?.name,
    'footstep（音频 footstep.wav）',
  )
  assert.deepEqual(report.diagnostics, [])
  // Nothing in the skeleton is reported as a file: it does not name its atlas.
  assert.ok(report.references.every((each) => each.uri === undefined))
})

test('bones form a hierarchy; slots and constraints refer to bones', async () => {
  const report = await analyzeFixture('basic/hero.json')
  assert.deepEqual(
    report.subresources.filter((each) => each.kind === '骨骼').map((each) => each.parent),
    [undefined, 'bones/0', 'bones/1', 'bones/2', 'bones/2', 'bones/2', 'bones/2'],
  )
  assert.deepEqual(links(report, 'slots/0'), ['所在骨骼 → bones/6', '初始附件 → attachments/0'])
  assert.deepEqual(links(report, 'ik/0'), ['约束骨骼 → bones/4', '约束目标 → bones/1'])
  assert.deepEqual(links(report, 'transform/0'), ['约束骨骼 → bones/3', '约束目标 → bones/2'])
  // A path constraint's target is a slot.
  assert.deepEqual(links(report, 'path/0'), ['约束骨骼 → bones/6', '约束目标 → slots/6'])
  assert.deepEqual(links(report, 'physics/0'), ['约束骨骼 → bones/6'])
})

test('skins, attachments, linked meshes and clipping', async () => {
  const report = await analyzeFixture('basic/hero.json')
  assert.deepEqual(links(report, 'skins/1'), ['皮肤包含 → bones/6', '皮肤包含 → physics/0'])
  assert.deepEqual(links(report, 'attachments/6'), ['所在插槽 → slots/5', '结束插槽 → slots/0'])
  // The linked mesh in "armored" uses the mesh of the default skin.
  assert.deepEqual(links(report, 'attachments/10'), [
    '所在插槽 → slots/0',
    '父网格 → attachments/0',
  ])
  assert.equal(
    report.references.find((each) => each.role === '父网格')?.evidence,
    '/skins/1/attachments/cape/cape/parent',
  )
})

test('animations refer to everything their timelines change', async () => {
  const report = await analyzeFixture('basic/hero.json')
  // The physics timeline with an empty name applies to all constraints and refers to none.
  assert.deepEqual(links(report, 'animations/0'), [
    '动画目标 → bones/2',
    '动画目标 → slots/3',
    '动画目标 → attachments/4',
  ])
  assert.deepEqual(links(report, 'animations/1'), [
    '动画目标 → bones/1',
    '动画目标 → bones/4',
    '动画目标 → ik/0',
    '动画目标 → transform/0',
    '动画目标 → path/0',
    '动画目标 → physics/0',
    '动画目标 → attachments/0',
    '动画目标 → events/0',
    '动画目标 → slots/1',
  ])
})

test('Spine 3.8: deform timelines and the older field names', async () => {
  const report = await analyzeFixture('legacy/goblin.json')
  assert.equal(report.subresources.length, 9)
  assert.deepEqual(links(report, 'animations/0'), [
    '动画目标 → bones/2',
    '动画目标 → attachments/0',
  ])
  assert.deepEqual(report.diagnostics, [])
})

test('Spine 3.7: skins keyed by name and `paths` timelines', async () => {
  const report = await analyzeFixture('legacy/druid.json')
  const count = (kind: string) => report.subresources.filter((each) => each.kind === kind).length
  assert.deepEqual(
    ['骨骼', '插槽', 'IK 约束', '变换约束', '路径约束', '皮肤', '事件', '动画'].map(count),
    [8, 9, 1, 1, 1, 2, 2, 2],
  )
  assert.deepEqual(
    report.subresources.filter((each) => each.kind === '皮肤').map((each) => each.name),
    ['default', 'robed'],
  )
  assert.deepEqual(report.diagnostics, [])
  // Evidence points into the skin's object: /skins/<name>/<slot>/<key>.
  const evidence = (from: string, key: string) =>
    report.references.find((each) => each.from === from && each.key === key)?.evidence
  assert.equal(evidence('attachments/10', 'attachments/0'), '/skins/robed/cape/cape/parent')
  assert.equal(evidence('attachments/11', 'slots/2'), '/skins/robed/head')
  assert.equal(
    report.subresources.find((each) => each.key === 'attachments/11')?.name,
    'head（区域 hood）',
  )
  // 3.7 skins contain no bones or constraints.
  assert.deepEqual(links(report, 'skins/1'), [])
  assert.deepEqual(links(report, 'animations/0'), [
    '动画目标 → bones/2',
    '动画目标 → slots/2',
    '动画目标 → slots/4',
    '动画目标 → ik/0',
    '动画目标 → transform/0',
    '动画目标 → path/0',
    '动画目标 → attachments/0',
    '动画目标 → events/0',
    '动画目标 → slots/3',
  ])
  assert.equal(evidence('animations/0', 'path/0'), '/animations/cast/paths/vine-path')
  // The draw order timeline spelled in lower case, which spine-ts 3.7 reads as well.
  assert.deepEqual(links(report, 'animations/1'), [
    '动画目标 → bones/1',
    '动画目标 → events/1',
    '动画目标 → slots/4',
  ])
})

test('broken references are left out with a warning', async () => {
  const report = await analyzeFixture('problems/broken-references.json')
  assert.deepEqual(messages(report), [
    '骨骼 tail 的父骨骼 missing-bone 不存在。',
    '区域附件 ghost 引用的插槽 ghost 不存在（/skins/0/attachments/ghost）。',
    '链接网格 tail 的父网格 absent-mesh（皮肤 default）不存在（/skins/0/attachments/tail/tail）。',
    '插槽 tail 引用的骨骼 nowhere 不存在（/slots/0/bone）。',
    '动画 wag 引用的骨骼 fin 不存在（/animations/wag/bones/fin）。',
    '动画 wag 引用的事件 splash 不存在（/animations/wag/events/0/name）。',
  ])
  assert.equal(report.subresources.find((each) => each.key === 'bones/1')?.parent, undefined)
})

test('versions: 3.6 and older fail, newer than 4.2 is analyzed with a warning', async () => {
  const old = await readFile(join(fixtures, 'preview/spine-3.6.json'), 'utf8')
  assert.throws(
    () => analyzeSkeleton(readSkeletonJson(old)),
    (error) =>
      error instanceof SpineError &&
      !(error instanceof NotSpineError) &&
      error.message === '不支持 Spine 3.6.53 的骨骼文件，只支持 3.7 至 4.2。',
  )
  assert.throws(() => analyzeJson({ ...minimal, skeleton: { spine: 'beta' } }), /不支持 Spine beta/)
  const newer = analyzeJson({ ...minimal, skeleton: { spine: '4.3.1' } })
  assert.deepEqual(messages(newer), [
    '文件由 Spine 4.3.1 导出，比本插件依据的 3.7 至 4.2 新，结果可能不完整。',
  ])
})

test('the skin layout must be the one of the version', () => {
  // Each runtime reads only its own layout: a 3.8 file with 3.7 skins, and the other way round.
  assert.throws(
    () => analyzeJson({ ...minimal, skeleton: { spine: '3.8.1' }, skins: { default: {} } }),
    (error) =>
      error instanceof SpineError &&
      error.message === 'Spine 3.8.1 的骨骼文件中 skins 是对象（3.7 及更早的写法），与版本不符。',
  )
  assert.throws(
    () => analyzeJson({ ...minimal, skeleton: { spine: '3.7.94' }, skins: [] }),
    (error) =>
      error instanceof SpineError &&
      error.message === 'Spine 3.7.94 的骨骼文件中 skins 是数组（3.8 起的写法），与版本不符。',
  )
  // Anything else in its place is a malformed part, as in other lists.
  const malformed = analyzeJson({ ...minimal, skeleton: { spine: '3.7.94' }, skins: { a: 1 } })
  assert.equal(malformed.partial, true)
  assert.deepEqual(messages(malformed), ['/skins/a 不是 JSON 对象。'])
})

test('JSON that is not a Spine skeleton is recognised as such', async () => {
  const notSpine = await readFile(join(fixtures, 'problems/not-spine.json'), 'utf8')
  for (const text of [notSpine, '{', '[]', '{"skeleton": {"spine": "4.2"}}', '﻿"text"'])
    assert.throws(() => readSkeletonJson(text), NotSpineError, text)
  assert.doesNotThrow(() => readSkeletonJson(`﻿${JSON.stringify(minimal)}`))
})

test('names Spine looks up twice: the first wins, with a warning', () => {
  const report = analyzeJson({
    ...minimal,
    bones: [{ name: 'root' }, { name: 'root' }],
    slots: [{ name: 's', bone: 'root' }],
  })
  assert.deepEqual(links(report, 'slots/0'), ['所在骨骼 → bones/0'])
  assert.deepEqual(messages(report), ['有两个名为 root 的骨骼，按名称引用时只会找到第一个。'])
})

test('a bone cycle is broken once; malformed parts make the report partial', () => {
  const cycle = analyzeJson({
    ...minimal,
    bones: [
      { name: 'a', parent: 'b' },
      { name: 'b', parent: 'a' },
    ],
  })
  assert.equal(cycle.subresources.filter((each) => each.parent !== undefined).length, 1)
  assert.match(messages(cycle)[0]!, /^骨骼层级有环/)
  const malformed = analyzeJson({ ...minimal, slots: { a: 1 }, skins: [3], events: [] })
  assert.equal(malformed.partial, true)
  assert.deepEqual(messages(malformed), [
    '/slots 不是数组，其中的内容没有分析。',
    '/skins/0 不是 JSON 对象。',
    '/events 不是 JSON 对象，其中的内容没有分析。',
  ])
})

test('an unknown attachment type keeps the generic kind', () => {
  const report = analyzeJson({
    ...minimal,
    slots: [{ name: 's', bone: 'root' }],
    skins: [{ name: 'default', attachments: { s: { x: { type: 'hologram' } } } }],
  })
  assert.equal(report.subresources.find((each) => each.key === 'attachments/0')?.kind, '附件')
  assert.deepEqual(messages(report), [
    '附件 x 的类型 hologram 无法识别（/skins/0/attachments/s/x）。',
  ])
})

test('a very large skeleton gives a partial report: attachments go first, bones stay', () => {
  const bones = Array.from({ length: 3000 }, (_, index) => ({
    name: `bone-${index}`,
    ...(index ? { parent: `bone-${index - 1}` } : {}),
  }))
  const slots = bones.map((bone) => ({ name: bone.name, bone: bone.name }))
  const attachments = Object.fromEntries(slots.map((slot) => [slot.name, { a: {}, b: {}, c: {} }]))
  const report = analyzeJson({
    ...minimal,
    bones,
    slots,
    skins: [{ name: 'default', attachments }],
  })
  assert.equal(report.partial, true)
  assert.equal(report.subresources.length, limits.subresources)
  assert.equal(report.subresources.filter((each) => each.kind === '骨骼').length, 3000)
  assert.equal(report.subresources.filter((each) => each.kind === '插槽').length, 3000)
  assert.ok(serializedSize(report) <= limits.size)
})
