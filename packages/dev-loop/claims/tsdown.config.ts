import { defineConfig } from 'tsdown'

/** Build the Host owner and optional scoped consumer with the workspace Typert plugin. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/tool.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
