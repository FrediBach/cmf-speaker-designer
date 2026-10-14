import type { BufferGeometry } from 'three'
import { mergeCoplanarFaces } from './step-faces'

type Point = [number, number, number]
type Triangle = [number, number, number]

interface Shell {
  triangles: Triangle[]
  volume: number
  min: Point
  max: Point
  voids: Shell[]
  entity?: number
}

// Only joins floating-point seams; source coordinates are otherwise retained.
const seamTolerance = 1e-9
const encoder = new TextEncoder()

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Point, b: Point): Point {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function magnitude(point: Point): number {
  return Math.hypot(...point)
}

function contains(shell: Shell, point: Point, vertices: Point[]): boolean {
  // The solid angle avoids ambiguous rays through an edge or a vertex.
  let angle = 0
  for (const triangle of shell.triangles) {
    const a = subtract(vertices[triangle[0]], point)
    const b = subtract(vertices[triangle[1]], point)
    const c = subtract(vertices[triangle[2]], point)
    const la = magnitude(a)
    const lb = magnitude(b)
    const lc = magnitude(c)
    angle +=
      2 *
      Math.atan2(
        dot(a, cross(b, c)),
        la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb,
      )
  }
  return Math.abs(angle) > 2 * Math.PI
}

function readMesh(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index?.count ?? position?.count ?? 0
  if (!position || position.itemSize < 3 || !count || count % 3 !== 0)
    throw new Error('STP export requires a non-empty triangle mesh.')

  const vertices: Point[] = []
  const vertexMap = new Map<string, number>()
  const vertexIndices = new Uint32Array(position.count)
  for (let i = 0; i < position.count; i += 1) {
    const point: Point = [position.getX(i), position.getY(i), position.getZ(i)]
    if (!point.every(Number.isFinite))
      throw new Error('STP export cannot contain invalid coordinates.')
    const key = point
      .map((value) => Math.round(value / seamTolerance))
      .join(',')
    let vertex = vertexMap.get(key)
    if (vertex === undefined) {
      vertex = vertices.length
      vertices.push(point)
      vertexMap.set(key, vertex)
    }
    vertexIndices[i] = vertex
  }

  const triangles: Triangle[] = []
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((offset) => {
      const vertex = index ? index.getX(i + offset) : i + offset
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)
        throw new Error('STP export found an invalid triangle index.')
      return vertexIndices[vertex]
    }) as Triangle
    const [a, b, c] = triangle.map((vertex) => vertices[vertex])
    if (magnitude(cross(subtract(b, a), subtract(c, a))) === 0) continue
    triangles.push(triangle)
  }
  if (!triangles.length)
    throw new Error('STP export requires triangles with a non-zero area.')

  const parents = Int32Array.from({ length: triangles.length }, (_, i) => i)
  function root(face: number): number {
    while (parents[face] !== face) {
      parents[face] = parents[parents[face]]
      face = parents[face]
    }
    return face
  }
  const edges = new Map<
    string,
    { face: number; start: number; count: number }
  >()
  triangles.forEach((triangle, face) => {
    for (let edge = 0; edge < 3; edge += 1) {
      const start = triangle[edge]
      const end = triangle[(edge + 1) % 3]
      const key = start < end ? `${start},${end}` : `${end},${start}`
      const previous = edges.get(key)
      if (!previous) edges.set(key, { face, start, count: 1 })
      else {
        if (previous.count !== 1 || previous.start === start)
          throw new Error(
            'STP export requires consistently wound, closed mesh surfaces.',
          )
        previous.count += 1
        parents[root(face)] = root(previous.face)
      }
    }
  })
  if ([...edges.values()].some((edge) => edge.count !== 2))
    throw new Error(
      'STP export requires closed mesh surfaces without open edges.',
    )

  const components = new Map<number, Shell>()
  triangles.forEach((triangle, face) => {
    const component = root(face)
    let shell = components.get(component)
    if (!shell) {
      shell = {
        triangles: [],
        volume: 0,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        voids: [],
      }
      components.set(component, shell)
    }
    shell.triangles.push(triangle)
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        shell.min[axis] = Math.min(shell.min[axis], vertices[vertex][axis])
        shell.max[axis] = Math.max(shell.max[axis], vertices[vertex][axis])
      }
    }
  })
  const shells = [...components.values()]
  for (const shell of shells) {
    // A local origin keeps the signed-volume sum stable for translated parts.
    const origin = vertices[shell.triangles[0][0]]
    for (const triangle of shell.triangles) {
      const [a, b, c] = triangle.map((vertex) =>
        subtract(vertices[vertex], origin),
      )
      shell.volume += dot(a, cross(b, c)) / 6
    }
    if (!Number.isFinite(shell.volume) || shell.volume === 0)
      throw new Error(
        'STP export requires solid mesh surfaces with a non-zero volume.',
      )
  }

  const solids = shells.filter((shell) => shell.volume > 0)
  for (const cavity of shells.filter((shell) => shell.volume < 0)) {
    const containing = solids
      .filter((solid) =>
        cavity.min.every(
          (value, axis) =>
            value >= solid.min[axis] && cavity.max[axis] <= solid.max[axis],
        ),
      )
      .sort((a, b) => a.volume - b.volume)
      .find((solid) =>
        contains(solid, vertices[cavity.triangles[0][0]], vertices),
      )
    if (!containing)
      throw new Error('STP export found a mesh surface with inverted winding.')
    containing.voids.push(cavity)
  }
  return { vertices, shells, solids }
}

