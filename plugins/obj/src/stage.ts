// A copy of plugins/gltf/src/stage.ts, so both viewers look and frame alike. shared/ cannot import
// three.js, which only the plugins depend on; keep the two copies the same.

import {
  DirectionalLight,
  NeutralToneMapping,
  PMREMGenerator,
  Scene,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/**
 * The look shared by the viewer and thumbnails: a neutral studio environment for PBR reflections,
 * one key light for shape, and Khronos PBR Neutral tone mapping so base colours stay recognisable.
 */
export function prepareRenderer(renderer: WebGLRenderer): Texture {
  renderer.toneMapping = NeutralToneMapping
  renderer.setClearColor(0x000000, 0)
  const generator = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = generator.fromScene(room, 0.04).texture
  room.dispose()
  generator.dispose()
  return environment
}

/**
 * A scene with the shared environment and lighting around `model`. The environment is kept dim
 * enough that a key light from the upper left front still separates the faces of a white model.
 */
export function stageScene(environment: Texture, model: Object3D): Scene {
  const scene = new Scene()
  scene.environment = environment
  scene.environmentIntensity = 0.5
  const key = new DirectionalLight(0xffffff, 1.6)
  key.position.set(-3, 3, 2)
  scene.add(key, model)
  return scene
}
