import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseReport, reportLimits } from '@vormio/plugin-sdk'
import { diagnosticList, limits, serializedSize, withinLimits } from '../report.ts'

test('the limits match the SDK', () => {
  assert.equal(limits.subresources, reportLimits.subresources)
  assert.equal(limits.references, reportLimits.references)
  assert.equal(limits.diagnostics, reportLimits.diagnostics)
  assert.equal(limits.size, reportLimits.bytes)
})

test('subresources are dropped in drop order, file references kept, the report marked partial', () => {
  const count = limits.subresources + 10
  const subresources = Array.from({ length: count }, (_, index) =>
    index < 5
      ? { key: `pages/${index}`, kind: '页面', name: `page ${index}` }
      : { key: `regions/${index}`, kind: '区域', name: `r ${index}`, parent: 'pages/0' },
  )
  const report = withinLimits({
    subresources,
    fileReferences: [{ from: 'pages/0', uri: 'a.png', role: '贴图页' }],
    internal: [{ from: `regions/${count - 1}`, key: 'pages/0', role: '所在页面' }],
    diagnostics: [{ severity: 'warning', message: 'last', key: `regions/${count - 1}` }],
    partial: false,
    dropOrder: ['regions', 'pages'],
  })
  assert.equal(report.subresources.length, limits.subresources)
  assert.equal(report.subresources.filter((each) => each.key.startsWith('pages/')).length, 5)
  assert.equal(report.subresources.at(-1)?.key, `regions/${limits.subresources - 1}`)
  // The reference from a dropped region goes; the diagnostic stays, without its key.
  assert.deepEqual(report.references, [{ from: 'pages/0', uri: 'a.png', role: '贴图页' }])
  assert.deepEqual(report.diagnostics[0], { severity: 'warning', message: 'last' })
  assert.equal(report.partial, true)
  assert.ok(parseReport(report).ok)
})

test('prefixes missing from the drop order go last', () => {
  const report = withinLimits({
    subresources: Array.from({ length: limits.subresources + 1 }, (_, index) => ({
      key: index === 0 ? 'other/0' : `listed/${index}`,
      kind: 'k',
      name: '',
    })),
    fileReferences: [],
    internal: [],
    diagnostics: [],
    partial: false,
    dropOrder: ['listed'],
  })
  assert.equal(report.subresources[0]?.key, 'other/0')
  assert.ok(serializedSize(report) <= limits.size)
})

test('a diagnostic found twice is listed once', () => {
  const { diagnostics, diagnose } = diagnosticList()
  diagnose('error', 'x', 'a/0')
  diagnose('error', 'x', 'a/0')
  diagnose('error', 'x')
  assert.deepEqual(diagnostics, [
    { severity: 'error', message: 'x', key: 'a/0' },
    { severity: 'error', message: 'x' },
  ])
})