/** STEP real literals require a decimal point, including scientific notation. */
function real(value: number): string {
  const [mantissa, exponent] = String(value).toUpperCase().split('E')
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.`}${exponent === undefined ? '' : `E${exponent}`}`
}

/** ISO 10303-21 strings use escaped ASCII and UTF-16 hexadecimal sequences. */
function stepString(value: string): string {
  let escaped = ''
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    const character = value[i]
    if (character === "'") escaped += "''"
    else if (character === '\\') escaped += '\\\\'
    else if (code >= 32 && code <= 126) escaped += character
    else
      escaped += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`
  }
  return `'${escaped}'`
}

/**
 * AP214 solid B-rep in millimeters, with planar faces and shared edge topology.
 * Adjacent coplanar triangles become one face, including its interior holes.
 * ADVANCED_FACE + EDGE_LOOP follows ADVANCED_BREP_SHAPE_REPRESENTATION:
 * https://www.steptools.com/docs/stp_aim/html/t_advanced_brep_shape_representation.html
 * Curved profiles remain polygonal, without a parametric feature tree.
 * The input must be closed and consistently wound, as for the printable STL.
 */
export function exportStep(
  geometry: BufferGeometry,
  name: string,
): ArrayBuffer {
  const { vertices, shells, solids } = readMesh(geometry)
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Planar speaker solid geometry in millimeters'),'2;1');",
    `FILE_NAME(${stepString(name)},${stepString(new Date().toISOString())},(''),(''),'CMF Speaker Designer','CMF Speaker Designer','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ]
  let nextId = 1
  function add(entity: string): number {
    const id = nextId++
    lines.push(`#${id}=${entity};`)
    return id
  }
  const refs = (ids: number[]) => ids.map((id) => `#${id}`).join(',')
  const tuple = (point: Point) => point.map(real).join(',')

  const application = add(
    "APPLICATION_CONTEXT('core data for automotive mechanical design processes')",
  )
  add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${application})`,
  )
  const productContext = add(`PRODUCT_CONTEXT('',#${application},'mechanical')`)
  const product = add(
    `PRODUCT(${stepString(name)},${stepString(name)},'',(#${productContext}))`,
  )
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`)
  const definitionContext = add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',#${application},'design')`,
  )
  const definition = add(
    `PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`,
  )
  const productShape = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`)
  const length = add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))')
  const angle = add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))')
  const solidAngle = add(
    '(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())',
  )
  const uncertainty = add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${length},'distance_accuracy_value','')`,
  )
  const context = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${length},#${angle},#${solidAngle})) REPRESENTATION_CONTEXT('','3D'))`,
  )
  // Only emit vertices retained on face boundaries (plus plane origins).
  const points = new Map<number, number>()
  const vertexPoints = new Map<number, number>()
  const directions = new Map<string, number>()
  const vectors = new Map<number, number>()
  const edges = new Map<string, number>()
  function point(vertex: number): number {
    let entity = points.get(vertex)
    if (entity === undefined) {
      entity = add(`CARTESIAN_POINT('',(${tuple(vertices[vertex])}))`)
      points.set(vertex, entity)
    }
    return entity
  }
  function vertexPoint(vertex: number): number {
    let entity = vertexPoints.get(vertex)
    if (entity === undefined) {
      entity = add(`VERTEX_POINT('',#${point(vertex)})`)
      vertexPoints.set(vertex, entity)
    }
    return entity
  }
  function direction(value: Point): number {
    const length = magnitude(value)
    const key = tuple(value.map((component) => component / length) as Point)
    let entity = directions.get(key)
    if (entity === undefined) {
      entity = add(`DIRECTION('',(${key}))`)
      directions.set(key, entity)
    }
    return entity
  }
  function orientedEdge(start: number, end: number): number {
    const a = Math.min(start, end)
    const b = Math.max(start, end)
    const key = `${a},${b}`
    let edge = edges.get(key)
    if (edge === undefined) {
      const axis = direction(subtract(vertices[b], vertices[a]))
      let vector = vectors.get(axis)
      if (vector === undefined) {
        vector = add(`VECTOR('',#${axis},1.)`)
        vectors.set(axis, vector)
      }
      const line = add(`LINE('',#${point(a)},#${vector})`)
      edge = add(
        `EDGE_CURVE('',#${vertexPoint(a)},#${vertexPoint(b)},#${line},.T.)`,
      )
      edges.set(key, edge)
    }
    return add(`ORIENTED_EDGE('',*,*,#${edge},${start === a ? '.T.' : '.F.'})`)
  }

  for (const shell of shells) {
    const faces: number[] = []
    // A void's shell encloses its own volume, then ORIENTED_CLOSED_SHELL
    // reverses it to bound the surrounding material.
    const triangles =
      shell.volume > 0
        ? shell.triangles
        : shell.triangles.map(([a, b, c]): Triangle => [a, c, b])
    for (const face of mergeCoplanarFaces(vertices, triangles)) {
      const [a, b, c] = face.triangle
      const edge = subtract(vertices[b], vertices[a])
      const normal = cross(edge, subtract(vertices[c], vertices[a]))
      const axis = direction(normal)
      const reference = direction(edge)
      const placement = add(
        `AXIS2_PLACEMENT_3D('',#${point(a)},#${axis},#${reference})`,
      )
      const plane = add(`PLANE('',#${placement})`)
      const bounds = face.loops.map((vertices, index) => {
        const boundary = vertices.map((vertex, offset) =>
          orientedEdge(vertex, vertices[(offset + 1) % vertices.length]),
        )
        const loop = add(`EDGE_LOOP('',(${refs(boundary)}))`)
        const boundType = index === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'
        return add(`${boundType}('',#${loop},.T.)`)
      })
      faces.push(add(`ADVANCED_FACE('',(${refs(bounds)}),#${plane},.T.)`))
    }
    shell.entity = add(`CLOSED_SHELL('',(${refs(faces)}))`)
  }
  const bodies = solids.map((solid) => {
    if (!solid.voids.length)
      return add(`MANIFOLD_SOLID_BREP(${stepString(name)},#${solid.entity})`)
    const voids = solid.voids.map((cavity) =>
      add(`ORIENTED_CLOSED_SHELL('',*,#${cavity.entity},.F.)`),
    )
    return add(
      `BREP_WITH_VOIDS(${stepString(name)},#${solid.entity},(${refs(voids)}))`,
    )
  })
  const representation = add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION(${stepString(name)},(${refs(bodies)}),#${context})`,
  )
  add(`SHAPE_DEFINITION_REPRESENTATION(#${productShape},#${representation})`)
  lines.push('ENDSEC;', 'END-ISO-10303-21;', '')
  return encoder.encode(lines.join('\n')).buffer as ArrayBuffer
}
