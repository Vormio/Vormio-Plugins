// Generates the Spine test fixtures in fixtures/spine/; run through scripts/make-fixtures.ts.
// Skeletons, atlases and page images are all written here from the public format descriptions, so
// the fixtures contain no Spine examples or other third-party content. They are small structural
// samples, not real Spine exports: they cover what the analyzer reads, not what a renderer needs.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { png, type Rgba } from './png.ts'

const output = join(import.meta.dirname, '..', '..', 'fixtures', 'spine')

async function write(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(join(output, path)), { recursive: true })
  await writeFile(join(output, path), data)
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
/** Atlas text: lines joined with LF, as the Spine packer writes them. */
const atlas = (...lines: string[]) => `${lines.join('\n')}\n`
const page = (width: number, height: number, color: Rgba) =>
  png(width, height, (x, y) => (x === 0 || y === 0 ? [255, 255, 255, 255] : color))

await mkdir(output, { recursive: true })
for (const name of await readdir(output))
  if (name !== 'README.md') await rm(join(output, name), { recursive: true, force: true })

// --- basic: a 4.2 skeleton with every attachment type, two skins and two atlas pages ------------

const mesh = {
  type: 'mesh',
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  triangles: [0, 1, 2, 2, 3, 0],
  vertices: [-20, -40, 20, -40, 20, 0, -20, 0],
  hull: 4,
  width: 40,
  height: 40,
}
await write(
  'basic/hero.json',
  json({
    skeleton: {
      hash: 'vormio-fixture-hero',
      spine: '4.2.43',
      x: -60,
      y: 0,
      width: 120,
      height: 200,
      images: './images/',
      audio: './audio/',
    },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', y: 80 },
      { name: 'torso', parent: 'hip', length: 60, rotation: 90 },
      { name: 'head', parent: 'torso', length: 30, x: 60 },
      { name: 'arm-l', parent: 'torso', length: 40, x: 50, rotation: 160 },
      { name: 'arm-r', parent: 'torso', length: 40, x: 50, rotation: -160 },
      { name: 'cape', parent: 'torso', length: 50, x: 55, rotation: 180 },
    ],
    slots: [
      { name: 'cape', bone: 'cape', attachment: 'cape' },
      { name: 'arm-r', bone: 'arm-r', attachment: 'arm' },
      { name: 'torso', bone: 'torso', attachment: 'torso' },
      { name: 'head', bone: 'head', attachment: 'head' },
      { name: 'arm-l', bone: 'arm-l', attachment: 'arm' },
      { name: 'clip', bone: 'root', attachment: 'clip' },
      { name: 'spline', bone: 'root', attachment: 'spline' },
      { name: 'hitbox', bone: 'hip', attachment: 'hitbox' },
      { name: 'muzzle', bone: 'arm-r', attachment: 'muzzle' },
    ],
    ik: [{ name: 'arm-ik', bones: ['arm-l'], target: 'hip', mix: 0.5 }],
    transform: [{ name: 'head-follow', bones: ['head'], target: 'torso', mixRotate: 0.3 }],
    path: [{ name: 'cape-path', bones: ['cape'], target: 'spline' }],
    physics: [{ name: 'cape-sway', bone: 'cape', inertia: 0.5 }],
    skins: [
      {
        name: 'default',
        attachments: {
          cape: { cape: mesh },
          'arm-r': { arm: { width: 40, height: 12 } },
          torso: { torso: { width: 30, height: 60 } },
          head: {
            head: { path: 'head-front', width: 30, height: 30 },
            'head-blink': {
              path: 'head-blink',
              sequence: { count: 3, start: 1, digits: 2 },
              width: 30,
              height: 30,
            },
          },
          'arm-l': { arm: { width: 40, height: 12 } },
          clip: {
            clip: { type: 'clipping', end: 'cape', vertexCount: 3, vertices: [0, 0, 1, 0, 0, 1] },
          },
          spline: {
            spline: { type: 'path', vertexCount: 3, vertices: [0, 0, 1, 1, 2, 2], lengths: [3] },
          },
          hitbox: { hitbox: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 1, 0, 0, 1] } },
          muzzle: { muzzle: { type: 'point', x: 40, rotation: 0 } },
        },
      },
      {
        name: 'armored',
        bones: ['cape'],
        physics: ['cape-sway'],
        attachments: {
          cape: {
            cape: { type: 'linkedmesh', parent: 'cape', skin: 'default', path: 'cape-armored' },
          },
          head: { head: { name: 'helmet', width: 32, height: 32 } },
        },
      },
    ],
    events: { footstep: { audio: 'footstep.wav', volume: 0.8 }, shout: { string: 'hey' } },
    animations: {
      idle: {
        bones: { torso: { rotate: [{ value: 90 }, { time: 1, value: 92 }] } },
        slots: {
          head: {
            attachment: [
              { time: 0.8, name: 'head-blink' },
              { time: 1, name: 'head' },
            ],
          },
        },
        attachments: {
          default: { head: { 'head-blink': { sequence: [{ time: 0.8, mode: 'once' }] } } },
        },
        physics: { '': { reset: [{ time: 0 }] } },
      },
      walk: {
        bones: {
          hip: { translate: [{ x: 0 }, { time: 0.5, x: 10 }] },
          'arm-l': { rotate: [{ value: 160 }] },
        },
        ik: { 'arm-ik': [{ mix: 1 }] },
        transform: { 'head-follow': [{ mixRotate: 0.5 }] },
        path: { 'cape-path': { position: [{ value: 0.2 }] } },
        physics: { 'cape-sway': { inertia: [{ value: 0.8 }] } },
        attachments: { default: { cape: { cape: { deform: [{ vertices: [0, 1] }] } } } },
        events: [{ time: 0.2, name: 'footstep' }],
        drawOrder: [{ time: 0.5, offsets: [{ slot: 'arm-r', offset: 3 }] }],
      },
    },
  }),
)
await write(
  'basic/hero.atlas',
  atlas(
    'hero.png',
    'size: 128, 64',
    'filter: Linear, Linear',
    'pma: true',
    'torso',
    'bounds: 2, 2, 30, 60',
    'head-front',
    'bounds: 34, 2, 30, 30',
    'head-blink01',
    'bounds: 66, 2, 30, 30',
    'head-blink02',
    'bounds: 98, 2, 30, 30',
    'head-blink03',
    'bounds: 34, 34, 30, 28',
    'offsets: 0, 0, 30, 30',
    'arm',
    'bounds: 66, 34, 12, 40',
    'rotate: 90',
    '',
    'hero_2.png',
    'size: 64, 64',
    'filter: Linear, Linear',
    'pma: true',
    'cape',
    'bounds: 2, 2, 40, 40',
    'cape-armored',
    'bounds: 2, 2, 40, 40',
    'helmet',
    'bounds: 44, 2, 18, 32',
    'offsets: 7, 0, 32, 32',
  ),
)
await write('basic/hero.png', page(128, 64, [37, 99, 235, 255]))
await write('basic/hero_2.png', page(64, 64, [220, 38, 38, 255]))

