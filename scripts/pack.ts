// Builds plugins and packs each into artifacts/<id>-<version>.vormioplugin with the SDK's
// `vormio-plugin pack`, which validates the manifest and every file first.
//
//   node scripts/pack.ts [plugin ...]   (pnpm run package; `pnpm pack` is pnpm's own command)

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlugin, pluginNames, root } from './build.ts'

/** The SDK's `vormio-plugin` command line. */
export const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))

export interface PackedPlugin {
  id: string
  version: string
  /** Absolute path of the `.vormioplugin` file. */
  file: string
}

/** Builds `dist/<name>` and packs it into `artifacts/<id>-<version>.vormioplugin`. */
export async function packPlugin(name: string): Promise<PackedPlugin> {
  const directory = join(root, 'dist', name)
  await buildPlugin(name, directory)
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
    id: string
    version: string
  }
  await mkdir(join(root, 'artifacts'), { recursive: true })
  const file = join(root, 'artifacts', `${manifest.id}-${manifest.version}.vormioplugin`)
  // The CLI never overwrites; a rebuild replaces the package of the same version.
  await rm(file, { force: true })
  execFileSync(process.execPath, [cli, 'pack', directory, file], { stdio: 'inherit' })
  return { id: manifest.id, version: manifest.version, file }
}

if (import.meta.main) {
  const names = process.argv.length > 2 ? process.argv.slice(2) : await pluginNames()
  for (const name of names) await packPlugin(name)
}
