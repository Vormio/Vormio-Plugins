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
  temporary = await mkdtemp(join(tmpdir(), 'vormio-spine-package-'))
  directory = join(temporary, 'spine')
  await buildPlugin('spine', directory)
  checked = checkPackage(await readPackageDirectory(directory))
})
after(() => rm(temporary, { recursive: true, force: true }))

test('the build output declares atlases and skeletons; previews read what they draw', () => {
  const { manifest } = checked
  assert.equal(manifest.id, 'vormio-plugins.spine')
  // Declining JSON that is not Spine needs the contract of Vormio-Core 0.0.6.
  assert.equal(manifest.apiVersion, 2)
  const pages = ['png', 'jpg', 'jpeg']
  const skeleton = ['atlas', ...pages]
  assert.deepEqual(manifest.contributions.thumbnails, [
    { id: 'atlas', entry: 'thumbnail.html', formats: ['atlas'], companionFormats: pages },
    {
      id: 'skeleton',
      entry: 'skeleton-thumbnail.html',
      formats: ['json', 'skel'],
      companionFormats: skeleton,
    },
  ])
  assert.deepEqual(manifest.contributions.viewers, [
    { id: 'atlas', entry: 'viewer.html', formats: ['atlas'], companionFormats: pages },
    {
      id: 'skeleton',
      entry: 'skeleton-viewer.html',
      formats: ['json', 'skel'],
      companionFormats: skeleton,
    },
  ])
  // The analyzers read the file alone; one page serves both. Binary skeletons are not analyzed.
  assert.deepEqual(manifest.contributions.analyzers, [
    { id: 'atlas', entry: 'analyzer.html', formats: ['atlas'], companionFormats: [] },
    { id: 'skeleton', entry: 'analyzer.html', formats: ['json'], companionFormats: [] },
  ])
})

test('the license requirement comes first, and the Spine Runtimes license is in the package', async () => {
  assert.match(
    checked.manifest.description,
    /^包含 Spine Runtimes：每个使用者都需要自己的 Spine Editor 许可证。/,
  )
  const shipped = await readFile(join(directory, 'licenses/SPINE-RUNTIMES.txt'), 'utf8')
  assert.match(shipped, /^Spine Runtimes License Agreement/)
  assert.match(shipped, /each user of the Products must obtain their own\s+Spine Editor license/)
  // Both runtime lines carry the same license text.
  for (const line of ['4.2', '4.3']) {
    const source = fileURLToPath(new URL('../LICENSE', import.meta.resolve(`spine-webgl-${line}`)))
    assert.equal(await readFile(source, 'utf8'), shipped, line)
  }
})

test('the pages and their scripts are in the package; only skeleton pages load a runtime', async () => {
  const paths = new Set(checked.files.map((file) => file.path))
  const pages = [
    'analyzer.html',
    'thumbnail.html',
    'viewer.html',
    'skeleton-thumbnail.html',
    'skeleton-viewer.html',
  ]
  for (const page of pages) {
    const html = await readFile(join(directory, page), 'utf8')
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g))
      assert.ok(paths.has(reference!), `${page} refers to missing ${reference}`)
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/)
  }
  /** Each script with the package scripts it imports, statically or when needed. */
  const imports = new Map<string, string[]>()
  for (const path of paths) {
    if (!path.endsWith('.js')) continue
    const script = await readFile(join(directory, path), 'utf8')
    assert.doesNotMatch(script, /ZodError/, path)
    const found: string[] = []
    for (const [, specifier] of script.matchAll(
      /(?:from|import)\s*\(?["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const resolved = new URL(specifier!, `https://package/${path}`).pathname.slice(1)
      assert.ok(paths.has(resolved), `${path} imports missing ${specifier}`)
      found.push(resolved)
    }
    imports.set(path, found)
  }
  // Each runtime is a chunk of its own, loaded only when a skeleton of its version is shown.
  const runtimes = [...paths].filter((path) => /^chunks\/runtime-4\.[23]-/.test(path))
  assert.equal(runtimes.length, 2)
  const reachable = (entry: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(entry)) return seen
    seen.add(entry)
    for (const next of imports.get(entry) ?? []) reachable(next, seen)
    return seen
  }
  for (const entry of ['analyzer.js', 'thumbnail.js', 'viewer.js'])
    for (const runtime of runtimes)
      assert.ok(!reachable(entry).has(runtime), `${entry} reaches ${runtime}`)
  for (const entry of ['skeleton-thumbnail.js', 'skeleton-viewer.js'])
    for (const runtime of runtimes)
      assert.ok(reachable(entry).has(runtime), `${entry} cannot load ${runtime}`)
  const total = checked.files.reduce((sum, file) => sum + file.size, 0)
  assert.ok(total < 1024 * 1024, `package is ${total} bytes`)
})

test('vormio-plugin pack turns the output into an installable .vormioplugin', async () => {
  const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))
  const target = join(temporary, 'spine.vormioplugin')
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'pack', directory, target])
  assert.match(stdout, /vormio-plugins\.spine 0\.4\.0/)
  const archive = readPackageArchive(await readFile(target))
  assert.equal(archive.checked.digest, checked.digest)
})
