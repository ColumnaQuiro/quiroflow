// Renders the QuiroFlow app icon (brand-blue square + white "flow" mark)
// directly to a PNG at an arbitrary size, with no rasterization tool
// dependency -- just raw pixels + Node's built-in zlib for the PNG IDAT
// chunk. Geometry is the icon SVG's own transform (translate/scale/translate
// around center, 0.72x) applied by hand to each bar's rect. Regenerate
// every platform target with `node scripts/gen-all-icons.mjs`.
//
// Usage: node gen-icon.mjs <size> <outPath> [fg-only]
//   fg-only: transparent background, white bars only (Android adaptive
//   icon foreground layer -- the background color is a separate resource).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = Number(process.argv[2] || 1024)
const OUT = process.argv[3] || `/tmp/quiroflow-icon-${SIZE}.png`
const FG_ONLY = process.argv[4] === 'fg-only'
const BG = [0x4f, 0x46, 0xe5] // #4F46E5
const FG = [0xff, 0xff, 0xff]

const rawBars = [
  { x: 29, y: 8, w: 42, h: 18, rx: 9 },
  { x: 44.6, y: 32, w: 42, h: 18, rx: 9 },
  { x: 13.4, y: 56, w: 42, h: 18, rx: 9 },
  { x: 29, y: 80, w: 42, h: 18, rx: 9 },
]
const SCALE = 0.72
function applyGroupTransform(bar) {
  return {
    x: SCALE * (bar.x - 50) + 50,
    y: SCALE * (bar.y - 50) + 50,
    w: SCALE * bar.w,
    h: SCALE * bar.h,
    rx: SCALE * bar.rx,
  }
}
const px = SIZE / 100
const bars = rawBars.map(applyGroupTransform).map((b) => ({ x: b.x * px, y: b.y * px, w: b.w * px, h: b.h * px, rx: b.rx * px }))

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

const channels = FG_ONLY ? 4 : 3
const raw = Buffer.alloc(SIZE * (1 + SIZE * channels))
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * channels)
  raw[rowStart] = 0
  for (let x = 0; x < SIZE; x++) {
    const cx = x + 0.5
    const cy = y + 0.5
    let hit = false
    for (const b of bars) {
      if (insideRoundedRect(cx, cy, b)) {
        hit = true
        break
      }
    }
    const o = rowStart + 1 + x * channels
    if (FG_ONLY) {
      if (hit) {
        raw[o] = FG[0]; raw[o + 1] = FG[1]; raw[o + 2] = FG[2]; raw[o + 3] = 255
      } else {
        raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 0
      }
    } else {
      const color = hit ? FG : BG
      raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]
    }
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
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = FG_ONLY ? 6 : 2 // 6 = truecolor+alpha, 2 = truecolor
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const png = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
writeFileSync(OUT, png)
console.log('wrote', OUT, `${SIZE}x${SIZE}`, FG_ONLY ? '(fg-only, transparent)' : '(combined)')
