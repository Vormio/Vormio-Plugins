// Publishes the official plugin catalog: packs the plugins that release.json lists from the current
// commit and signs a catalog of them. A host installs only releases of its own plugin apiVersion, so
// the previous catalog's releases of a listed plugin for another apiVersion stay in the new catalog
// with their published packages, and hosts the current plugins no longer serve keep what they had.
// Releases of the current apiVersion come from this commit alone. A version the previous catalog
// already offers keeps its published package, so one version never has two packages (a rebuild can
// differ in its chunk names alone, for example after an SDK update). The private key, the previous
// catalog and the output stay outside the repository; uploading is an operational step: the
// packages folder first, then catalog.json.
//
// The SDK's `vormio-plugin catalog` accepts only packages of its own apiVersion, so the catalog is
// signed here with the SDK's `signCatalog`. New packages get the checks a host makes before
// installing (`readPackageArchive`); carried-over ones must match the previous catalog's SHA-256.
//
//   node scripts/catalog.ts --key <private key.pem> --out <new folder>
//                           (--previous <published catalog.json> | --initial-sequence <n>)
//   (pnpm run catalog …; relative paths are resolved against the folder pnpm was started in)

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CatalogError,
  catalogPublicKey,
  compareVersions,
  PackageError,
  readPackageArchive,
  signCatalog,
  verifyCatalog,
  ZipError,
  type Catalog,
  type CatalogRelease,
} from '@vormio/plugin-sdk/node'
import { pluginNames, root } from './build.ts'
import { packPlugin } from './pack.ts'

const usage =
  'Usage: pnpm run catalog --key <private key.pem> --out <new folder> (--previous <catalog.json> | --initial-sequence <n>)'

/** A publication that cannot go ahead. */
class ReleaseError extends Error {}

/** A release of the new catalog with the bytes of its package. */
interface Published {
  release: CatalogRelease
  data: Buffer
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

function isInside(folder: string, path: string): boolean {
  const rest = relative(folder, path)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

/** Runs a check of the SDK, turning the problems it reports into a ReleaseError. */
function check<T>(what: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof CatalogError || error instanceof PackageError)
      throw new ReleaseError(error.problems.map((problem) => `${what}: ${problem}`).join('\n'))
    if (error instanceof ZipError) throw new ReleaseError(`${what}: ${error.message}`)
    throw error
  }
}

/** The plugin folders release.json lists, in its order. */
async function listedPlugins(): Promise<string[]> {
  const config = JSON.parse(await readFile(join(root, 'release.json'), 'utf8')) as {
    plugins?: unknown
  }
  const names = await pluginNames()
  const listed = config.plugins
  if (
    !Array.isArray(listed) ||
    !listed.length ||
    listed.some((name) => typeof name !== 'string' || !names.includes(name)) ||
    new Set(listed).size !== listed.length
  )
    throw new ReleaseError(
      `release.json: "plugins" must list folders under plugins/ once each (${names.join(', ')})`,
    )
  return listed as string[]
}

/** The catalog currently published, which the new one continues: signed with the same key. */
async function previousCatalog(file: string, publicKey: string): Promise<Catalog> {
  const bytes = await readFile(file).catch(() => undefined)
  if (!bytes) throw new ReleaseError(`Previous catalog not found: ${file}`)
  return check(file, () => verifyCatalog(bytes, publicKey))
}

/** A package built from this commit, named after its content like the SDK's catalog command does. */
async function built(file: string): Promise<Published> {
  const data = await readFile(file)
  const { contents } = check(file, () => readPackageArchive(data))
  // The manifest as the package has it, so hosts compare like with like after downloading.
  const manifest = JSON.parse(
    contents.get('manifest.json')!.toString('utf8'),
  ) as CatalogRelease['manifest']
  const hash = sha256(data)
  const name = `${manifest.id}-${manifest.version}-${hash.slice(0, 12)}.vormioplugin`
  return { release: { manifest, file: `packages/${name}`, bytes: data.length, sha256: hash }, data }
}

/** A release of the previous catalog with its published package, which must still match it. */
async function published(previous: string, release: CatalogRelease): Promise<Published> {
  const file = resolve(dirname(previous), release.file)
  const data = await readFile(file).catch(() => undefined)
  if (!data || sha256(data) !== release.sha256)
    throw new ReleaseError(
      `${release.manifest.id} ${release.manifest.version} is published, but ${file} is missing or differs from the previous catalog`,
    )
  return { release, data }
}

