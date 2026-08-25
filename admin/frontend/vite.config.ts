import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

function shadcnRuntimePlugin(): Plugin {
  const runtime = path.resolve(__dirname, 'lib/shadcn-runtime.tsx')
  return {
    name: 'zahrly-shadcn-runtime',
    resolveId(source, importer) {
      if (importer && source.includes('/lib/shadcn/')) return runtime
      return null
    },
  }
}

export default defineConfig({
  plugins: [react(), shadcnRuntimePlugin()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
