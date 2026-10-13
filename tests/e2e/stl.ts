/** Independent binary STL inspection: no application geometry code is imported. */
export function inspectBinaryStl(binary: Buffer) {
  const triangleCount = binary.readUInt32LE(80)
  if (binary.byteLength !== 84 + triangleCount * 50)
    throw new Error('Malformed binary STL length')
  const points: [number, number, number][] = []
  const pointIds = new Map<string, number>()
  const indices = new Uint32Array(triangleCount * 3)
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  let signedVolume = 0
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = 84 + triangle * 50 + 12 + corner * 12
      const point: [number, number, number] = [
        binary.readFloatLE(offset),
        binary.readFloatLE(offset + 4),
        binary.readFloatLE(offset + 8),
      ]
      if (!point.every(Number.isFinite))
        throw new Error('Non-finite STL coordinate')
      point.forEach((coordinate, axis) => {
        minimum[axis] = Math.min(minimum[axis], coordinate)
        maximum[axis] = Math.max(maximum[axis], coordinate)
      })
      const key = point.join(',')
      let id = pointIds.get(key)
      if (id === undefined) {
        id = points.length
        pointIds.set(key, id)
        points.push(point)
      }
      indices[triangle * 3 + corner] = id
    }
    const [ax, ay, az] = points[indices[triangle * 3]]
    const [bx, by, bz] = points[indices[triangle * 3 + 1]]
    const [cx, cy, cz] = points[indices[triangle * 3 + 2]]
    signedVolume +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6
  }

  const parents = Int32Array.from(
    { length: points.length },
    (_, index) => index,
  )
  function root(index: number) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  const edges = new Map<number, number>()
  let degenerateEdges = 0
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = indices[triangle * 3 + corner]
      const b = indices[triangle * 3 + ((corner + 1) % 3)]
      if (a === b) degenerateEdges += 1
      parents[root(a)] = root(b)
      const key = Math.min(a, b) * points.length + Math.max(a, b)
      // A properly oriented closed surface uses each edge once in each direction.
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
    }
  }
  const components = new Set(Array.from(parents, (_, index) => root(index)))
    .size
  const invalidEdges = [...edges.values()].filter(
    (value) => value !== 20,
  ).length

  /** All front-to-back surface intersections at a chosen print-bed XY point. */
  function rayZ(x: number, y: number) {
    const hits: number[] = []
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const [ax, ay, az] = points[indices[triangle * 3]]
      const [bx, by, bz] = points[indices[triangle * 3 + 1]]
      const [cx, cy, cz] = points[indices[triangle * 3 + 2]]
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(denominator) < 1e-9) continue
      const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator
      const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator
      const c = 1 - a - b
      if (a >= -1e-7 && b >= -1e-7 && c >= -1e-7)
        hits.push(a * az + b * bz + c * cz)
    }
    hits.sort((a, b) => a - b)
    return hits.filter(
      (value, index) => index === 0 || Math.abs(value - hits[index - 1]) > 1e-4,
    )
  }

  return {
    triangleCount,
    minimum,
    maximum,
    signedVolume,
    components,
    invalidEdges,
    degenerateEdges,
    genus: 1 - (points.length - edges.size + triangleCount) / 2,
    rayZ,
  }
}
