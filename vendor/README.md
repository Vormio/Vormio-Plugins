# vendor

固定版本的外部产物，每份都记录来源与 SHA-256：

- Vormio-Core 发布到 npm 的插件 SDK（`@vormio/plugin-sdk`）。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。
- Spine 3.7 与 3.8 运行时（`spine-ts-3.7/`、`spine-ts-3.8/`），见文末。它们不在 npm 上，Spine 插件把它们打进包里。

| 文件                                | 版本        | 来源                                                                                                                  | SHA-256                                                            |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.10-rc.1.tgz` | 0.0.10-rc.1 | npm `@vormio/plugin-sdk@0.0.10-rc.1`（Core 为 Vormio/Vormio-Core#5 与 #9 在标签 `next` 下发布的预发布版），`npm pack` | `b1f43c1723034eb98a92a7d27d7b21f8f6056d20e4909f399d05043bf5188d02` |

- 2026-10-15 用 `npm pack` 从 npm 取下：SHA-512（`sha512-moBI3ifftnA/F…Lvtns6m+oQ==`）与 `npm view @vormio/plugin-sdk@0.0.10-rc.1 dist.integrity` 一致，SHA-256 与 Core 在 #5、#9 中给出的相同；锁文件中的 integrity 与这份 tarball 一致。这是试用分支 `r4-agreement-candidates` 上的版本，替换了 master 上的 0.0.9（npm `@vormio/plugin-sdk@0.0.9`，Core 0.0.9，SHA-256 `11588a8857504109d2eb634a343e07b79b45586b563ec47d6e217c53fdbeedd5`）。
- 0.0.10-rc.1 与 0.0.9 相比：manifest 新增可选的 `agreement`（`title` 1–80 个字符；`file` 是包内的 `.txt` 或 `.md`，至多 256 KiB 的 UTF-8；每个插件一份），`parseManifest` 与 `checkPackage` 校验它，`CheckedPackage` 多了 `agreement`（标题、文件、全文与 SHA-256），新导出 `agreementMaxBytes` 与类型 `PluginAgreement`；报告中的引用新增 `uris`（2–16 个不重复的地址，必须带 `uriKey`，与 `uri`、`key` 三者只给一个，可以与 `inferred` 一起出现），`reportLimits` 多了 `candidates: 16`。语义见 SDK README 的 “Agreements users accept before enabling” 与 “References that look in one of several files”。插件契约升到 `apiVersion: 5`，所有插件的 manifest 都要改；Core 0.0.10 只加载 `apiVersion: 5`。
- 0.0.9 是 2026-10-15 取下的（SHA-512 `sha512-l+wwNoJC…/E6PnlaRJg==` 与 npm 的 `dist.integrity` 一致）。它替换了上一个试用分支上的预发布版 0.0.9-rc.1（Core 为 Vormio/Vormio-Core#3 在标签 `next` 下发布，SHA-256 `89f0c8ce1411ef8b9223236052f31cbfc63d0241f5f76f439f135d4332d693ab`）：两者的 `dist/` 逐字节相同；0.0.9 的 README 多了两段（一个构建由包摘要识别，开发目录的摘要与它的包相同，任何文件改动都是新的构建；查看器的每个输入都有新的 `url`，旧地址失效），`package.json` 多了 `repository` 字段。master 上之前用的是 0.0.7。
- 0.0.9 新增跨文件的子资源引用与查看器定位：报告中带 `uri` 的引用可以带 `uriKey`（目标文件报告中的 key，至多 200 个字符，可以与 `inferred` 一起出现），宿主只在同一个插件构建（插件 ID 与包摘要都相同）分析了目标文件时，在查询时按目标的报告判断；`viewer(show, { focus })` 接收宿主定位子资源的请求。语义见 SDK README 的 “References to subresources of other files” 与 “Focusing a subresource”。插件契约随之升到 `apiVersion: 4`，所有插件的 manifest 都要改，SDK 的 `parseManifest` 与 `vormio-plugin pack` 只接受 4。报告的上限（子资源 10,000、引用 50,000、诊断 500、4 MiB）不变。
- 宿主只加载与自己相同 `apiVersion` 的插件：Core 0.0.9 只加载 `apiVersion: 4`。
- 之前用的是 0.0.7（npm `@vormio/plugin-sdk@0.0.7`，Core 0.0.7，SHA-256 `b9c6f5badc5b8c05753a0813e61427246c186dc3c5808262bb4fdfc669ff9391`）；Core 0.0.8 没有发布新的 SDK。
- 0.0.7 新增推断的引用：报告中的引用可以带 `inferred`（推断依据，1–120 个字符，只能与 `uri` 一起出现），语义见 SDK README 的 “Inferred references”。插件契约随之升到 `apiVersion: 3`，所有插件的 manifest 都要改，SDK 的 `parseManifest` 与 `vormio-plugin pack` 只接受 3。
- Core 0.0.7 与 0.0.8 只加载 `apiVersion: 3`，Core 0.0.6 只加载 `apiVersion: 2`，Core 0.0.5 及更早只加载 `apiVersion: 1`。
- 之前在试用分支上用过 Core 为 Vormio/Vormio-Core#2 发布的预发布版 0.0.7-rc.1（SHA-256 `6227ababb315bff3cc314e7885d88098f7b2a0d10a04eabd2389d81b9cd8f596`），它与 0.0.7 只有 `package.json` 中的版本号不同。
- 它替换了 0.0.6（`vormio-plugin-sdk-0.0.6-02188f0.tgz`，Core `02188f0` 构建，与 npm 上的 0.0.6 逐字节相同，SHA-256 `471ab5a7342f424cdf88a82654a19d88b46809b2ad8b3f2e81fca2ef3eefdc92`）。0.0.6 新增“不适用”：`notApplicable()` 与 `isNotApplicable`，语义见 SDK README 的 “Files that are not your format”，契约是 `apiVersion: 2`。
- 再往前是 0.0.5（Core `6cf994f` 构建，SHA-256 `d53a560d3682bca9c4dbcf000a8604e8cc2a83414c738c579900d8687d2b6f6f`）与 0.0.3（Core `9d56146` 构建，SHA-256 `61b94764f7b85b823b8a23ffad6bed2a8c33c6e17e3fd67d2141f5af35d300e2`）。0.0.5 新增签名的插件目录（`@vormio/plugin-sdk/node` 的 `verifyCatalog`、`signCatalog`、`writeCatalog` 等，命令 `vormio-plugin keygen` 与 `vormio-plugin catalog`），以及 `.vormioplugin` 文件的上限 96 MiB。SDK 以 MIT 许可证发布，包内带 `LICENSE`。

更新时：

1. 只使用已发布到 npm 的版本（正式版，或 Core 为某个 issue 在 `next` 标签下发布的预发布版），不使用 Core 分支或提交上构建的 tarball。在本目录运行 `npm pack @vormio/plugin-sdk@<版本>`，确认 tarball 的 SHA-512 与 `npm view @vormio/plugin-sdk@<版本> dist.integrity` 一致，更新上表（npm 版本、对应的 Core 发布、SHA-256）。用 tarball 而不是直接写 npm 版本，是因为 pnpm 不安装刚发布的版本（最短发布时间）。
2. 更新根目录与各插件 `package.json` 中的 `file:` 路径，运行 `pnpm install`，确认锁文件中的 integrity 已经更新，删除不再使用的旧 tarball。
3. `npm pack` 给的文件名是 `vormio-plugin-sdk-<版本>.tgz`。npm 上的版本不能重新发布，同一文件名的内容不会变。
4. 换了 SDK 之后重新构建的插件，分块文件名会变：分块名的哈希包含 SDK 在 `node_modules` 中的路径，而这个路径带着 tarball 的文件名。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.10-rc.1.tgz
```

