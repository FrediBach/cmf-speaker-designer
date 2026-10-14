import initializeManifold, { type Manifold } from 'manifold-3d'
import { BufferAttribute, BufferGeometry } from 'three'
import { STEP_TOLERANCE_MM } from './step-settings'

const seamTolerance = 1e-9

function readMesh(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index?.count ?? position?.count ?? 0
  if (!position || position.itemSize < 3 || !count || count % 3 !== 0)
    throw new Error('STP export requires a non-empty triangle mesh.')

  const vertices: number[] = []
  const unique = new Map<string, number>()
  const triangles = new Uint32Array(count)
  for (let corner = 0; corner < count; corner += 1) {
    const vertex = index ? index.getX(corner) : corner
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)
      throw new Error('STP export found an invalid triangle index.')
    const point = [
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
    ]
    const rounded = point.map(Math.fround)
    if (!point.every(Number.isFinite) || !rounded.every(Number.isFinite))
      throw new Error('STP export cannot contain invalid coordinates.')
    if (
      rounded.some(
        (value, axis) => Math.abs(value - point[axis]) > STEP_TOLERANCE_MM,
      )
    )
      throw new Error('STP export cannot preserve these coordinate sizes.')
    // STL triangles and creased normals duplicate vertices. Only join
    // floating-point seams, keeping separate surfaces and narrow features apart.
    const key = rounded
      .map((value) => Math.round(value / seamTolerance))
      .join(',')
    let welded = unique.get(key)
    if (welded === undefined) {
      welded = unique.size
      unique.set(key, welded)
      vertices.push(...rounded)
    }
    triangles[corner] = welded
  }
  return {
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: triangles,
  }
}

function shellTopology(solid: Manifold): string {
  const shells = solid.decompose()
  try {
    return shells
      .map((shell) => `${shell.genus()}:${Math.sign(shell.volume())}`)
      .sort()
      .join(',')
  } finally {
    shells.forEach((shell) => shell.delete())
  }
}

/** Initialize once per worker; every prepare() result belongs to its caller. */
export async function createStepMeshPreparer(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()

  return {
    prepare(geometry: BufferGeometry): BufferGeometry {
      const input = readMesh(geometry)
      const owned: Manifold[] = []
      const own = (solid: Manifold) => {
        owned.push(solid)
        return solid
      }
      try {
        let source: Manifold
        try {
          source = own(new module.Manifold(new module.Mesh(input)))
        } catch (cause) {
          throw new Error(
            'STP export requires consistently wound, closed mesh surfaces.',
            { cause },
          )
        }
        if (source.status() !== 'NoError' || source.isEmpty())
          throw new Error(
            'STP export requires consistently wound, closed mesh surfaces.',
          )
        const original = own(source.asOriginal())
        const simplified = own(original.simplify(STEP_TOLERANCE_MM))
        if (simplified.status() !== 'NoError' || simplified.isEmpty())
          throw new Error('The mesh could not be prepared for STP export.')

        const before = source.boundingBox()
        const after = simplified.boundingBox()
        const boundsPreserved = (['min', 'max'] as const).every((side) =>
          before[side].every(
            (value, axis) =>
              Math.abs(value - after[side][axis]) <= STEP_TOLERANCE_MM,
          ),
        )
        // Very small holes or separate shells must survive even when they are
        // narrower than the simplification tolerance. Retain the source if not.
        const result =
          boundsPreserved && shellTopology(source) === shellTopology(simplified)
            ? simplified
            : source
        const mesh = result.getMesh()
        const output = new BufferGeometry()
        output.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(mesh.vertProperties), 3),
        )
        output.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1))
        output.userData = {
          ...geometry.userData,
          stepToleranceMm: STEP_TOLERANCE_MM,
        }
        output.computeBoundingBox()
        output.computeBoundingSphere()
        return output
      } finally {
        owned.reverse().forEach((solid) => solid.delete())
      }
    },
  }
}
