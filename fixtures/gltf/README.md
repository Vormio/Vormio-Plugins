# glTF 测试素材

**来源**：全部是本仓库原创，由 [`scripts/fixtures/gltf.ts`](../../scripts/fixtures/gltf.ts) 程序生成：几何体、颜色和 PNG 编码都在脚本中写成，不含任何第三方模型、贴图或扫描数据。文件由 glTF-Transform 4.5.1 写出，Draco 与 meshopt 压缩使用 draco3dgltf 1.5.7 与 meshoptimizer 1.3.0 的编码器（只是生成工具，产物中不含它们的代码）。

**许可证**：与本仓库相同。仓库尚未选定许可证；选定后这些素材随之适用。

重新生成（结果会覆盖除本说明外的全部文件）：

```bash
pnpm run fixtures gltf
```

## 文件

| 文件                                                                                  | 内容                                                                                           | 预期                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `cube/cube.gltf`、`cube/cube.bin`、`cube/textures/quadrants.png`                      | 立方体，外部 buffer 与子文件夹中的贴图（红、绿、蓝、黄四格，最近点采样）                       | 缩略图与查看器显示四色贴图；读取 `cube.bin` 与 `textures/quadrants.png`                                  |
| `crate/scene/crate.gltf`、`crate/buffers/crate.bin`、`crate/textures/crate color.png` | 1.6 × 1 × 1 的箱子；配套文件在上一级的同级文件夹（`../`），贴图名含空格（URI 中为 `%20`）      | 显示木箱贴图；读取 `../buffers/crate.bin` 与 `../textures/crate color.png`                               |
| `props/table.gltf`、`props/table.bin`                                                 | 桌子：根节点 Table 下有桌面和四条腿，四条腿共用网格 Leg；材质 Wood（贴图）与 Metal（只有颜色） | 显示木纹桌面与金属腿；组成区列出场景 1、节点 6、网格 2、材质 2 与引用的 `table.bin`、`textures/wood.png` |
| `props/stool.gltf`、`props/stool.bin`                                                 | 凳子：座面和四条腿，都用材质 Wood                                                              | 与桌子共用 `props/textures/wood.png`，所以这张贴图“被 2 个文件引用”                                      |
| `props/textures/wood.png`                                                             | 两种棕色交错的木纹                                                                             | 删除后两个模型都显示缺失引用                                                                             |
| `globe.glb`                                                                           | 球体（2,208 个三角形），八色竖条贴图嵌入 GLB                                                   | 显示条纹球；不读取任何配套文件                                                                           |
| `globe-draco.glb`                                                                     | 同一球体，几何体用 `KHR_draco_mesh_compression` 压缩（必需扩展）                               | 与 `globe.glb` 看起来相同                                                                                |
| `globe-meshopt.glb`                                                                   | 同一球体，几何体用 `EXT_meshopt_compression` 与 `KHR_mesh_quantization` 压缩                   | 与 `globe.glb` 看起来相同                                                                                |
| `problems/missing-texture.gltf`                                                       | 几何体内嵌为 data URI；贴图 `textures/absent.png` 不存在                                       | 仍然显示（灰色材质）；查看器列出“textures/absent.png（文件不存在）”                                      |
| `problems/missing-buffer.gltf`                                                        | 引用不存在的 `absent.bin`                                                                      | 无法显示：“模型无法加载：absent.bin（文件不存在）”                                                       |
| `problems/unsupported-extension.gltf`                                                 | 必需扩展 `VORMIO_unsupported_fixture`                                                          | 无法显示，说明需要不支持的扩展                                                                           |
| `problems/truncated.glb`                                                              | `globe.glb` 的前 2,048 字节                                                                    | 无法显示：“GLB 文件不完整”                                                                               |
| `problems/gltf-1.gltf`                                                                | `asset.version` 为 1.0 的最小 JSON                                                             | 无法显示：“只支持 glTF 2.0”                                                                              |

没有 KTX2（`KHR_texture_basisu`）素材：本仓库没有可用的 Basis 编码器，也没有许可明确的现成样本。
