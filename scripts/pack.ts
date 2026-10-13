// Builds plugins and packs each into artifacts/<id>-<version>.vormioplugin with the SDK's
// `vormio-plugin pack`, which validates the manifest and every file first.
//
//   node scripts/pack.ts [plugin ...]   (pnpm run package; `pnpm pack` is pnpm's own command)

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlugin, pluginNames, root } from './build.ts'

const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('@vormio/plugin-sdk/node')))
const names = process.argv.length > 2 ? process.argv.slice(2) : await pluginNames()
await mkdir(join(root, 'artifacts'), { recursive: true })
for (const name of names) {
  const directory = join(root, 'dist', name)
  await buildPlugin(name, directory)
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
    id: string
    version: string
  }
  const target = join(root, 'artifacts', `${manifest.id}-${manifest.version}.vormioplugin`)
  // The CLI never overwrites; a rebuild replaces the package of the same version.
  await rm(target, { force: true })
  execFileSync(process.execPath, [cli, 'pack', directory, target], { stdio: 'inherit' })
}
