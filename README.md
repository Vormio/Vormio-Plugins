# Vormio-Plugins

Official plugins for Vormio. They give the host format recognition, specialised previews, composition and reference analysis, and diagnostics. Plugins read only the files the host grants them and never modify user files.

## Plugins

| Plugin                                              | ID                     | Version     | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [glTF model](plugins/gltf/README.md)                | `vormio-plugins.gltf`  | 0.4.2-r4.1  | Thumbnails, 3D viewer with animation playback, material variants and the cameras in the file, composition and reference analysis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [Spine skeletal animation](plugins/spine/README.md) | `vormio-plugins.spine` | 0.11.0-r4.1 | Skeletons (`.json` and `.skel`, Spine 3.7, 3.8 and 4.0 to 4.3): setup-pose thumbnails, a viewer with skins and animation playback; composition analysis of skeleton JSON (Spine 3.7 to 4.3), with the atlas of the same name and the regions each attachment uses as inferred references. JSON that is not a Spine skeleton is declined and keeps the built-in preview. Texture atlases (`.atlas`): thumbnails, a viewer with region outlines, search and host-driven focus, composition and texture-page reference analysis. Includes the Spine Runtimes: every user needs their own Spine Editor license, and the host asks for agreement to the Spine Runtimes License Agreement before enabling |
| [OBJ model](plugins/obj/README.md)                  | `vormio-plugins.obj`   | 0.3.0-r4.1  | Wavefront OBJ: thumbnails and a 3D viewer with the colours and textures of its MTL material libraries (PNG, JPEG, TGA, BMP); composition analysis of objects, groups, materials and the libraries an OBJ names, with each material connected to its definition in the library (or one of the libraries) that defines it, and of the materials and textures in an MTL. Compiled object files with the `.obj` extension are declined                                                                                                                                                                                                                                                                  |

Each plugin's README lists the supported formats and versions, its capabilities, unsupported cases, and the licenses of its third-party dependencies. These versions are trial builds on the SDK prerelease 0.0.10-rc.1 (plugin contract `apiVersion: 5`, for Vormio-Core 0.0.10) for Vormio/Vormio-Core#5 and #9; they are not published. Core 0.0.9 loads only `apiVersion: 4` (glTF 0.4.1, Spine 0.10.0, OBJ 0.2.0); Core 0.0.7 and 0.0.8 load only `apiVersion: 3` (glTF 0.4.0, Spine 0.9.0, OBJ 0.1.0); Core 0.0.6 loads only `apiVersion: 2` (glTF 0.2.1, Spine 0.4.0); Core 0.0.5 and earlier load only `apiVersion: 1` (glTF 0.2.0, Spine 0.3.0 and earlier).

## Links

- Development guide (layout, build, tests, dependencies): [docs/development.md](docs/development.md)
- Plugin roadmap: [docs/roadmap.md](docs/roadmap.md)
- Plugin SDK provenance: [vendor/README.md](vendor/README.md)

## Conventions

- Plugin IDs take the form `vormio-plugins.<name>`; each plugin lives in `plugins/<name>/`.
- Versions follow semver, and `manifest.json` matches the plugin's `package.json`.
- Plugins use only the pinned plugin-sdk package in `vendor/`, taken from a published npm version of `@vormio/plugin-sdk`, and never depend on Vormio-Core source.
- Host gaps and host bugs go to [Vormio-Core issues](https://github.com/Vormio/Vormio-Core/issues) (label `from:plugins`).
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

In Vormio, open the **插件** (Plugins) page, choose **添加开发目录…** (Add development folder…), point it at `dist/gltf` and enable the plugin in your library; it reloads after every build. Before committing, run `pnpm run lint`, `pnpm run typecheck` and `pnpm test`. To package a plugin, run `pnpm run package <plugin>`; the output goes to `artifacts/`. The official plugin catalog is signed with `pnpm run catalog` from the plugins listed in `release.json`, keeping the previous catalog's releases for other plugin API versions; see the development guide.

## License

[MIT](LICENSE). Third-party code bundled in plugin packages keeps its own license; see each plugin's README.
