// 把应用图标 SVG 转成 build/icon.png 与 build/icon.ico
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('D:/DSH/博客/package.json')
const sharp = require('sharp')

const svg = fs.readFileSync(path.join(process.cwd(), 'src/ui/favicon.svg'))
fs.mkdirSync('build', { recursive: true })

// 主图标 512x512
await sharp(svg, { density: 400 }).resize(512, 512).png().toFile('build/icon.png')
console.log('✓ build/icon.png (512x512)')

// ICO：包含多个尺寸
// electron-builder 能接受单尺寸 png 作为 icon，但 ico 更稳妥。
// 这里手工拼一个包含 256 和 128 的 ICO。
const sizes = [256, 128, 64, 48, 32, 16]
const pngs = []
for (const s of sizes) {
  const buf = await sharp(svg, { density: 400 * (s / 64) }).resize(s, s).png().toBuffer()
  pngs.push({ size: s, buf })
}

// 拼 ICO 格式（ICONDIR + ICONDIRENTRY[] + PNG 数据）
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = icon
header.writeUInt16LE(pngs.length, 4) // count

const entries = []
let offset = 6 + 16 * pngs.length
const datas = []
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0) // width
  e.writeUInt8(size >= 256 ? 0 : size, 1) // height
  e.writeUInt8(0, 2) // color palette
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  entries.push(e)
  datas.push(buf)
  offset += buf.length
}

const ico = Buffer.concat([header, ...entries, ...datas])
fs.writeFileSync('build/icon.ico', ico)
console.log(`✓ build/icon.ico (${sizes.join(', ')} → ${(ico.length / 1024).toFixed(1)} KB)`)

// 界面用的 256 PNG
await sharp(svg, { density: 400 }).resize(256, 256).png().toFile('src/ui/icon.png')
console.log('✓ src/ui/icon.png (256x256)')
