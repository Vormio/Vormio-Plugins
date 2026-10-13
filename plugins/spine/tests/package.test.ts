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

test('the build output declares only the atlas analyzer, with no companion reads', () => {
  const { manifest } = checked
  assert.equal(manifest.id, 'vormio-plugins.spine')
  assert.deepEqual(manifest.contributions.thumbnails, [])
  assert.deepEqual(manifest.contributions.viewers, [])
  // JSON is left out until the host lets an analyzer decline files that are not Spine.
  assert.deepEqual(manifest.contributions.analyzers, [
    { id: 'atlas', entry: 'analyzer.html', formats: ['atlas'], companionFormats: [] },
  ])
})

test('the page and its script are in the package; no inline scripts or SDK schemas', async () => {
  const paths = new Set(checked.files.map((file) => file.path))
  const html = await readFile(join(directory, 'analyzer.html'), 'utf8')
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g))
    assert.ok(paths.has(reference!), `analyzer.html refers to missing ${reference}`)
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/)
  for (const path of paths) {
    if (!path.endsWith('.js')) continue
    const script = await readFile(join(directory, path), 'utf8')
    assert.doesNotMatch(script, /ZodError/, path)
    for (const [, specifier] of script.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const resolved = new URL(specifier!, `https://package/${path}`).pathname.slice(1)
      assert.ok(paths.has(resolved), `${path} imports missing ${specifier}`)
    }
  }
  const total = checked.files.reduce((sum, file) => sum + file.size, 0)
  assert.ok(total < 64 * 1024, `package is ${total} bytes`)
})

test('vormio-plugin pack turns the output into an installable .vormioplugin', async () => {
  const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))
  const target = join(temporary, 'spine.vormioplugin')
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'pack', directory, target])
  assert.match(stdout, /vormio-plugins\.spine 0\.1\.0/)
  const archive = readPackageArchive(await readFile(target))
  assert.equal(archive.checked.digest, checked.digest)
})
