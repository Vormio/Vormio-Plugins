# Spine 测试素材

**来源**：全部是本仓库原创，由 [`scripts/fixtures/spine.ts`](../../scripts/fixtures/spine.ts) 程序生成：骨骼 JSON、图集文本和贴图页 PNG 都在脚本中写成，依据的是 Esoteric Software 公开的格式说明，不含任何 Spine 官方示例或其他第三方内容。它们是结构样本，不是 Spine 编辑器的真实导出：覆盖分析器读取的内容；贴图页是纯色块加白色的上、左边线，用来检查缩略图与查看器的颜色和比例，不能用来验证骨骼渲染。

**许可证**：与本仓库相同（MIT，见 [LICENSE](../../LICENSE)）。

重新生成（结果会覆盖除本说明外的全部文件，每次结果相同）：

```bash
pnpm run fixtures spine
```

## 文件

| 文件                                                                   | 内容                                                                                                                                                      | 预期                                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `basic/hero.json`                                                      | Spine 4.2 骨骼：7 根骨骼、9 个插槽、IK/变换/路径/物理约束各一个；两个皮肤，含全部七种附件（区域附件带 `path` 与序列）；两个事件；两段动画，覆盖各种时间轴 | 各类对象与内部引用齐全，没有诊断                                                          |
| `basic/hero.atlas`、`basic/hero.png`、`basic/hero_2.png`               | 4.x 写法的两页图集，9 个区域，包括序列帧 `head-blink01` 至 `03`、旋转与去白边的区域                                                                       | 2 个页面、9 个区域，两页贴图都已解析                                                      |
| `legacy/goblin.json`                                                   | Spine 3.8 骨骼，`deform` 时间轴                                                                                                                           | 9 个对象，动画引用骨骼与网格附件                                                          |
| `legacy/goblin.atlas`、`legacy/goblin.png`                             | 3.x 写法的图集：开头空行，缩进的 `xy`、`size`、`orig`、`offset`、`index: -1`                                                                              | 1 个页面、2 个区域                                                                        |
| `layout/atlases/props.atlas`                                           | 页面在 `../textures/` 下，文件名带空格、`#` 与 `%`                                                                                                        | 报告为 `../textures/props sheet.png` 与 `../textures/badge %231 100%25.png`，两页都已解析 |
| `layout/textures/props sheet.png`、`layout/textures/badge #1 100%.png` | 上一行的贴图页                                                                                                                                            | 各被 1 个文件引用                                                                         |
| `problems/missing-page.atlas`、`problems/present.png`                  | 第二页 `absent.png` 不存在                                                                                                                                | 图集显示缺失引用；`present.png` 被引用                                                    |
| `problems/duplicate-region.atlas`                                      | 两个同名区域 `a`；`b` 的帧 1 与帧 2                                                                                                                       | 一条重名警告；`b` 的两帧不算重名                                                          |
| `problems/truncated.atlas`                                             | 截断在最后一个区域的 `bounds` 中间                                                                                                                        | 保留已读到的内容，两条警告                                                                |
| `problems/no-images.atlas`                                             | 唯一的页面 `absent.png` 不存在                                                                                                                            | 缩略图失败：“贴图页都无法显示：absent.png（文件不存在）”；查看器只显示区域框并说明原因    |
| `problems/not-an-atlas.atlas`                                          | 普通文本                                                                                                                                                  | 分析失败：“不是 Spine 或 libGDX 图集”                                                     |
| `problems/broken-references.json`                                      | 父骨骼、插槽的骨骼、附件的插槽、链接网格的父网格、动画的骨骼与事件都不存在                                                                                | 六条警告，引用略去                                                                        |
| `problems/spine-3.7.json`                                              | Spine 3.7 骨骼，`skins` 是对象                                                                                                                            | 分析失败：“不支持 Spine 3.7.94 的骨骼文件”                                                |
| `problems/not-spine.json`                                              | 普通 JSON                                                                                                                                                 | 不是 Spine 骨骼文件                                                                       |

骨骼 JSON 由 `JSON.stringify` 写出，不经 Prettier 格式化（见仓库的 `.prettierignore`）。
