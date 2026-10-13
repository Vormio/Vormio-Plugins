// Generates the test fixtures in fixtures/<format>/ from the scripts in scripts/fixtures/. Each
// script rewrites its whole folder except the README; the output is the same on every run.
//
//   node scripts/make-fixtures.ts [gltf|spine ...]

export {}

const formats = process.argv.length > 2 ? process.argv.slice(2) : ['gltf', 'spine']
for (const format of formats) {
  if (!/^[a-z]+$/.test(format)) throw new Error(`Unknown fixture set: ${format}`)
  await import(`./fixtures/${format}.ts`)
}
