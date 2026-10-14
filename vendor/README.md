# vendor

固定版本的外部产物，每份都记录来源与 SHA-256：

- Vormio-Core 发布的插件 SDK 打包产物。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。
- Spine 3.8 运行时（`spine-ts-3.8/`），见文末。它不在 npm 上，Spine 插件把它打进包里。

| 文件                                  | 版本  | 来源                                                                                                | SHA-256                                                            |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.5-6cf994f.tgz` | 0.0.5 | Vormio-Core `6cf994ffb9f5ea3de58953a5b5942244b07354e6`（`plugin-center` 分支），`pnpm run sdk:pack` | `d53a560d3682bca9c4dbcf000a8604e8cc2a83414c738c579900d8687d2b6f6f` |

- 由 Core 提交 `6cf994f` 在干净的工作区中构建，2026-10-14 复制到这里并校验了 SHA-256。文件名中的提交号是 `sdk:pack` 加上的；工作区有未提交改动时它还会加 `-dirty`，这样的 tarball 不能放进这里。
- 它替换了 0.0.3（Core `9d56146` 构建，SHA-256 `61b94764f7b85b823b8a23ffad6bed2a8c33c6e17e3fd67d2141f5af35d300e2`）。0.0.5 新增签名的插件目录：`@vormio/plugin-sdk/node` 的 `verifyCatalog`、`signCatalog`、`writeCatalog` 等，以及命令 `vormio-plugin keygen` 与 `vormio-plugin catalog`（本仓库的 `pnpm run catalog` 用它）。包规则新增 `.vormioplugin` 文件的上限 96 MiB（`packageLimits.maxArchiveBytes`）。SDK 以 MIT 许可证发布，包内带 `LICENSE`。
- 插件契约仍是 `apiVersion: 1`，manifest 规则与运行时辅助函数没有变化。换用后重新构建的插件代码逐字节相同，只有 esbuild 分块的文件名变了：分块名的哈希包含 SDK 在 `node_modules` 中的路径，而这个路径带着 tarball 的文件名。
- 宿主只加载与自己相同 `apiVersion` 的插件。

更新时：

1. 在 Core 运行 `pnpm run sdk:pack`，把新的 tarball 复制到这里，校验 SHA-256，更新上表（Core 提交号、SHA-256）。
2. 更新根目录与各插件 `package.json` 中的 `file:` 路径，运行 `pnpm install`，确认锁文件中的 integrity 已经更新，删除不再使用的旧 tarball。
3. 保留 `sdk:pack` 给的文件名：它带着构建提交，同一版本内重新交付也会换文件名，锁文件随之更新。替换同名的 tarball 时（0.0.3 曾经这样），`pnpm install` 会认为锁文件没有变化而跳过解析，要运行 `pnpm update -r @vormio/plugin-sdk`。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.5-6cf994f.tgz
```

## Spine 3.8 运行时

| 文件                          | 来源                                                                                                                              | SHA-256                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `spine-ts-3.8/spine-webgl.js` | `EsotericSoftware/spine-runtimes` 的 `3.8` 分支，提交 `28727aff223afd731effbdee2b8f745211c95423`，`spine-ts/build/spine-webgl.js` | `4b108bad314c152bf0ff7a7f56fce5c98073f05a2bfa53e880d6c24b6f7c3aa5` |
| `spine-ts-3.8/LICENSE`        | 同一提交的 `LICENSE`（Spine Runtimes 许可协议，2019-05-01 版）                                                                    | `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39` |

- 官方只在 Spine Runtimes 仓库中提供 3.8 的 spine-ts，没有 npm 包（`@esotericsoftware/spine-*` 从 4.0 开始）。这个提交是 `3.8` 分支上最后一次改动 `spine-ts` 的提交（2022-01-21）；2026-10-14 取下时，分支最新提交中的文件与它逐字节相同。
- `spine-webgl.js` 是预先构建的脚本，不是 ES 模块：它定义全局变量 `spine`，WebGL 的类在 `spine.webgl` 中。Spine 插件把它原样复制为包内的 `runtimes/spine-webgl-3.8.js`，显示 3.8 骨骼时才加载；许可协议复制为 `licenses/SPINE-RUNTIMES-3.8.txt`。文件中没有 `eval`。末尾的 source map 注释指向的文件不在包内，只影响开发者工具。
- 这两个文件不经 Prettier 格式化（见 `.prettierignore`），保持与来源相同。

更新时：从同一分支取新的提交，替换两个文件，更新上表（提交号、SHA-256），运行全部测试。

校验：

```bash
sha256sum vendor/spine-ts-3.8/spine-webgl.js vendor/spine-ts-3.8/LICENSE
```
