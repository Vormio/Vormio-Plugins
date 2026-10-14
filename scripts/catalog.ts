// Publishes the official plugin catalog: packs the plugins that release.json lists from the current
// commit and signs a catalog of them with the SDK's `vormio-plugin catalog`. A version the previous
// catalog already offers keeps its published package, so one version never has two packages (a
// rebuild can differ in its chunk names alone, for example after an SDK update). The private key,
// the previous catalog and the output stay outside the repository; uploading is an operational
// step: the packages folder first, then catalog.json.
//
//   node scripts/catalog.ts --key <private key.pem> --out <new folder>
//                           (--previous <published catalog.json> | --initial-sequence <n>)
//   (pnpm run catalog …; relative paths are resolved against the folder pnpm was started in)

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { CatalogPayload } from '@vormio/plugin-sdk/node'
import { pluginNames, root } from './build.ts'
import { cli, packPlugin } from './pack.ts'

const usage =
  'Usage: pnpm run catalog --key <private key.pem> --out <new folder> (--previous <catalog.json> | --initial-sequence <n>)'

/** A publication that cannot go ahead. */
class ReleaseError extends Error {}

type Release = CatalogPayload['plugins'][number]['releases'][number]

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

function isInside(folder: string, path: string): boolean {
  const rest = relative(folder, path)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
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

/**
 * The releases of the previous catalog by `<id>@<version>`. Only its payload is read here; the
 * catalog command checks its signature with the key before anything is written.
 */
async function publishedReleases(file: string): Promise<Map<string, Release>> {
  let payload: CatalogPayload
  try {
    const envelope = JSON.parse(await readFile(file, 'utf8')) as { payload: string }
    payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as CatalogPayload
  } catch {
    throw new ReleaseError(`${file}: not a published catalog`)
  }
  return new Map(
    payload.plugins.flatMap((plugin) =>
      plugin.releases.map((release) => [`${plugin.id}@${release.manifest.version}`, release]),
    ),
  )
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
  const previous = values.previous === undefined ? undefined : resolve(base, values.previous)

  if (isInside(root, key))
    throw new ReleaseError(`${key} is inside this repository; keep the private key outside it`)
  if (git('status', '--porcelain').trim())
    throw new ReleaseError(
      'The working tree has uncommitted changes; publish from a commit so the catalog traces back to it',
    )
  const commit = git('rev-parse', 'HEAD').trim()
  const names = await listedPlugins()
  const published = previous ? await publishedReleases(previous) : new Map<string, Release>()

  const packages: string[] = []
  for (const name of names) {
    const packed = await packPlugin(name)
    const release = published.get(`${packed.id}@${packed.version}`)
    if (!release) {
      packages.push(packed.file)
      continue
    }
    const file = resolve(dirname(previous!), release.file)
    const data = await readFile(file).catch(() => undefined)
    if (!data || sha256(data) !== release.sha256)
      throw new ReleaseError(
        `${packed.id} ${packed.version} is already published, but ${file} is missing or differs from the previous catalog`,
      )
    console.log(`${packed.id} ${packed.version} is already published; keeping ${file}`)
    packages.push(file)
  }

  const config = join(root, 'artifacts', 'catalog-release.json')
  const release = previous ? { previous, packages } : { initialSequence, packages }
  await writeFile(config, `${JSON.stringify(release, null, 2)}\n`)
  const signed = spawnSync(process.execPath, [cli, 'catalog', config, '--key', key, '--out', out], {
    stdio: 'inherit',
  })
  if (signed.status !== 0) return signed.status ?? 1
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
