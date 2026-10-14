import type { Runtime } from './figure.ts'
import type { RuntimeLine } from './version.ts'

/** The runtime for a line, loaded the first time it is needed; each is a chunk of its own. */
const loaded = new Map<RuntimeLine, Promise<Runtime>>()

export function loadRuntime(line: RuntimeLine): Promise<Runtime> {
  let runtime = loaded.get(line)
  if (!runtime) {
    runtime =
      line === '4.2'
        ? import('./runtime-4.2.ts').then((module) => module.runtime)
        : import('./runtime-4.3.ts').then((module) => module.runtime)
    loaded.set(line, runtime)
  }
  return runtime
}
