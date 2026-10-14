// Generates the Spine test fixtures in fixtures/spine/; run through scripts/make-fixtures.ts.
// Skeletons, atlases and page images are all written here, so the fixtures contain no Spine examples
// or other third-party content. JSON skeletons and atlases follow the public format descriptions;
// outside preview/ they are structural samples for the analyzer, not what a renderer needs. The
// skeletons in preview/ are small renderable figures for the skeleton previews, in JSON and in
// binary; spine-binary.ts writes the binary ones.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { png, type Rgba } from './png.ts'
import { writeSkeleton, type BinarySkeleton } from './spine-binary.ts'

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

// --- legacy: Spine 3.8 and 3.7 JSON and the 3.x atlas syntax ----------------------------------------

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

// Spine 3.7: skins are an object keyed by name, without bones or constraints of their own, and
// path constraint timelines are called `paths`. Every attachment type, two skins, every
// constraint, an event with audio and both spellings of the draw order timeline.
await write(
  'legacy/druid.json',
  json({
    skeleton: { hash: 'vormio-fixture-druid', spine: '3.7.94', width: 100, height: 180 },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', y: 70 },
      { name: 'torso', parent: 'hip', length: 50, rotation: 90 },
      { name: 'head', parent: 'torso', length: 25, x: 50 },
      { name: 'arm', parent: 'torso', length: 35, x: 45, rotation: 150 },
      { name: 'staff', parent: 'arm', length: 60, x: 35 },
      { name: 'cape', parent: 'torso', length: 45, x: 48, rotation: 180 },
      { name: 'vine', parent: 'root' },
    ],
    slots: [
      { name: 'cape', bone: 'cape', attachment: 'cape' },
      { name: 'torso', bone: 'torso', attachment: 'torso' },
      { name: 'head', bone: 'head', attachment: 'head' },
      { name: 'arm', bone: 'arm', attachment: 'arm' },
      { name: 'staff', bone: 'staff', attachment: 'staff' },
      { name: 'clip', bone: 'root', attachment: 'clip' },
      { name: 'vine', bone: 'vine', attachment: 'vine' },
      { name: 'hitbox', bone: 'hip', attachment: 'hitbox' },
      { name: 'focus', bone: 'staff', attachment: 'focus' },
    ],
    ik: [{ name: 'arm-ik', bones: ['arm'], target: 'hip', mix: 0.5 }],
    transform: [{ name: 'head-follow', bones: ['head'], target: 'torso', rotateMix: 0.3 }],
    path: [{ name: 'vine-path', bones: ['cape'], target: 'vine' }],
    skins: {
      default: {
        cape: { cape: mesh },
        torso: { torso: { width: 30, height: 50 } },
        head: {
          head: { path: 'head-front', width: 26, height: 26 },
          'head-blink': { width: 26, height: 26 },
        },
        arm: { arm: { width: 35, height: 10 } },
        staff: { staff: { name: 'staff-oak', width: 60, height: 8 } },
        clip: {
          clip: { type: 'clipping', end: 'cape', vertexCount: 3, vertices: [0, 0, 1, 0, 0, 1] },
        },
        vine: {
          vine: { type: 'path', vertexCount: 3, vertices: [0, 0, 1, 1, 2, 2], lengths: [3] },
        },
        hitbox: { hitbox: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 1, 0, 0, 1] } },
        focus: { focus: { type: 'point', x: 60, rotation: 0 } },
      },
      robed: {
        cape: {
          cape: { type: 'linkedmesh', parent: 'cape', skin: 'default', path: 'cape-robed' },
        },
        head: { head: { name: 'hood', width: 28, height: 28 } },
      },
    },
    events: { chant: { audio: 'chant.wav', volume: 0.8 }, step: { string: 'left' } },
    animations: {
      cast: {
        bones: {
          torso: {
            rotate: [
              { time: 0, angle: 90 },
              { time: 1, angle: 95 },
            ],
          },
        },
        slots: {
          head: {
            attachment: [
              { time: 0.5, name: 'head-blink' },
              { time: 0.7, name: 'head' },
            ],
          },
          staff: { color: [{ time: 0, color: 'ffffffff' }] },
        },
        ik: { 'arm-ik': [{ time: 0, mix: 1 }] },
        transform: { 'head-follow': [{ time: 0, rotateMix: 0.5 }] },
        paths: { 'vine-path': { position: [{ time: 0, position: 0.2 }] } },
        deform: { default: { cape: { cape: [{ time: 0, vertices: [0, 1] }] } } },
        events: [{ time: 0.2, name: 'chant' }],
        drawOrder: [{ time: 0.5, offsets: [{ slot: 'arm', offset: -2 }] }],
      },
      walk: {
        bones: {
          hip: {
            translate: [
              { time: 0, x: 0 },
              { time: 0.5, x: 8 },
            ],
          },
        },
        events: [{ time: 0.1, name: 'step' }],
        draworder: [{ time: 0.3, offsets: [{ slot: 'staff', offset: -4 }] }],
      },
    },
  }),
)

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
await write('problems/not-spine.json', json({ name: 'some-package', version: '1.0.0' }))

