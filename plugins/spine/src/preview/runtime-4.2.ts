// The Spine 4.2 runtime; loaded only for 4.2 data. Its module has the shape of the 4.3 one that
// figure.ts is typed against, except for the calls in classic.ts.

import * as spine from 'spine-webgl-4.2'
import { classicDifferences } from './classic.ts'
import { createRuntime, type Spine } from './figure.ts'

export const runtime = createRuntime('4.2', spine as unknown as Spine, classicDifferences(spine))
