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
  assert.equal(manifest.apiVersion, 2)
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
  // The analyzer reads only the model file, so it declares no companion formats.
  assert.deepEqual(manifest.contributions.analyzers, [
    { id: 'model', entry: 'analyzer.html', formats: ['gltf', 'glb'], companionFormats: [] },
  ])
})

test('every file a page refers to is in the package', async () => {
  const paths = new Set(checked.files.map((file) => file.path))
  for (const page of ['viewer.html', 'thumbnail.html', 'analyzer.html']) {
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

test('the page bundles leave out the SDK schemas; the analyzer leaves out three.js', async () => {
  const scripts = checked.files.filter(
    (each) => each.path.endsWith('.js') && !each.path.startsWith('decoders/'),
  )
  for (const file of scripts) {
    const script = await readFile(join(directory, file.path), 'utf8')
    assert.doesNotMatch(script, /ZodError/, file.path)
  }
  // The analyzer page and the chunks it imports: no renderer, no loaders.
  const analyzer = await readFile(join(directory, 'analyzer.js'), 'utf8')
  const imported = [...analyzer.matchAll(/from\s*["']\.\/([^"']+)["']/g)].map((match) => match[1]!)
  for (const path of ['analyzer.js', ...imported]) {
    const script = await readFile(join(directory, path), 'utf8')
    assert.doesNotMatch(script, /WebGLRenderer|GLTFLoader/, path)
  }
  const total = checked.files.reduce((sum, file) => sum + file.size, 0)
  assert.ok(total < 4 * 1024 * 1024, `package is ${total} bytes`)
})

test('vormio-plugin pack turns the output into an installable .vormioplugin', async () => {
  const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))
  const target = join(temporary, 'gltf.vormioplugin')
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'pack', directory, target])
  assert.match(stdout, /vormio-plugins\.gltf 0\.2\.1/)
  const archive = readPackageArchive(await readFile(target))
  assert.equal(archive.checked.digest, checked.digest)
})
