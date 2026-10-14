import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileUri } from '../uri.ts'

test('file names keep %, ? and # through the host', () => {
  assert.equal(fileUri('a?b#c%d.png'), 'a%3Fb%23c%25d.png')
  assert.equal(decodeURIComponent(fileUri('a?b#c%d.png')), 'a?b#c%d.png')
  assert.equal(fileUri('../textures/props sheet.png'), '../textures/props sheet.png')
})
