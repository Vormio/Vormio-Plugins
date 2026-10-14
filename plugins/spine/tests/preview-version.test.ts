import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { atlasName } from '../src/preview/source.ts'
import { runtimeLine, skeletonVersion } from '../src/preview/version.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/spine/preview')
const versionOf = async (name: string) =>
  skeletonVersion(new Uint8Array(await readFile(join(fixtures, name))))

test('the version comes from the header of 4.x and 3.x binary skeletons', async () => {
  assert.equal(await versionOf('hero.skel'), '4.2.43')
  assert.equal(await versionOf('knight.skel'), '4.3.13')
  assert.equal(await versionOf('scout.skel'), '4.0.64')
  assert.equal(await versionOf('squire.skel'), '4.1.24')
  assert.equal(await versionOf('spine-5.0.skel'), '5.0.00')
  // Before 4.0 the hash in front of the version was a string.
  assert.equal(await versionOf('ranger.skel'), '3.8.99')
  assert.equal(await versionOf('spine-3.7.skel'), '3.7.94')
})

test('bytes that do not start like a skeleton have no version', () => {
  const encode = (text: string) => new TextEncoder().encode(text)
  assert.equal(skeletonVersion(new Uint8Array()), undefined)
  assert.equal(skeletonVersion(encode('{"skeleton":{"spine":"4.2.43"}}')), undefined)
  assert.equal(skeletonVersion(new Uint8Array(64).fill(0xff)), undefined)
  // A version string that runs past the end of the file.
  assert.equal(skeletonVersion(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 9, 52, 46])), undefined)
})

test('each runtime reads the data of its own major and minor version', () => {
  assert.equal(runtimeLine('4.2.43'), '4.2')
  assert.equal(runtimeLine('4.3.13'), '4.3')
  assert.equal(runtimeLine('4.3.06-beta'), '4.3')
  assert.equal(runtimeLine('4.0.64'), '4.0')
  assert.equal(runtimeLine('4.1.24'), '4.1')
  assert.equal(runtimeLine('5.0.00'), undefined)
  assert.equal(runtimeLine('3.8.99'), '3.8')
  assert.equal(runtimeLine('3.7.94'), undefined)
  assert.equal(runtimeLine('4.20.1'), undefined)
})

test('the atlas goes with the skeleton by name', () => {
  assert.equal(atlasName('hero.skel'), 'hero.atlas')
  assert.equal(atlasName('hero.v2.skel'), 'hero.v2.atlas')
  assert.equal(atlasName('hero'), 'hero.atlas')
  assert.equal(atlasName('.skel'), '.skel.atlas')
})