## Spine 3.7 与 3.8 运行时

| 文件                          | 来源                                                                                                                              | SHA-256                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `spine-ts-3.7/spine-webgl.js` | `EsotericSoftware/spine-runtimes` 的 `3.7` 分支，提交 `5b0d446b1f829df40d4d91de2a25904c294a8ade`，`spine-ts/build/spine-webgl.js` | `4af855a371895649bd153d28ae428012ccfac3eaf7a8416b183a68b650604891` |
| `spine-ts-3.7/LICENSE`        | 同一提交的 `LICENSE`（Spine Runtimes 许可协议，2019-05-01 版，与 3.8 的逐字节相同）                                               | `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39` |
| `spine-ts-3.8/spine-webgl.js` | `EsotericSoftware/spine-runtimes` 的 `3.8` 分支，提交 `28727aff223afd731effbdee2b8f745211c95423`，`spine-ts/build/spine-webgl.js` | `4b108bad314c152bf0ff7a7f56fce5c98073f05a2bfa53e880d6c24b6f7c3aa5` |
| `spine-ts-3.8/LICENSE`        | 同一提交的 `LICENSE`（Spine Runtimes 许可协议，2019-05-01 版）                                                                    | `6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39` |

- 官方只在 Spine Runtimes 仓库中提供 3.7 与 3.8 的 spine-ts，没有 npm 包（`@esotericsoftware/spine-*` 从 4.0 开始）。两个提交分别是 `3.7` 与 `3.8` 分支上最后一次改动 `spine-ts` 的提交（2019-07-08、2022-01-21）；2026-10-14 取下时，分支最新提交中的文件与它们逐字节相同。
- spine-ts 3.7 没有二进制读取器（`SkeletonBinary` 从 3.8 起才有）。3.7 的二进制骨骼由插件自己的读取器（按 spine-libgdx 3.7 移植，见 Spine 插件的 README）读成 spine-ts 3.7 的数据类，再由它绘制。
- `spine-webgl.js` 是预先构建的脚本，不是 ES 模块：它定义全局变量 `spine`，WebGL 的类在 `spine.webgl` 中；`spine` 已经存在时，它把自己的类加进去。Spine 插件把它们原样复制为包内的 `runtimes/spine-webgl-<版本>.js`，显示这个版本的骨骼时才加载，一次只加载一个，加载前清空 `spine`，两个版本的类不会混在一起；许可协议复制为 `licenses/SPINE-RUNTIMES-<版本>.txt`。文件中没有 `eval`。末尾的 source map 注释指向的文件不在包内，只影响开发者工具。
- 这些文件不经 Prettier 格式化（见 `.prettierignore`），保持与来源相同。

更新时：从同一分支取新的提交，替换文件，更新上表（提交号、SHA-256），运行全部测试。

校验：

```bash
sha256sum vendor/spine-ts-3.7/* vendor/spine-ts-3.8/*
```
