import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 显式绑 IPv4 回环：Node 在 Windows 下把 'localhost' 解析成 ::1，
    // 只监听 IPv6 会让一切按 127.0.0.1 取页面的工具（预览面板、探测器）连不上。
    // 浏览器访问 localhost 时会自动回落到 127.0.0.1，两个地址都能用。
    host: '127.0.0.1',
    port: 5173,
    // 端口被占时直接报错，不要悄悄换到 5174，否则预览地址和实际服务对不上
    strictPort: true,
    open: false,
  },
})
