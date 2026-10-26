/**
 * 让离线产物能在 file:// 下双击打开。
 *
 * 两个必须的改动：
 * 1) 去掉 type="module" / crossorigin
 *    —— file:// 下 module 脚本会被 CORS 拦掉（origin 为 null）。
 * 2) 给脚本加 defer
 *    —— 去掉 module 后它就是同步脚本；Vite 把它放在 <head> 里，
 *       同步执行时 <body> 里的 #root 还不存在，React 会直接崩（白屏）。
 */
import { readFile, writeFile } from 'node:fs/promises'

const file = new URL('../dist-offline/index.html', import.meta.url)
const before = await readFile(file, 'utf8')

let html = before.replaceAll(' type="module"', '').replaceAll(' crossorigin', '')
// 只给还没有 defer 的 script 加，避免重复
html = html.replace(/<script(?![^>]*\sdefer\b)([^>]*\ssrc=)/g, '<script defer$1')

await writeFile(file, html, 'utf8')

console.log(`fix-offline-html: ${html === before ? '无需修正' : '已修正'}`)
for (const match of html.matchAll(/<script[^>]*>/g)) console.log(`  ${match[0]}`)
