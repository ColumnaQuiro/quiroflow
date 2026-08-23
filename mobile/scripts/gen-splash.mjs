// Renders the QuiroFlow native launch-screen splash: white background with
// the brand mark (blue "flow" bars) centered, sized relative to the shorter
// canvas edge so it looks consistent across the many portrait/landscape
// density variants Android's launch theme needs. Same dependency-free PNG
// approach as gen-icon.mjs (raw pixels + zlib IDAT, no rasterizer).
//
// Usage: node gen-splash.mjs <width> <height> <outPath> [markFraction]
//   markFraction: mark's width as a fraction of min(width,height). Default 0.32.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const WIDTH = Number(process.argv[2])
const HEIGHT = Number(process.argv[3])
const OUT = process.argv[4]
const MARK_FRACTION = Number(process.argv[5] || 0.32)
const BG = [0xff, 0xff, 0xff]
const FG = [0x4f, 0x46, 0xe5] // #4F46E5

if (!WIDTH || !HEIGHT || !OUT) {
  console.error('Usage: node gen-splash.mjs <width> <height> <outPath> [markFraction]')
  process.exit(1)
}

// Same 4-bar "flow" mark geometry as gen-icon.mjs, in its native 0-100 box.
const rawBars = [
  { x: 29, y: 8, w: 42, h: 18, rx: 9 },
  { x: 44.6, y: 32, w: 42, h: 18, rx: 9 },
  { x: 13.4, y: 56, w: 42, h: 18, rx: 9 },
  { x: 29, y: 80, w: 42, h: 18, rx: 9 },
]

const markSize = MARK_FRACTION * Math.min(WIDTH, HEIGHT)
const originX = (WIDTH - markSize) / 2
const originY = (HEIGHT - markSize) / 2
const px = markSize / 100
const bars = rawBars.map((b) => ({
  x: originX + b.x * px,
  y: originY + b.y * px,
  w: b.w * px,
  h: b.h * px,
  rx: b.rx * px,
}))

function insideRoundedRect(px_, py, b) {
  const { x, y, w, h, rx } = b
  if (px_ < x || px_ > x + w || py < y || py > y + h) return false
  const cornerCases = [
    [x + rx, y + rx, px_ < x + rx && py < y + rx],
    [x + w - rx, y + rx, px_ > x + w - rx && py < y + rx],
    [x + rx, y + h - rx, px_ < x + rx && py > y + h - rx],
    [x + w - rx, y + h - rx, px_ > x + w - rx && py > y + h - rx],
  ]
  for (const [cx, cy, inCornerBox] of cornerCases) {
    if (inCornerBox) {
      const dx = px_ - cx
      const dy = py - cy
      return dx * dx + dy * dy <= rx * rx
    }
  }
  return true
}

const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3))
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 3)
  raw[rowStart] = 0
  for (let x = 0; x < WIDTH; x++) {
    const cx = x + 0.5
    const cy = y + 0.5
    let hit = false
    for (const b of bars) {
      if (insideRoundedRect(cx, cy, b)) {
        hit = true
        break
      }
    }
    const o = rowStart + 1 + x * 3
    const color = hit ? FG : BG
    raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]
  }
}

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(WIDTH, 0)
ihdr.writeUInt32BE(HEIGHT, 4)
ihdr[8] = 8
ihdr[9] = 2 // truecolor
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const png = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
writeFileSync(OUT, png)
console.log('wrote', OUT, `${WIDTH}x${HEIGHT}`)
