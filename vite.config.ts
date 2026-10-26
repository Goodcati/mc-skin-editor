import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages 的**项目型**站点发布在子路径 https://<用户名>.github.io/<仓库名>/，
  // 资源默认按根路径 /assets/... 引用会 404 → 白屏，所以必须显式给 base。
  // 若将来改用**自定义域名**或 <用户名>.github.io 主页站点（发布在根路径），把这里改回 '/'。
  // 网页版用绝对子路径；离线版（--mode offline）用相对路径，解压后双击 index.html 即可
  base: mode === 'offline' ? './' : '/mc-skin-editor/',
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
}))
