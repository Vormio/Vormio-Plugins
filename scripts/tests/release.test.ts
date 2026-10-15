import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CatalogRelease } from '@vormio/plugin-sdk/node'
import {
  checkListedVersion,
  parseReleaseConfig,
  planReleases,
  ReleaseError,
  sdkVersionOf,
} from '../release.ts'

const folders = ['gltf', 'obj', 'spine']
const gltf = { version: '0.4.1', acceptedOn: '0.0.9' }

const release = (version: string, apiVersion: number, id = 'vormio-plugins.gltf') =>
  ({
    manifest: { id, version, apiVersion, name: 'glTF' },
    file: `packages/${id}-${version}-000000000000.vormioplugin`,
    bytes: 1,
    sha256: '0'.repeat(64),
  }) satisfies CatalogRelease

const rejects = (run: () => unknown, message: RegExp) =>
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ReleaseError, `expected a ReleaseError, got ${String(error)}`)
    assert.match(error.message, message)
    return true
  })

test('release.json records each plugin with its version and the Core version it was accepted on', () => {
  const config = parseReleaseConfig(
    JSON.stringify({ plugins: { gltf, spine: { version: '0.10.0', acceptedOn: '0.0.9' } } }),
    folders,
  )
  assert.equal(config.keepApiVersions, undefined)
  assert.deepEqual(config, {
    plugins: { gltf, spine: { version: '0.10.0', acceptedOn: '0.0.9' } },
  })
  assert.deepEqual(
    parseReleaseConfig(JSON.stringify({ plugins: { gltf }, keepApiVersions: [3, 1] }), folders)
      .keepApiVersions,
    [3, 1],
  )
  // Listing no apiVersion to keep withdraws every other apiVersion.
  assert.deepEqual(
    parseReleaseConfig(JSON.stringify({ plugins: { gltf }, keepApiVersions: [] }), folders)
      .keepApiVersions,
    [],
  )
})

test('release.json is rejected when its shape is wrong', () => {
  const cases: [unknown, RegExp][] = [
    ['{', /not valid JSON/],
    [[], /must be an object/],
    [{ plugins: ['gltf'] }, /"plugins" must map/],
    [{ plugins: {} }, /"plugins" must map/],
    [{ plugins: { gltf }, extra: 1 }, /unknown field "extra"/],
    [{ plugins: { fbx: gltf } }, /"fbx" is not a folder under plugins\/ \(gltf, obj, spine\)/],
    [{ plugins: { gltf: '0.4.1' } }, /"gltf" must be an object/],
    [{ plugins: { gltf: { ...gltf, commit: 'abc' } } }, /"gltf" has an unknown field "commit"/],
    [{ plugins: { gltf: { acceptedOn: '0.0.9' } } }, /"gltf".version must be a semantic version/],
    [{ plugins: { gltf: { version: 'v0.4.1', acceptedOn: '0.0.9' } } }, /semantic version/],
    [{ plugins: { gltf: { version: '0.4.1' } } }, /"gltf".acceptedOn must be the released Core/],
    [{ plugins: { gltf: { version: '0.4.1', acceptedOn: 'f5e985a' } } }, /released Core version/],
    [
      { plugins: { gltf: { version: '0.4.1', acceptedOn: '0.0.9-rc.1' } } },
      /released Core version/,
    ],
    [{ plugins: { gltf }, keepApiVersions: 3 }, /"keepApiVersions" must list/],
    [{ plugins: { gltf }, keepApiVersions: [0] }, /"keepApiVersions" must list/],
    [{ plugins: { gltf }, keepApiVersions: ['3'] }, /"keepApiVersions" must list/],
    [{ plugins: { gltf }, keepApiVersions: [3, 3] }, /"keepApiVersions" must list/],
  ]
  for (const [config, message] of cases)
    rejects(
      () =>
        parseReleaseConfig(typeof config === 'string' ? config : JSON.stringify(config), folders),
      message,
    )
})

test('a plugin whose manifest version is not the listed one is refused', () => {
  checkListedVersion('gltf', gltf, { version: '0.4.1' })
  rejects(
    () => checkListedVersion('gltf', gltf, { version: '0.5.0' }),
    /plugins\/gltf builds version 0\.5\.0, but release\.json lists 0\.4\.1: accept 0\.5\.0 on a released Core first/,
  )
})

test('the same version keeps its published package and older versions of the apiVersion go', () => {
  const current = { id: 'vormio-plugins.gltf', version: '0.4.1', apiVersion: 4 }
  const same = release('0.4.1', 4)
  const older = release('0.4.0', 4)
  const plan = planReleases(current, [same, older], undefined)
  assert.deepEqual(plan.keep, [same])
  assert.deepEqual(plan.withdraw, [{ release: older, reason: 'superseded' }])
})

test('other apiVersions are all carried over unless keepApiVersions names the ones to keep', () => {
  const current = { id: 'vormio-plugins.gltf', version: '0.4.1', apiVersion: 4 }
  const previous = [release('0.4.0', 3), release('0.2.1', 2), release('0.2.0', 1)]
  assert.deepEqual(planReleases(current, previous, undefined), { keep: previous, withdraw: [] })
  assert.deepEqual(planReleases(current, previous, [3, 2]), {
    keep: [previous[0], previous[1]],
    withdraw: [{ release: previous[2], reason: 'apiVersion' }],
  })
  assert.deepEqual(planReleases(current, previous, []).withdraw, [
    { release: previous[0], reason: 'apiVersion' },
    { release: previous[1], reason: 'apiVersion' },
    { release: previous[2], reason: 'apiVersion' },
  ])
  // The current apiVersion in the list changes nothing: its releases come from this commit.
  assert.deepEqual(planReleases(current, [release('0.4.0', 4)], [4]).withdraw, [
    { release: release('0.4.0', 4), reason: 'superseded' },
  ])
})

test('a version already published for another apiVersion needs a new version', () => {
  rejects(
    () =>
      planReleases(
        { id: 'vormio-plugins.gltf', version: '0.4.1', apiVersion: 4 },
        [release('0.4.1', 3)],
        undefined,
      ),
    /0\.4\.1 is published for apiVersion 3; give the apiVersion 4 release a new version/,
  )
})

test('a plugin cannot exceed the catalog limit of releases', () => {
  const current = { id: 'vormio-plugins.gltf', version: '0.9.0', apiVersion: 9 }
  const previous = [1, 2, 3, 4, 5, 6, 7, 8].map((api) => release(`0.${api}.0`, api))
  rejects(
    () => planReleases(current, previous, undefined),
    /would have 9 releases.*"keepApiVersions"/,
  )
  // Withdrawing one makes room, and so does the version being published already.
  assert.equal(planReleases(current, previous, [2, 3, 4, 5, 6, 7, 8]).keep.length, 7)
  assert.equal(
    planReleases(current, [...previous.slice(1), release('0.9.0', 9)], undefined).keep.length,
    8,
  )
})

test('the SDK version comes from the vendor tarball the root package.json pins', () => {
  assert.equal(sdkVersionOf('file:vendor/vormio-plugin-sdk-0.0.9.tgz'), '0.0.9')
  assert.equal(sdkVersionOf('file:vendor/vormio-plugin-sdk-0.0.10-rc.1.tgz'), '0.0.10-rc.1')
  rejects(() => sdkVersionOf('^0.0.9'), /must be a vendor\/ tarball/)
  rejects(() => sdkVersionOf(''), /must be a vendor\/ tarball/)
})
