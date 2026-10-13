# vendor

Vormio-Core 发布的插件 SDK 打包产物。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。

| 文件                          | 版本  | 来源                                                                        | SHA-256                                                            |
| ----------------------------- | ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.3.tgz` | 0.0.3 | Vormio-Core `9d561461e52765325a82b7a97cf03d7c175e8499`，`pnpm run sdk:pack` | `61b94764f7b85b823b8a23ffad6bed2a8c33c6e17e3fd67d2141f5af35d300e2` |

- 由 Core 提交 `9d56146` 在干净的工作区中构建，2026-10-13 由 Core 会话交付，复制到这里并校验了 SHA-256。从 `2664854`（Close out 0.0.3）到 `9d56146`，`packages/plugin-sdk` 没有变化。
- 它**替换了同版本的旧 tarball**：Core `780e04b` 构建的 0.0.3（SHA-256 `62e6d4697eca3d5f952476c978c676ce1fa4fd0e3944b25de9ebb1c2df6deb92`）。版本号不变，因为 SDK 与 Core 同版本、Core 仍在 0.0.3。区别只在组成报告的检查，现在与宿主 `2664854` 起的判断一致：
  - `parseReport` 的 4 MiB 上限按 JSON 的 UTF-8 字节计算（旧 tarball 按字符计算，会放过宿主拒收的报告）；
  - 层级环检查是线性的（旧 tarball 对深度是平方复杂度）；
  - README 写明 `data:` 地址只报告到逗号为止的头部。
- 插件契约仍是 `apiVersion: 1`。0.0.3 相对 0.0.2 新增可选的分析器扩展点（`contributions.analyzers`、`analyzer()`、组成报告的 schema 与 `parseReport`），并声明 `"sideEffects": false`。
- 宿主只加载与自己相同 `apiVersion` 的插件。

更新时：

1. 在 Core 运行 `pnpm run sdk:pack`，把新的 tarball 复制到这里，校验 SHA-256，更新上表（Core 提交号、SHA-256）。
2. 版本号变化时，更新各 `package.json` 中的 `file:` 路径，运行 `pnpm install`，删除不再使用的旧 tarball。
3. **同名同版本替换时**，`pnpm install` 会认为锁文件没有变化而跳过解析，锁文件里仍是旧 tarball 的 integrity，干净检出上的 `pnpm install --frozen-lockfile` 会失败。要运行 `pnpm update -r @vormio/plugin-sdk`，确认锁文件中的 integrity 已经更新。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.3.tgz
```