async function main(): Promise<number> {
  let values: Record<string, string | undefined>
  try {
    values = parseArgs({
      options: {
        key: { type: 'string' },
        out: { type: 'string' },
        previous: { type: 'string' },
        'initial-sequence': { type: 'string' },
      },
    }).values
  } catch {
    console.error(usage)
    return 2
  }
  const initial = values['initial-sequence']
  const initialSequence = initial === undefined ? undefined : Number(initial)
  if (
    !values.key ||
    !values.out ||
    (values.previous === undefined) === (initialSequence === undefined) ||
    (initialSequence !== undefined &&
      !(Number.isSafeInteger(initialSequence) && initialSequence >= 1))
  ) {
    console.error(usage)
    return 2
  }
  const base = process.env.INIT_CWD ?? process.cwd()
  const key = resolve(base, values.key)
  const out = resolve(base, values.out)
  const previousFile = values.previous === undefined ? undefined : resolve(base, values.previous)

  if (isInside(root, key))
    throw new ReleaseError(`${key} is inside this repository; keep the private key outside it`)
  if (git('status', '--porcelain').trim())
    throw new ReleaseError(
      'The working tree has uncommitted changes; publish from a commit so the catalog traces back to it',
    )
  // The private key cannot be inside an empty folder, so this also keeps it out of the upload.
  if (existsSync(out) && (await readdir(out)).length)
    throw new ReleaseError(`${out} is not empty; publish into a new folder`)
  const commit = git('rev-parse', 'HEAD').trim()
  const privateKey = await readFile(key, 'utf8').catch(() => undefined)
  if (privateKey === undefined) throw new ReleaseError(`Private key not found: ${key}`)
  const publicKey = check(key, () => catalogPublicKey(privateKey))
  const previous = previousFile ? await previousCatalog(previousFile, publicKey) : undefined
  const names = await listedPlugins()

  // Every check runs before anything is written.
  const plugins: { id: string; releases: Published[] }[] = []
  for (const name of names) {
    const current = await built((await packPlugin(name)).file)
    const { id, version, apiVersion } = current.release.manifest
    const releases: Published[] = []
    for (const release of previous?.plugins.find((plugin) => plugin.id === id)?.releases ?? []) {
      const same = {
        version: release.manifest.version === version,
        api: release.manifest.apiVersion === apiVersion,
      }
      if (same.version && !same.api)
        throw new ReleaseError(
          `${id} ${version} is published for apiVersion ${release.manifest.apiVersion}; give the apiVersion ${apiVersion} release a new version`,
        )
      // Releases of this apiVersion come from this commit alone.
      if (!same.version && same.api) continue
      console.log(
        same.version
          ? `${id} ${version} is already published; keeping ${release.file}`
          : `Keeping ${id} ${release.manifest.version} for apiVersion ${release.manifest.apiVersion} hosts`,
      )
      releases.push(await published(previousFile!, release))
    }
    if (!releases.some(({ release }) => release.manifest.version === version))
      releases.push(current)
    plugins.push({ id, releases })
  }
  plugins.sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const plugin of plugins)
    plugin.releases.sort((a, b) =>
      compareVersions(b.release.manifest.version, a.release.manifest.version),
    )

  const sequence = previous ? previous.sequence + 1 : initialSequence!
  const catalog = check('The new catalog', () =>
    signCatalog(
      {
        sequence,
        publishedAt: new Date().toISOString(),
        plugins: plugins.map(({ id, releases }) => ({
          id,
          releases: releases.map(({ release }) => release),
        })),
      },
      privateKey,
    ),
  )

  const releases = plugins.flatMap(({ releases }) => releases)
  await mkdir(join(out, 'packages'), { recursive: true })
  for (const { release, data } of releases)
    await writeFile(join(out, release.file), data, { flag: 'wx' })
  await writeFile(join(out, 'catalog.json'), catalog, { flag: 'wx' })
  const written = verifyCatalog(await readFile(join(out, 'catalog.json')), publicKey)
  console.log(`catalog.json: sequence ${written.sequence}, key ${written.keyId}`)
  for (const { release } of releases)
    console.log(
      `  ${release.manifest.id} ${release.manifest.version} (apiVersion ${release.manifest.apiVersion}) → ${release.file}`,
    )
  console.log(`Upload the packages folder of ${out} first, then catalog.json.`)
  console.log(`Built from Vormio-Plugins ${commit}`)
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  if (!(error instanceof ReleaseError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