// --- preview: skeletons the Spine runtimes can render, in binary and JSON -----------------------------
//
// A figure of three region attachments: a body with an arm on its right and a head on top. Each
// region is one solid colour on the page, so a test can tell from the colours which attachments
// were drawn. The "armored" skin swaps the head for a helmet; "wave" raises the arm and "blink"
// hides the head for a moment.

const figure = (version: string): BinarySkeleton => ({
  version,
  bones: [
    { name: 'root' },
    { name: 'body', parent: 0 },
    { name: 'head', parent: 1, y: 48, length: 32 },
    { name: 'arm', parent: 1, x: 16, y: 40, length: 32 },
  ],
  slots: [
    { name: 'body', bone: 1, attachment: 'body' },
    { name: 'arm', bone: 3, attachment: 'arm' },
    { name: 'head', bone: 2, attachment: 'head' },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        0: { body: { y: 24, width: 32, height: 48 } },
        1: { arm: { x: 16, width: 32, height: 16 } },
        2: { head: { y: 16, width: 32, height: 32 } },
      },
    },
    {
      name: 'armored',
      attachments: { 2: { head: { name: 'helmet', y: 16, width: 32, height: 32 } } },
    },
  ],
  animations: [
    {
      name: 'wave',
      rotate: {
        3: [
          [0, 0],
          [0.5, 60],
          [1, 0],
        ],
      },
    },
    {
      name: 'blink',
      attachment: {
        2: [
          [0, 'head'],
          [0.25, null],
          [0.5, 'head'],
        ],
      },
    },
  ],
})
/** The figure's regions on its page, with 2 transparent pixels around each as the packer leaves. */
const figureRegions = [
  { name: 'body', x: 2, y: 2, width: 32, height: 48 },
  { name: 'head', x: 38, y: 2, width: 32, height: 32 },
  { name: 'helmet', x: 38, y: 38, width: 32, height: 32 },
  { name: 'arm', x: 2, y: 54, width: 32, height: 16 },
]
/** A page with the figure's regions; `colors` are the body, head, helmet and arm. */
const figurePage = (colors: [Rgba, Rgba, Rgba, Rgba]) =>
  png(72, 72, (x, y) => {
    const index = figureRegions.findIndex(
      (region) =>
        x >= region.x &&
        y >= region.y &&
        x < region.x + region.width &&
        y < region.y + region.height,
    )
    return index < 0 ? [0, 0, 0, 0] : colors[index]!
  })
const figureAtlas = (pageName: string) =>
  atlas(
    pageName,
    'size: 72, 72',
    'filter: Linear, Linear',
    ...figureRegions.flatMap(({ name, x, y, width, height }) => [
      name,
      `bounds: ${x}, ${y}, ${width}, ${height}`,
    ]),
  )
/** The same regions in the 3.x syntax, which the 3.8 runtime reads; it does not know `bounds`. */
const figureAtlas38 = (pageName: string) =>
  atlas(
    '',
    pageName,
    'size: 72,72',
    'format: RGBA8888',
    'filter: Linear,Linear',
    'repeat: none',
    ...figureRegions.flatMap(({ name, x, y, width, height }) => [
      name,
      '  rotate: false',
      `  xy: ${x}, ${y}`,
      `  size: ${width}, ${height}`,
      `  orig: ${width}, ${height}`,
      '  offset: 0, 0',
      '  index: -1',
    ]),
  )
const red: Rgba = [220, 38, 38, 255]

/**
 * The same figure as a JSON skeleton, following the public format description. Spine exports
 * either form next to the same atlas. From 3.7 to 4.3 these parts of the JSON are alike, except
 * that a 3.x rotate key gives its angle as `angle` and 4.x as `value`, and that 3.7 writes the
 * skins as an object by name instead of a list.
 */
function figureJson(skeleton: BinarySkeleton): string {
  const angle = skeleton.version.startsWith('3.') ? 'angle' : 'value'
  const skinsByName = skeleton.version.startsWith('3.7.')
  const bone = (index: number) => skeleton.bones[index]!.name
  /** Entries by bone or slot index, keyed by its name instead; undefined when there are none. */
  const named = <T, U>(
    list: { name: string }[],
    entries: Record<number, T> | undefined,
    map: (value: T) => U,
  ) =>
    entries &&
    Object.fromEntries(
      Object.entries(entries).map(([index, value]) => [list[Number(index)]!.name, map(value)]),
    )
  return json({
    skeleton: { hash: 'vormio-fixture-figure', spine: skeleton.version },
    bones: skeleton.bones.map(({ name, parent, ...rest }) =>
      parent === undefined ? { name, ...rest } : { name, parent: bone(parent), ...rest },
    ),
    slots: skeleton.slots.map(({ name, bone: index, attachment }) => ({
      name,
      bone: bone(index),
      attachment,
    })),
    skins: skinsByName
      ? Object.fromEntries(
          skeleton.skins.map(({ name, attachments }) => [
            name,
            named(skeleton.slots, attachments, (each) => each),
          ]),
        )
      : skeleton.skins.map(({ name, attachments }) => ({
          name,
          attachments: named(skeleton.slots, attachments, (each) => each),
        })),
    animations: Object.fromEntries(
      skeleton.animations.map(({ name, rotate, attachment }) => [
        name,
        {
          bones: named(skeleton.bones, rotate, (keys) => ({
            rotate: keys.map(([time, value]) => ({ time, [angle]: value })),
          })),
          slots: named(skeleton.slots, attachment, (keys) => ({
            attachment: keys.map(([time, name]) => ({ time, name })),
          })),
        },
      ]),
    ),
  })
}

