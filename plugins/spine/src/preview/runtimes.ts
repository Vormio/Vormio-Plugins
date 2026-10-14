import type { Runtime } from './figure.ts'
import type { RuntimeLine } from './version.ts'

/** Each runtime line's module, a chunk of its own. */
const modules: Record<RuntimeLine, () => Promise<{ runtime: Runtime }>> = {
  '4.0': () => import('./runtime-4.0.ts'),
  '4.1': () => import('./runtime-4.1.ts'),
  '4.2': () => import('./runtime-4.2.ts'),
  '4.3': () => import('./runtime-4.3.ts'),
}

/** The runtime for a line, loaded the first time it is needed. */
const loaded = new Map<RuntimeLine, Promise<Runtime>>()

export function loadRuntime(line: RuntimeLine): Promise<Runtime> {
  let runtime = loaded.get(line)
  if (!runtime) {
    runtime = modules[line]().then((module) => module.runtime)
    loaded.set(line, runtime)
  }
  return runtime
}
