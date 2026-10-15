import { useEffect, useMemo } from 'react'
import {
  CircleGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { BODY_COLORS, type BodyColor } from '@/lib/design'

function capsule(width: number, height: number) {
  const outline = new Shape()
  const radius = height / 2
  const offset = (width - height) / 2
  outline.moveTo(-offset, -radius)
  outline.lineTo(offset, -radius)
  outline.absarc(offset, 0, radius, -Math.PI / 2, Math.PI / 2, false)
  outline.lineTo(-offset, radius)
  outline.absarc(-offset, 0, radius, Math.PI / 2, Math.PI * 1.5, false)
  outline.closePath()
  return outline
}

function socketShape(width: number, height: number, depth: number, inset = 0) {
  const outline = capsule(width, height)
  if (inset) {
    outline.holes.push(capsule(width - inset * 2, height - inset * 2))
  }
  return new ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  })
}

/** A radial profile expressed as [radius, outward depth] on the rear face. */
function buttonProfile(points: [number, number][]) {
  const geometry = new LatheGeometry(
    points.map(([radius, depth]) => new Vector2(radius, depth)),
    48,
  )
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/** Rounded vector strokes keep the small printed symbols sharp at any zoom. */
function createLabels() {
  const shapes: Shape[] = []
  const addStroke = (path: Path, centerX: number, radius = 0.105) => {
    const points = path.getPoints(8)
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]
      const end = points[index]
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const segment = new Shape()
      const startX = start.x + centerX
      const startY = start.y - 7.5
      const endX = end.x + centerX
      const endY = end.y - 7.5
      segment.moveTo(
        startX + Math.sin(angle) * radius,
        startY - Math.cos(angle) * radius,
      )
      segment.lineTo(
        endX + Math.sin(angle) * radius,
        endY - Math.cos(angle) * radius,
      )
      segment.absarc(
        endX,
        endY,
        radius,
        angle - Math.PI / 2,
        angle + Math.PI / 2,
      )
      segment.lineTo(
        startX - Math.sin(angle) * radius,
        startY + Math.cos(angle) * radius,
      )
      segment.absarc(
        startX,
        startY,
        radius,
        angle + Math.PI / 2,
        angle + Math.PI * 1.5,
      )
      segment.closePath()
      shapes.push(segment)
    }
  }

  // The reference uses a nested, rounded triangular broadcast/link mark.
  const linkOuter = new Path()
  linkOuter.moveTo(-1.35, -0.8)
  linkOuter.lineTo(-0.34, 1.08)
  linkOuter.quadraticCurveTo(0, 1.68, 0.34, 1.08)
  linkOuter.lineTo(1.35, -0.82)
  linkOuter.quadraticCurveTo(1.62, -1.35, 1.02, -1.35)
  linkOuter.lineTo(-0.7, -1.35)
  linkOuter.quadraticCurveTo(-1.05, -1.35, -0.87, -0.99)
  linkOuter.lineTo(-0.14, 0.36)
  linkOuter.quadraticCurveTo(0, 0.66, 0.16, 0.36)
  linkOuter.lineTo(0.76, -0.75)
  linkOuter.quadraticCurveTo(0.89, -1.02, 0.57, -1.02)
  linkOuter.lineTo(-0.18, -1.02)
  addStroke(linkOuter, -18.5)

  const bluetooth = new Path()
  bluetooth.moveTo(-0.85, 0.8)
  bluetooth.lineTo(0.92, -0.7)
  bluetooth.lineTo(0, -1.5)
  bluetooth.lineTo(0, 1.5)
  bluetooth.lineTo(0.92, 0.7)
  bluetooth.lineTo(-0.85, -0.8)
  addStroke(bluetooth, -4, 0.12)

  return new ShapeGeometry(shapes, 6)
}

/** Local +Z faces outward; X reads left-to-right when looking at the back. */
export function SpeakerRearDetails({ bodyColor }: { bodyColor: BodyColor }) {
  const gray = bodyColor === 'gray'
  const geometry = useMemo(
    () => ({
      buttonWell: new CircleGeometry(4.04, 48),
      buttonLip: buttonProfile([
        [4.13, 0.015],
        [4.03, 0.085],
        [3.83, 0.12],
        [3.47, 0.035],
      ]),
      buttonFace: buttonProfile([
        [0, 0.11],
        [3, 0.11],
        [3.12, 0.18],
        [3.12, 0.29],
        [3.02, 0.39],
        [0, 0.39],
      ]),
      socketWell: socketShape(8.6, 2.9, 0.025),
      socketRim: socketShape(9.15, 3.5, 0.11, 0.3),
      socketLip: socketShape(8.55, 2.9, 0.08, 0.16),
      socketTongue: socketShape(6.1, 0.4, 0.08),
      indicatorWell: new CircleGeometry(0.43, 24),
      indicatorLip: buttonProfile([
        [0.52, 0.015],
        [0.46, 0.075],
        [0.39, 0.025],
      ]),
      labels: createLabels(),
    }),
    [],
  )

  useEffect(
    () => () => Object.values(geometry).forEach((item) => item.dispose()),
    [geometry],
  )

  return (
    <group name="speaker-rear-details">
      {[-18.5, -4].map((x, index) => (
        <group
          key={x}
          position={[x, 0, 0]}
          name={index ? 'bluetooth-button' : 'link-button'}
        >
          <mesh position={[0, 0, 0.02]}>
            <primitive object={geometry.buttonWell} attach="geometry" />
            <meshStandardMaterial color="#0d1012" roughness={0.9} />
          </mesh>
          <mesh>
            <primitive object={geometry.buttonLip} attach="geometry" />
            <meshStandardMaterial
              color={gray ? '#74797c' : '#313639'}
              roughness={0.63}
            />
          </mesh>
          <mesh castShadow receiveShadow>
            <primitive object={geometry.buttonFace} attach="geometry" />
            <meshStandardMaterial
              color={BODY_COLORS[bodyColor].shell}
              roughness={0.64}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0, 0.025]} name="rear-button-labels">
        <primitive object={geometry.labels} attach="geometry" />
        <meshStandardMaterial
          color={gray ? '#666d70' : '#50575b'}
          roughness={0.95}
        />
      </mesh>
      <group position={[7, 0, 0]} name="rear-status-indicator">
        <mesh position={[0, 0, 0.02]}>
          <primitive object={geometry.indicatorWell} attach="geometry" />
          <meshStandardMaterial color="#090d0f" roughness={0.4} />
        </mesh>
        <mesh>
          <primitive object={geometry.indicatorLip} attach="geometry" />
          <meshStandardMaterial
            color={gray ? '#727a7d' : '#3b4245'}
            roughness={0.55}
          />
        </mesh>
      </group>
      <group position={[18.5, 0, 0]} name="usb-c-port">
        <mesh position={[0, 0, 0.02]}>
          <primitive object={geometry.socketWell} attach="geometry" />
          <meshStandardMaterial color="#07090b" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <primitive object={geometry.socketRim} attach="geometry" />
          <meshStandardMaterial
            color={gray ? '#6b7275' : '#202629'}
            roughness={0.55}
          />
        </mesh>
        <mesh position={[0, 0, 0.065]}>
          <primitive object={geometry.socketLip} attach="geometry" />
          <meshStandardMaterial
            color="#52595d"
            roughness={0.43}
            metalness={0.6}
          />
        </mesh>
        <mesh position={[0, 0, 0.08]}>
          <primitive object={geometry.socketTongue} attach="geometry" />
          <meshStandardMaterial
            color="#777b7a"
            roughness={0.52}
            metalness={0.25}
          />
        </mesh>
      </group>
    </group>
  )
}
