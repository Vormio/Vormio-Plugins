import { readCompanion, type CompanionStatus, type PluginInput } from '@vormio/plugin-sdk'

const reasons: Record<CompanionStatus | 'ok', string> = {
  ok: '文件可以读取，但内容无法解码',
  missing: '文件不存在',
  unauthorized: '插件不读取这种类型的文件',
  'out-of-bounds': '路径不合法',
  'over-limit': '引用的文件太多',
  changed: '文件在磁盘上已变化，需要重新扫描',
  unavailable: '暂时无法读取',
}

export interface CompanionProblem {
  /** As the model refers to it, relative to the model's folder. */
  path: string
  reason: string
}

/**
 * Explains why resources failed to load. Files next to the model are asked for once more through
 * `readCompanion`, whose status says whether the file is missing, undeclared, changed and so on.
 */
export async function explainFailures(
  input: PluginInput,
  urls: readonly string[],
): Promise<CompanionProblem[]> {
  return Promise.all(
    [...new Set(urls)].map(async (url) => {
      if (!sameFolderTree(input.url, url)) return { path: '内嵌数据', reason: '无法解码' }
      const result = await readCompanion(input, url)
      return { path: relativeTo(input.url, url), reason: reasons[result.status] }
    }),
  )
}

/** One line for a problem, such as `textures/a.png（文件不存在）`. */
export function describeProblem(problem: CompanionProblem): string {
  return `${problem.path}（${problem.reason}）`
}

function sameFolderTree(input: string, url: string): boolean {
  try {
    const a = new URL(input)
    const b = new URL(url)
    return a.protocol === b.protocol && a.host === b.host
  } catch {
    return false
  }
}

/** The path from the folder of `from` to `to`, decoded for display (`../textures/a b.png`). */
export function relativeTo(from: string, to: string): string {
  const source = new URL(from).pathname.split('/').slice(1, -1)
  const target = new URL(to).pathname.split('/').slice(1)
  let shared = 0
  while (shared < source.length && shared < target.length - 1 && source[shared] === target[shared])
    shared++
  const path = [...source.slice(shared).map(() => '..'), ...target.slice(shared)].join('/')
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
