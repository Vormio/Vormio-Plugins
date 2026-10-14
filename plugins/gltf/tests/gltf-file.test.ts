import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  animationNames,
  GltfFileError,
  readGltf,
  supportedExtensions,
  unsupportedRequiredExtensions,
} from '../src/gltf-file.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/gltf')
const read = async (path: string) => {
  const bytes = await readFile(join(fixtures, path))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

function glb(json: object, { version = 2, length }: { version?: number; length?: number } = {}) {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const padded = Math.ceil(text.length / 4) * 4
  const buffer = new ArrayBuffer(20 + padded)
  const view = new DataView(buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, version, true)
  view.setUint32(8, length ?? buffer.byteLength, true)
  view.setUint32(12, padded, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(buffer, 20).fill(0x20).set(text)
  return buffer
}

test('reads .gltf and .glb fixtures', async () => {
  assert.equal(readGltf(await read('cube/cube.gltf')).container, 'gltf')
  const globe = readGltf(await read('globe-draco.glb'))
  assert.equal(globe.container, 'glb')
  assert.deepEqual(unsupportedRequiredExtensions(globe.json), [])
  assert.deepEqual(
    unsupportedRequiredExtensions(readGltf(await read('globe-meshopt.glb')).json),
    [],
  )
})

test('refuses files that are not glTF 2.0', async () => {
  const refuses = (bytes: ArrayBuffer, message: RegExp) =>
    assert.throws(
      () => readGltf(bytes),
      (error: unknown) => {
        assert.ok(error instanceof GltfFileError)
        assert.match(error.message, message)
        return true
      },
    )
  refuses(
    await read('problems/truncated.glb'),
    /GLB 文件不完整：文件头声明 \d+ 字节，实际只有 2048 字节/,
  )
  refuses(await read('problems/gltf-1.gltf'), /glTF 1\.0 文件，只支持 glTF 2\.0/)
  refuses(glb({ asset: { version: '1.0' } }, { version: 1 }), /glTF 1\.0 的 GLB/)
  refuses(glb({ asset: { version: '2.0' } }, { version: 3 }), /GLB 容器版本 3/)
  refuses(new ArrayBuffer(12), /不是 JSON/)
  refuses(bytesOf('{"asset": {"version": "2.0"'), /不是 JSON/)
  refuses(bytesOf('[1, 2]'), /顶层不是 JSON 对象/)
  refuses(bytesOf('{"scenes": []}'), /缺少 asset\.version/)
  refuses(bytesOf('{"asset": {"version": "3.0"}}'), /不支持 glTF 3\.0/)
  refuses(bytesOf('{"asset": {"version": "2.0", "minVersion": "2.1"}}'), /要求 glTF 2\.1/)
  const short = glb({ asset: { version: '2.0' } })
  new DataView(short).setUint32(12, 4096, true)
  refuses(short, /JSON 数据块超出了文件长度/)
})

test('accepts a byte-order mark and later 2.x versions', () => {
  assert.equal(readGltf(bytesOf('﻿{"asset": {"version": "2.0"}}')).container, 'gltf')
  assert.equal(readGltf(bytesOf('{"asset": {"version": "2.1"}}')).container, 'gltf')
  assert.equal(readGltf(glb({ asset: { version: '2.0' } })).container, 'glb')
})

test('lists required extensions the plugin cannot show', async () => {
  const { json } = readGltf(await read('problems/unsupported-extension.gltf'))
  assert.deepEqual(unsupportedRequiredExtensions(json), ['VORMIO_unsupported_fixture'])
  assert.deepEqual(
    unsupportedRequiredExtensions({
      extensionsUsed: ['KHR_materials_variants', 'KHR_texture_transform'],
      extensionsRequired: ['KHR_texture_transform', 'KHR_materials_pbrSpecularGlossiness'],
    }),
    ['KHR_materials_pbrSpecularGlossiness'],
  )
  assert.deepEqual(unsupportedRequiredExtensions({ extensionsRequired: 'KHR_lights_punctual' }), [])
})

test('the supported extensions match the bundled GLTFLoader', async () => {
  const require = createRequire(join(import.meta.dirname, '../package.json'))
  const source = await readFile(require.resolve('three/examples/jsm/loaders/GLTFLoader.js'), 'utf8')
  const block = /const EXTENSIONS = \{([\s\S]*?)\};/.exec(source)?.[1] ?? ''
  const names = [...block.matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]!)
  // KHR_binary_glTF is the glTF 1.0 binary extension; GLB 2 does not use it.
  assert.deepEqual(
    names.filter((name) => name !== 'KHR_binary_glTF').sort(),
    [...supportedExtensions].sort(),
  )
})

test('animation names: as written, or numbered when there is none', async () => {
  assert.deepEqual(animationNames(readGltf(await read('animated/robot.glb')).json), [
    'Wave',
    '动画 2',
  ])
  assert.deepEqual(animationNames({ animations: [{ name: ' ' }, null, { name: 'Run' }] }), [
    '动画 1',
    '动画 2',
    'Run',
  ])
  assert.deepEqual(animationNames({}), [])
})
