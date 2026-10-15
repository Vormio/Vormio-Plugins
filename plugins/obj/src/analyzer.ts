import { analyzer, notApplicable } from '@vormio/plugin-sdk'
import { analyzeMtl } from './mtl-file.ts'
import { NotObjError, ObjAnalysis, StatementReader } from './obj-file.ts'
import { readObjChunks, readText } from './source.ts'

// The report comes from the file alone: the material libraries an OBJ names and the textures an MTL
// names are reported as written, never read, so the analyzer declares no companion formats. An OBJ
// is read in chunks and only counted, so a large one is never held as a whole. `.obj` is also the
// extension of compiled object files; they are not applicable, and the host shows no composition.
analyzer(async (input) => {
  if (input.extension === 'mtl') return analyzeMtl(await readText(input))
  try {
    const analysis = new ObjAnalysis()
    const reader = new StatementReader((statement) => analysis.statement(statement))
    for await (const chunk of readObjChunks(input)) reader.push(chunk)
    reader.end()
    return analysis.report()
  } catch (error) {
    if (error instanceof NotObjError) return notApplicable()
    throw error
  }
})