await write('preview/hero.skel', writeSkeleton(figure('4.2.43'), '4.2'))
await write('preview/hero.json', figureJson(figure('4.2.43')))
await write('preview/hero.atlas', figureAtlas('hero.png'))
await write(
  'preview/hero.png',
  figurePage([[37, 99, 235, 255], [22, 163, 74, 255], red, [234, 179, 8, 255]]),
)
await write('preview/knight.skel', writeSkeleton(figure('4.3.13'), '4.3'))
await write('preview/knight.json', figureJson(figure('4.3.13')))
await write('preview/knight.atlas', figureAtlas('knight.png'))
await write(
  'preview/knight.png',
  figurePage([[124, 58, 237, 255], [234, 88, 12, 255], red, [22, 163, 74, 255]]),
)
await write('preview/scout.skel', writeSkeleton(figure('4.0.64'), '4.0'))
await write('preview/scout.json', figureJson(figure('4.0.64')))
await write('preview/scout.atlas', figureAtlas('scout.png'))
await write(
  'preview/scout.png',
  figurePage([[234, 179, 8, 255], [37, 99, 235, 255], red, [124, 58, 237, 255]]),
)
await write('preview/ranger.skel', writeSkeleton(figure('3.8.99'), '3.8'))
await write('preview/ranger.json', figureJson(figure('3.8.99')))
await write('preview/ranger.atlas', figureAtlas38('ranger.png'))
await write(
  'preview/ranger.png',
  figurePage([[234, 88, 12, 255], [22, 163, 74, 255], red, [124, 58, 237, 255]]),
)
await write('preview/wizard.skel', writeSkeleton(figure('3.7.94'), '3.7'))
await write('preview/wizard.json', figureJson(figure('3.7.94')))
await write('preview/wizard.atlas', figureAtlas38('wizard.png'))
await write(
  'preview/wizard.png',
  figurePage([[37, 99, 235, 255], [234, 179, 8, 255], red, [234, 88, 12, 255]]),
)
await write('preview/squire.skel', writeSkeleton(figure('4.1.24'), '4.1'))
await write('preview/squire.json', figureJson(figure('4.1.24')))
await write('preview/squire.atlas', figureAtlas('squire.png'))
await write(
  'preview/squire.png',
  figurePage([[22, 163, 74, 255], [124, 58, 237, 255], red, [37, 99, 235, 255]]),
)
// No orphan.atlas next to it.
await write('preview/orphan.skel', writeSkeleton(figure('4.2.43'), '4.2'))
// Its atlas names a page that does not exist.
await write('preview/torn.skel', writeSkeleton(figure('4.2.43'), '4.2'))
await write('preview/torn.atlas', figureAtlas('torn.png'))
// Cut off in the middle of the skeleton data.
const whole = writeSkeleton(figure('4.2.43'), '4.2')
await write('preview/truncated.skel', whole.subarray(0, Math.floor(whole.length / 2)))
await write('preview/truncated.atlas', figureAtlas('hero.png'))
// Bones only: nothing to draw.
await write(
  'preview/empty.skel',
  writeSkeleton(
    { version: '4.2.43', bones: [{ name: 'root' }], slots: [], skins: [], animations: [] },
    '4.2',
  ),
)
await write('preview/empty.atlas', figureAtlas('hero.png'))
// A newer and an older header, without a runtime in the plugin; before 4.0 the hash is a string.
// Only the header matters, so the rest is left out.
await write('preview/spine-5.0.skel', writeSkeleton(figure('5.0.00'), '4.3').subarray(0, 32))
const text = (value: string) => [value.length + 1, ...new TextEncoder().encode(value)]
await write(
  'preview/spine-3.6.skel',
  Uint8Array.from([...text('vormio-fixture'), ...text('3.6.53'), 0, 0, 0, 0]),
)
// A 3.6 JSON skeleton (skins are an object): Spine, but no runtime in the plugin reads it.
await write(
  'preview/spine-3.6.json',
  json({ skeleton: { spine: '3.6.53' }, bones: [{ name: 'root' }], slots: [], skins: {} }),
)
// JSON that is not Spine: the previews decline it. An object, an array, and text that is not JSON
// at all, such as JSON with comments.
await write(
  'preview/settings.json',
  json({ name: 'figure-tools', version: '1.0.0', skeleton: 'hero.skel' }),
)
await write(
  'preview/table.json',
  json([
    { id: 1, name: 'hero', hp: 100 },
    { id: 2, name: 'knight', hp: 140 },
  ]),
)
await write('preview/notes.json', '// Not JSON: comments are not allowed.\n{ "draft": true }\n')

console.log(`fixtures written to ${output}`)
