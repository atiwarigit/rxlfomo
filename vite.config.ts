/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { portfolioApiPlugin } from './server/plugin.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  return {
    plugins: [react(), tailwindcss(), portfolioApiPlugin()],
    server: { port: 5173, host: true },
    preview: { port: 5173, host: true },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
