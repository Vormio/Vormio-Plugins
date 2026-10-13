import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  checkPackage,
  readPackageArchive,
  readPackageDirectory,
  type CheckedPackage,
} from '@vormio/plugin-sdk/node'
import { buildPlugin } from '../../../scripts/build.ts'

let temporary: string
let directory: string
let checked: CheckedPackage

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'vormio-gltf-package-'))
  directory = join(temporary, 'gltf')
  await buildPlugin('gltf', directory)
  checked = checkPackage(await readPackageDirectory(directory))
})
after(() => rm(temporary, { recursive: true, force: true }))

test('the build output is a valid plugin with the declared permissions', () => {
  const { manifest } = checked
  assert.equal(manifest.id, 'vormio-plugins.gltf')
  const companions = ['bin', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2']
  for (const contribution of [
    ...manifest.contributions.thumbnails,
    ...manifest.contributions.viewers,
  ]) {
    assert.deepEqual(contribution.formats, ['gltf', 'glb'])
    assert.deepEqual(contribution.companionFormats, companions)
  }
  assert.equal(manifest.contributions.thumbnails[0]?.entry, 'thumbnail.html')
  assert.equal(manifest.contributions.viewers[0]?.entry, 'viewer.html')
})

test('every file a page refers to is in the package', async () => {
  const paths = new Set(checked.files.map((file) => file.path))
  for (const page of ['viewer.html', 'thumbnail.html']) {
    const html = await readFile(join(directory, page), 'utf8')
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g))
      assert.ok(paths.has(reference!), `${page} refers to missing ${reference}`)
    // The page CSP allows no inline scripts.
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/)
  }
  for (const path of [
    'decoders/draco/draco_wasm_wrapper.js',
    'decoders/draco/draco_decoder.wasm',
    'decoders/basis/basis_transcoder.js',
    'decoders/basis/basis_transcoder.wasm',
    'licenses/THREE.txt',
    'licenses/APACHE-2.0.txt',
    'licenses/MESHOPTIMIZER.txt',
    'licenses/NOTICE.txt',
  ])
    assert.ok(paths.has(path), `${path} missing`)
  // Relative imports between the bundled scripts resolve inside the package.
  for (const path of paths) {
    if (!path.endsWith('.js') || path.startsWith('decoders/')) continue
    const script = await readFile(join(directory, path), 'utf8')
    for (const [, specifier] of script.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const resolved = new URL(specifier!, `https://package/${path}`).pathname.slice(1)
      assert.ok(paths.has(resolved), `${path} imports missing ${specifier}`)
    }
  }
})

test('the page bundle leaves out the SDK manifest schema', async () => {
  for (const file of checked.files.filter((each) => each.path.startsWith('chunks/'))) {
    const script = await readFile(join(directory, file.path), 'utf8')
    assert.doesNotMatch(script, /ZodError/)
  }
  const total = checked.files.reduce((sum, file) => sum + file.size, 0)
  assert.ok(total < 4 * 1024 * 1024, `package is ${total} bytes`)
})

test('vormio-plugin pack turns the output into an installable .vormioplugin', async () => {
  const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))
  const target = join(temporary, 'gltf.vormioplugin')
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'pack', directory, target])
  assert.match(stdout, /vormio-plugins\.gltf 0\.1\.0/)
  const archive = readPackageArchive(await readFile(target))
  assert.equal(archive.checked.digest, checked.digest)
})
