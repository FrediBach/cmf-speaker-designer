export interface ArchiveEntry {
  name: string
  data: Uint8Array
}

const encoder = new TextEncoder()
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Stored ZIP entries keep this small, browser-native export dependency-free. */
export function buildArchive(entries: ArchiveEntry[]): ArrayBuffer {
  const files = entries.map((entry) => ({
    ...entry,
    nameBytes: encoder.encode(entry.name),
    checksum: crc32(entry.data),
  }))
  const directoryOffset = files.reduce(
    (size, file) => size + 30 + file.nameBytes.length + file.data.length,
    0,
  )
  const directorySize = files.reduce(
    (size, file) => size + 46 + file.nameBytes.length,
    0,
  )
  const buffer = new ArrayBuffer(directoryOffset + directorySize + 22)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let localOffset = 0
  let centralOffset = directoryOffset

  for (const file of files) {
    view.setUint32(localOffset, 0x04034b50, true)
    view.setUint16(localOffset + 4, 20, true)
    view.setUint16(localOffset + 6, 0x0800, true) // UTF-8 filenames
    view.setUint16(localOffset + 12, 0x0021, true) // January 1, 1980
    view.setUint32(localOffset + 14, file.checksum, true)
    view.setUint32(localOffset + 18, file.data.length, true)
    view.setUint32(localOffset + 22, file.data.length, true)
    view.setUint16(localOffset + 26, file.nameBytes.length, true)
    bytes.set(file.nameBytes, localOffset + 30)
    bytes.set(file.data, localOffset + 30 + file.nameBytes.length)

    view.setUint32(centralOffset, 0x02014b50, true)
    view.setUint16(centralOffset + 4, 20, true)
    view.setUint16(centralOffset + 6, 20, true)
    view.setUint16(centralOffset + 8, 0x0800, true)
    view.setUint16(centralOffset + 14, 0x0021, true)
    view.setUint32(centralOffset + 16, file.checksum, true)
    view.setUint32(centralOffset + 20, file.data.length, true)
    view.setUint32(centralOffset + 24, file.data.length, true)
    view.setUint16(centralOffset + 28, file.nameBytes.length, true)
    view.setUint32(centralOffset + 42, localOffset, true)
    bytes.set(file.nameBytes, centralOffset + 46)

    localOffset += 30 + file.nameBytes.length + file.data.length
    centralOffset += 46 + file.nameBytes.length
  }

  view.setUint32(centralOffset, 0x06054b50, true)
  view.setUint16(centralOffset + 8, files.length, true)
  view.setUint16(centralOffset + 10, files.length, true)
  view.setUint32(centralOffset + 12, directorySize, true)
  view.setUint32(centralOffset + 16, directoryOffset, true)
  return buffer
}
