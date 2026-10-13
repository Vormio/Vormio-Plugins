// Builds plugins into dist/<plugin>/, ready to add in Vormio as a development folder or to pack with
// `vormio-plugin pack`. Each plugin directory has a build.json naming its entry scripts (bundled with
// esbuild) and the static files to copy. Only changed files are written and stale ones removed, so a
// development folder that Vormio watches reloads once per build.
//
//   node scripts/build.ts [--watch] [plugin ...]

import { watch } from 'node:fs'
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import * as esbuild from 'esbuild'

export const root = join(import.meta.dirname, '..')

interface BuildConfig {
  /** Scripts to bundle, relative to the plugin directory; `src/viewer.ts` becomes `viewer.js`. */
  entries: string[]
  /** Output path → source path relative to the plugin directory. */
  files: Record<string, string>
}

export async function pluginNames(): Promise<string[]> {
  const entries = await readdir(join(root, 'plugins'), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

const sdkPath = /[\\/]@vormio[\\/]plugin-sdk[\\/]/

/**
 * The SDK's browser entry also re-exports the manifest schema, which would pull zod (~450 KB) into
 * every page. None of the SDK's modules has side effects, but its package.json does not say so, so
 * this tells esbuild, which can then drop what a page does not use.
 */
const sdkWithoutSideEffects: esbuild.Plugin = {
  name: 'sdk-without-side-effects',
  setup(build) {
    build.onResolve({ filter: /^(@vormio\/plugin-sdk|\.)/ }, async (args) => {
      if (args.pluginData === 'resolving') return undefined
      if (!args.path.startsWith('@vormio/') && !sdkPath.test(args.importer)) return undefined
      const result = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: 'resolving',
      })
      if (result.errors.length || !sdkPath.test(result.path)) return undefined
      return { path: result.path, namespace: result.namespace, sideEffects: false }
    })
  },
}

function bundleOptions(directory: string, config: BuildConfig, dev: boolean): esbuild.BuildOptions {
  return {
    absWorkingDir: directory,
    entryPoints: config.entries,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    outdir: join(directory, 'out'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2024',
    minify: !dev,
    legalComments: 'eof',
    write: false,
    logLevel: 'warning',
    plugins: [sdkWithoutSideEffects],
  }
}

/** Bundles the entries and gathers the static files: output path → bytes. */
async function collect(
  directory: string,
  config: BuildConfig,
  bundle: () => Promise<esbuild.BuildResult>,
): Promise<Map<string, Uint8Array>> {
  const manifest = await readJson<{ version: string }>(join(directory, 'manifest.json'))
  const pkg = await readJson<{ version: string }>(join(directory, 'package.json'))
  if (manifest.version !== pkg.version)
    throw new Error(
      `${relative(root, directory)}: manifest.json version ${manifest.version} differs from package.json ${pkg.version}`,
    )
  const files = new Map<string, Uint8Array>()
  const result = await bundle()
  for (const file of result.outputFiles ?? [])
    files.set(relative(join(directory, 'out'), file.path).replaceAll('\\', '/'), file.contents)
  for (const [output, source] of Object.entries(config.files))
    files.set(output, await readFile(join(directory, source)))
  return files
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await listFiles(directory, path)))
    else files.push(path)
  }
  return files
}

async function removeEmptyFolders(directory: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    await removeEmptyFolders(directory, path)
    if ((await readdir(join(directory, path))).length === 0) await rmdir(join(directory, path))
  }
}

/** Makes `outDir` hold exactly `files`; returns how many files changed. */
async function sync(outDir: string, files: Map<string, Uint8Array>): Promise<number> {
  await mkdir(outDir, { recursive: true })
  let changed = 0
  for (const path of await listFiles(outDir))
    if (!files.has(path)) {
      await rm(join(outDir, path))
      changed++
    }
  await removeEmptyFolders(outDir)
  for (const [path, data] of files) {
    const target = join(outDir, path)
    const previous = await readFile(target).catch(() => undefined)
    if (previous?.equals(data)) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    changed++
  }
  return changed
}

/** Builds one plugin into `outDir` (default `dist/<name>`); returns the output's file paths. */
export async function buildPlugin(
  name: string,
  outDir = join(root, 'dist', name),
  options: { dev?: boolean } = {},
): Promise<string[]> {
  const directory = join(root, 'plugins', name)
  const config = await readJson<BuildConfig>(join(directory, 'build.json'))
  const files = await collect(directory, config, () =>
    esbuild.build(bundleOptions(directory, config, options.dev ?? false)),
  )
  await sync(outDir, files)
  return [...files.keys()].sort()
}

/** Rebuilds `dist/<name>` whenever something in the plugin directory changes. */
async function watchPlugin(name: string): Promise<void> {
  const directory = join(root, 'plugins', name)
  const outDir = join(root, 'dist', name)
  const config = await readJson<BuildConfig>(join(directory, 'build.json'))
  const context = await esbuild.context(bundleOptions(directory, config, true))
  let timer: NodeJS.Timeout | undefined
  let running = Promise.resolve()
  const run = () => {
    running = running.then(async () => {
      try {
        const changed = await sync(
          outDir,
          await collect(directory, config, () => context.rebuild()),
        )
        if (changed) console.log(`${name}: ${changed} file(s) updated in ${relative(root, outDir)}`)
      } catch (error) {
        console.error(`${name}: build failed\n${error instanceof Error ? error.message : error}`)
      }
    })
  }
  watch(directory, { recursive: true }, (_event, file) => {
    if (!file || /^(node_modules|tests)([\\/]|$)/.test(file)) return
    clearTimeout(timer)
    timer = setTimeout(run, 100)
  })
  run()
  console.log(`${name}: watching ${relative(root, directory)} → ${relative(root, outDir)}`)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { watch: { type: 'boolean', default: false } },
    allowPositionals: true,
  })
  const names = positionals.length ? positionals : await pluginNames()
  for (const name of names) {
    if (values.watch) await watchPlugin(name)
    else {
      const files = await buildPlugin(name)
      console.log(`${name}: ${files.length} files → ${relative(root, join(root, 'dist', name))}`)
    }
  }
}
