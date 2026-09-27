import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ElementPlus from 'unplugin-element-plus/vite'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

// SubHub: 开发模式下把 /api 反向代理到合并后的内核 (默认 127.0.0.1:9635)
const backendTarget = process.env.SUBHUB_BACKEND_URL || 'http://127.0.0.1:9635'

export default defineConfig({
  plugins: [
    vue(),
    // 按需注入组件样式，避免引入 element-plus 全量 CSS
    ElementPlus()
  ],
  resolve: {
    alias: {
      '@': srcDir
    }
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true
      }
    }
  }
})
