import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Exercise the deployment's security policy in every production browser test,
// including responses for the geometry worker and its WebAssembly module.
const deployment = JSON.parse(
  readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
) as {
  headers: {
    source: string
    has?: unknown
    missing?: unknown
    headers: { key: string; value: string }[]
  }[]
}
const securityHeaders = Object.fromEntries(
  deployment.headers
    .filter((rule) => rule.source === '/:path*' && !rule.has && !rule.missing)
    .flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])),
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
  preview: { headers: securityHeaders },
  build: { chunkSizeWarningLimit: 1200 },
})
