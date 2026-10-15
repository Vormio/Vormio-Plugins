// The release configuration (release.json) and the decisions a catalog publication makes from it.
// Everything here is a pure function of its arguments, so scripts/tests/release.test.ts can cover
// the checks without packing a plugin or signing a catalog; scripts/catalog.ts does the file work.

import { catalogLimits, type CatalogRelease } from '@vormio/plugin-sdk/node'

/** A publication that cannot go ahead. */
export class ReleaseError extends Error {}

/** What release.json records for one plugin the catalog publishes. */
export interface ListedPlugin {
  /** The version this commit builds; the manifest must agree. */
  version: string
  /** The released Core version this version was accepted on by hand (docs/roadmap.md). */
  acceptedOn: string
}

export interface ReleaseConfig {
  /** Folder under plugins/ → its record. Plugins not listed leave the catalog. */
  plugins: Record<string, ListedPlugin>
  /**
   * When present, the previous catalog's releases of other plugin apiVersions are carried over
   * only for these apiVersions; the rest are withdrawn. Absent, all of them are carried over.
   * Releases of the current apiVersion always come from this commit alone.
   */
  keepApiVersions?: number[]
}

/** The part of a manifest the release checks look at. */
export interface ReleaseManifest {
  id: string
  version: string
  apiVersion: number
}

/** Why a release of the previous catalog is not in the new one. */
export type WithdrawalReason = 'superseded' | 'apiVersion' | 'unlisted'

export interface Withdrawal {
  release: CatalogRelease
  reason: WithdrawalReason
}

/** The previous catalog's releases of one plugin that the new catalog keeps, and the rest. */
export interface ReleasePlan {
  /** Carried over with their published packages, in the previous catalog's order. */
  keep: CatalogRelease[]
  withdraw: Withdrawal[]
}

/** The record of a publication, written next to catalog.json for the publisher's records. */
export interface Publication {
  sequence: number
  publishedAt: string
  keyId: string
  /** The Vormio-Plugins commit the catalog was built from. */
  commit: string
  /** The plugin SDK in vendor/ that built the new packages. */
  sdkVersion: string
  releases: {
    id: string
    version: string
    apiVersion: number
    file: string
    sha256: string
    /** `built` from this commit, or `carried` over from the previous catalog with its package. */
    source: 'built' | 'carried'
    /** The Core version release.json records; only for the versions it lists. */
    acceptedOn?: string
  }[]
  withdrawn: { id: string; version: string; apiVersion: number; reason: WithdrawalReason }[]
}

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const coreVersion = /^\d+\.\d+\.\d+$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(problem: string): never {
  throw new ReleaseError(`release.json: ${problem}`)
}

/** Parses and checks release.json; `folders` are the directories under plugins/. */
export function parseReleaseConfig(text: string, folders: readonly string[]): ReleaseConfig {
  let config: unknown
  try {
    config = JSON.parse(text)
  } catch (error) {
    fail(`not valid JSON (${(error as Error).message})`)
  }
  if (!isRecord(config)) fail('must be an object')
  for (const key of Object.keys(config))
    if (key !== 'plugins' && key !== 'keepApiVersions') fail(`unknown field "${key}"`)

  const { plugins, keepApiVersions } = config
  if (!isRecord(plugins) || !Object.keys(plugins).length)
    fail(
      `"plugins" must map at least one folder under plugins/ (${folders.join(', ')}) to its record`,
    )
  const listed: Record<string, ListedPlugin> = {}
  for (const [name, record] of Object.entries(plugins)) {
    if (!folders.includes(name))
      fail(`"${name}" is not a folder under plugins/ (${folders.join(', ')})`)
    if (!isRecord(record)) fail(`"${name}" must be an object with "version" and "acceptedOn"`)
    for (const key of Object.keys(record))
      if (key !== 'version' && key !== 'acceptedOn') fail(`"${name}" has an unknown field "${key}"`)
    const { version, acceptedOn } = record
    if (typeof version !== 'string' || !semver.test(version))
      fail(`"${name}".version must be a semantic version, like "0.4.1"`)
    if (typeof acceptedOn !== 'string' || !coreVersion.test(acceptedOn))
      fail(
        `"${name}".acceptedOn must be the released Core version it was accepted on, like "0.0.9"`,
      )
    listed[name] = { version, acceptedOn }
  }

  if (keepApiVersions === undefined) return { plugins: listed }
  if (
    !Array.isArray(keepApiVersions) ||
    keepApiVersions.some((api) => !(Number.isSafeInteger(api) && api >= 1)) ||
    new Set(keepApiVersions).size !== keepApiVersions.length
  )
    fail('"keepApiVersions" must list distinct positive integers')
  return { plugins: listed, keepApiVersions: [...(keepApiVersions as number[])] }
}

/** The manifest's version must be the one release.json records as accepted. */
export function checkListedVersion(
  name: string,
  listed: ListedPlugin,
  manifest: Pick<ReleaseManifest, 'version'>,
): void {
  if (manifest.version !== listed.version)
    throw new ReleaseError(
      `plugins/${name} builds version ${manifest.version}, but release.json lists ${listed.version}: accept ${manifest.version} on a released Core first, then record it in release.json`,
    )
}

/**
 * Decides which of the previous catalog's releases of `current`'s plugin the new catalog keeps.
 * The same version keeps its published package; other versions of the current apiVersion are
 * superseded; other apiVersions stay unless `keepApiVersions` leaves them out.
 */
export function planReleases(
  current: ReleaseManifest,
  previous: readonly CatalogRelease[],
  keepApiVersions: readonly number[] | undefined,
): ReleasePlan {
  const keep: CatalogRelease[] = []
  const withdraw: Withdrawal[] = []
  for (const release of previous) {
    const { version, apiVersion } = release.manifest
    if (version === current.version) {
      if (apiVersion !== current.apiVersion)
        throw new ReleaseError(
          `${current.id} ${version} is published for apiVersion ${apiVersion}; give the apiVersion ${current.apiVersion} release a new version`,
        )
      keep.push(release)
    } else if (apiVersion === current.apiVersion) withdraw.push({ release, reason: 'superseded' })
    else if (keepApiVersions && !keepApiVersions.includes(apiVersion))
      withdraw.push({ release, reason: 'apiVersion' })
    else keep.push(release)
  }
  const count = keep.length + (keep.some((r) => r.manifest.version === current.version) ? 0 : 1)
  if (count > catalogLimits.maxReleasesPerPlugin)
    throw new ReleaseError(
      `${current.id} would have ${count} releases; a catalog lists at most ${catalogLimits.maxReleasesPerPlugin} per plugin. Withdraw older apiVersions with "keepApiVersions" in release.json`,
    )
  return { keep, withdraw }
}

/** The SDK version behind the root package.json specifier `file:vendor/vormio-plugin-sdk-<v>.tgz`. */
export function sdkVersionOf(specifier: string): string {
  const version = /^file:vendor\/vormio-plugin-sdk-(.+)\.tgz$/.exec(specifier)?.[1]
  if (!version)
    throw new ReleaseError(
      `package.json: "@vormio/plugin-sdk" must be a vendor/ tarball (file:vendor/vormio-plugin-sdk-<version>.tgz), not ${specifier}`,
    )
  return version
}
