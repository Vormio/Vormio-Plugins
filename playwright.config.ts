import { defineConfig } from '@playwright/test'

// Plugin pages run in headless Chromium; WebGL uses the SwiftShader software renderer, so the
// tests need no GPU.
export default defineConfig({
  testDir: './plugins',
  testMatch: '*/tests/*.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
})
