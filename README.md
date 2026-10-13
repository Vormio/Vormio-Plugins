# Vormio-Plugins

Official plugins for Vormio. They give the host format recognition, specialised previews, composition and reference analysis, and diagnostics. Plugins read only the files the host grants them and never modify user files.

## Plugins

| Plugin                                              | ID                     | Version | Capabilities                                                                                                                      |
| --------------------------------------------------- | ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [glTF model](plugins/gltf/README.md)                | `vormio-plugins.gltf`  | 0.2.0   | Thumbnails, 3D viewer, composition and reference analysis                                                                         |
| [Spine skeletal animation](plugins/spine/README.md) | `vormio-plugins.spine` | 0.2.0   | Texture atlases (`.atlas`): thumbnails, a viewer with region outlines and search, composition and texture-page reference analysis |

Each plugin's README lists the supported formats and versions, its capabilities, unsupported cases, and the licenses of its third-party dependencies.

## Links

- Development guide (layout, build, tests, dependencies): [docs/development.md](docs/development.md)
- Plugin roadmap: [docs/roadmap.md](docs/roadmap.md)
- Plugin SDK provenance: [vendor/README.md](vendor/README.md)

## Conventions

- Plugin IDs take the form `vormio-plugins.<name>`; each plugin lives in `plugins/<name>/`.
- Versions follow semver, and `manifest.json` matches the plugin's `package.json`.
- Plugins use only the pinned plugin-sdk package in `vendor/` and never depend on Vormio-Core source.
- Plugins do not access the network, arbitrary paths or native processes; decoders and other binaries ship inside the plugin package.
- Test assets live in `fixtures/`, each with a recorded source and license.

## Development

Requires Node 24.21 and pnpm 12.6 (via Corepack).

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm run dev gltf
```

In Vormio, open the **插件** (Plugins) page, choose **添加开发目录…** (Add development folder…), point it at `dist/gltf` and enable the plugin in your library; it reloads after every build. Before committing, run `pnpm run lint`, `pnpm run typecheck` and `pnpm test`. To package a plugin, run `pnpm run package <plugin>`; the output goes to `artifacts/`.

## License

[MIT](LICENSE). Third-party code bundled in plugin packages keeps its own license; see each plugin's README.
