import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const MAIN_PORT = process.env.GS_MAIN_PORT || '8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // SSH 터널(-L 8732:127.0.0.1:8732)로 노트북에서 바로 볼 수 있게 고정
  // /api, /ws 는 메인 서버(FastAPI :8000)로 넘긴다. 서버가 없으면 화면은 브라우저 시뮬레이션으로 돈다
  // 다른 포트의 메인 서버에 붙이려면 GS_MAIN_PORT=8010 npx vite … 처럼 띄운다 (worktree 여러 개를 동시에 띄울 때)
  server: {
    port: 8732,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${MAIN_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${MAIN_PORT}`, ws: true },
    },
  },
  preview: { port: 8732, strictPort: true },
})