// --- legacy: Spine 3.8 JSON and the 3.x atlas syntax ------------------------------------------------

await write(
  'legacy/goblin.json',
  json({
    skeleton: { hash: 'vormio-fixture-goblin', spine: '3.8.99', width: 80, height: 120 },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', length: 50, rotation: 90 },
      { name: 'head', parent: 'body', length: 25, x: 50 },
    ],
    slots: [
      { name: 'body', bone: 'body', attachment: 'body' },
      { name: 'head', bone: 'head', attachment: 'head' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: { body: mesh },
          head: { head: { width: 30, height: 30 } },
        },
      },
    ],
    animations: {
      nod: {
        bones: { head: { rotate: [{ angle: 10 }, { time: 0.5 }] } },
        deform: { default: { body: { body: [{ vertices: [0, 1] }] } } },
      },
    },
  }),
)
await write(
  'legacy/goblin.atlas',
  atlas(
    '',
    'goblin.png',
    'size: 64,64',
    'format: RGBA8888',
    'filter: Linear,Linear',
    'repeat: none',
    'body',
    '  rotate: false',
    '  xy: 2, 2',
    '  size: 40, 40',
    '  orig: 40, 40',
    '  offset: 0, 0',
    '  index: -1',
    'head',
    '  rotate: true',
    '  xy: 44, 2',
    '  size: 18, 30',
    '  orig: 30, 30',
    '  offset: 0, 0',
    '  index: -1',
  ),
)
await write('legacy/goblin.png', page(64, 64, [22, 163, 74, 255]))

