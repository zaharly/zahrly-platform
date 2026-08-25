import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function shadcnRuntimePlugin(): Plugin {
  const runtime = path.resolve(__dirname, 'lib/shadcn-runtime.tsx')
  return {
    name: 'zahrly-shadcn-runtime',
    resolveId(source, importer) {
      if (!importer || !source.includes('/lib/shadcn/')) return null

      const candidate = path.resolve(path.dirname(importer), source)
      const extensions = ['', '.tsx', '.ts', '.jsx', '.js']
      if (extensions.some((ext) => fs.existsSync(`${candidate}${ext}`))) return null

      return runtime
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
