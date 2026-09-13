import { defineConfig } from 'tsdown'

/** Emit both the persistence service and its separately mounted recovery consumer. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/command.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
