import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relativeTo } from '../companions.ts'

const input = 'vormio-input://token/models/props/chair.gltf'

test('shows companion paths as the model refers to them', () => {
  const at = (relative: string) => relativeTo(input, new URL(relative, input).href)
  assert.equal(at('chair.bin'), 'chair.bin')
  assert.equal(at('textures/wood%20grain.png'), 'textures/wood grain.png')
  assert.equal(at('../shared/metal.png'), '../shared/metal.png')
  assert.equal(at('../../top.png'), '../../top.png')
  assert.equal(at('%E8%B4%B4%E5%9B%BE.png'), '贴图.png')
  assert.equal(at('bad%zz.png'), 'bad%zz.png')
})

test('a model at the root of the linked folder', () => {
  const root = 'vormio-input://token/chair.glb'
  assert.equal(relativeTo(root, new URL('textures/a.png', root).href), 'textures/a.png')
})