// --- layout: pages in another folder, with characters a URI would misread ---------------------------

await write(
  'layout/atlases/props.atlas',
  atlas(
    '../textures/props sheet.png',
    'size: 32, 32',
    'crate',
    'bounds: 0, 0, 16, 16',
    '',
    '../textures/badge #1 100%.png',
    'size: 32, 32',
    'badge',
    'bounds: 0, 0, 16, 16',
  ),
)
await write('layout/textures/props sheet.png', page(32, 32, [234, 179, 8, 255]))
await write('layout/textures/badge #1 100%.png', page(32, 32, [124, 58, 237, 255]))

// --- problems ---------------------------------------------------------------------------------------

await write(
  'problems/missing-page.atlas',
  atlas(
    'present.png',
    'size: 32, 32',
    'a',
    'bounds: 0, 0, 8, 8',
    '',
    'absent.png',
    'size: 32, 32',
    'b',
    'bounds: 0, 0, 8, 8',
  ),
)
await write('problems/present.png', page(32, 32, [13, 148, 136, 255]))
await write(
  'problems/duplicate-region.atlas',
  atlas(
    'present.png',
    'size: 32, 32',
    'a',
    'bounds: 0, 0, 8, 8',
    'a',
    'bounds: 8, 0, 8, 8',
    'b',
    'index: 1',
    'bounds: 0, 8, 8, 8',
    'b',
    'index: 2',
    'bounds: 8, 8, 8, 8',
  ),
)
// Cut off inside the last region, before its position.
await write(
  'problems/truncated.atlas',
  atlas('present.png', 'size: 32, 32', 'a', 'bounds: 0, 0, 8, 8', 'b', 'bounds: 0, 8,'),
)
// No page image exists, so there is nothing to draw a thumbnail from.
await write(
  'problems/no-images.atlas',
  atlas('absent.png', 'size: 16, 16', 'a', 'bounds: 0, 0, 8, 8'),
)
await write('problems/not-an-atlas.atlas', atlas('Shopping list', 'apples', 'pears'))
await write(
  'problems/broken-references.json',
  json({
    skeleton: { spine: '4.2.43' },
    bones: [{ name: 'root' }, { name: 'tail', parent: 'missing-bone' }],
    slots: [{ name: 'tail', bone: 'nowhere' }],
    skins: [
      {
        name: 'default',
        attachments: {
          tail: { tail: { type: 'linkedmesh', parent: 'absent-mesh' } },
          ghost: { ghost: {} },
        },
      },
    ],
    animations: { wag: { bones: { tail: {}, fin: {} }, events: [{ name: 'splash' }] } },
  }),
)
await write(
  'problems/spine-3.7.json',
  json({
    skeleton: { spine: '3.7.94' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'body', bone: 'root' }],
    skins: { default: { body: { body: { width: 10, height: 10 } } } },
  }),
)
await write('problems/not-spine.json', json({ name: 'some-package', version: '1.0.0' }))

console.log(`fixtures written to ${output}`)
