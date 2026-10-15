# OBJ 测试素材

**来源**：全部是本仓库原创，由 [`scripts/fixtures/obj.ts`](../../scripts/fixtures/obj.ts) 程序生成：几何体、材质库与贴图（PNG、TGA、BMP 的编码）都在脚本中写成，不含任何第三方模型或贴图。`not-obj/` 中的“编译产物”只是 COFF 或 ELF 文件头加填充字节，不是真正编译出来的代码。

**许可证**：与本仓库相同。

重新生成（结果会覆盖除本说明外的全部文件）：

```bash
pnpm run fixtures obj
```

## 文件

| 文件                                                                                                              | 内容                                                                                                                           | 预期                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `basic/table.obj`、`basic/table.mtl`、`basic/textures/wood grain.png`                                             | 桌子：对象 Top（组 top）与 Legs（组 legs-front、legs-back），材质 Wood（贴图在 `textures/`，文件名带空格）与 Metal             | 2 个对象、3 个组、2 个材质、1 个材质库；60 个三角形；木纹贴图 |
| `layout/model/crate.obj`、`layout/model/base.mtl`、`layout/materials/paint.mtl`、`layout/textures/stripes #2.png` | 两条 `mtllib`，第二个在 `../materials/`，重新定义 Body；Label 的贴图语句带 `-clamp`、`-s`、`-o` 选项，路径用 `\`，文件名带 `#` | Body 是绿色（后一个材质库为准），Label 显示条纹贴图           |
| `no-material/marker.obj`、`no-material/plain.obj`                                                                 | 没有材质库：带顶点颜色的四面体；没有法线的立方体                                                                               | 按顶点颜色显示；灰色，法线由 three.js 计算                    |
| `formats/blocks.obj`、`formats/blocks.mtl`、`formats/orange.tga`、`formats/green.bmp`                             | 两个方块，分别用 TGA 与 BMP 贴图                                                                                               | 橙色与绿色                                                    |
| `problems/missing-library.obj`                                                                                    | `mtllib absent.mtl`                                                                                                            | 灰色；查看器列出 absent.mtl（文件不存在）与材质 Paint         |
| `problems/missing-texture.obj`、`problems/missing-texture.mtl`                                                    | 材质的贴图 `absent.png` 不存在                                                                                                 | 保留材质的红色；查看器列出 absent.png                         |
| `problems/unknown-material.obj`、`problems/unknown-material.mtl`                                                  | `usemtl Ghost`，材质库中只有 Real                                                                                              | 灰色；查看器列出材质 Ghost                                    |
| `problems/bad-index.obj`                                                                                          | 面引用了第 9 个与第 0 个顶点，自由曲线 `curv`，未知语句 `zz`                                                                   | 三条诊断                                                      |
| `problems/truncated.obj`                                                                                          | 截断在第三个顶点中间，没有面                                                                                                   | 缩略图与查看器失败：“这个文件中没有可以显示的面、线或点。”    |
| `problems/library-issues.mtl`                                                                                     | `newmtl` 之前的贴图、重复的材质名、没有文件名的贴图语句、立方体反射贴图、`map_Pr`、未知的 `map_Xyz` 与语句 `zz`                | 五条贴图引用、四条诊断                                        |
| `not-obj/compiled-msvc.obj`、`not-obj/compiled-gcc.obj`、`not-obj/notes.obj`                                      | COFF（x64）与 ELF 文件头；一段普通文本                                                                                         | 三个扩展点都“不适用”                                          |

超上限的 OBJ 在测试中生成，不入库。
