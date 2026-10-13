import { Component, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import {
  Box3,
  BufferGeometry,
  DataTexture,
  ExtrudeGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  PerspectiveCamera,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three'

export interface SpeakerPreviewProps {
  /** Owned by the designer; the preview never mutates or disposes this mesh. */
  geometry: BufferGeometry | null
  error?: string | null
  model: 's' | 'm'
  style: 'original' | '1' | '2' | '3'
  panelColor: string
  knobColor: string
  relief?: number
  view?: 'perspective' | 'front'
  assembly?: 'assembled' | 'panel' | 'exploded'
  resetKey?: number
  className?: string
  onReady?: () => void
  onError?: (error: Error) => void
}

const fallbackStyle = {
  position: 'absolute' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column' as const,
  gap: 12,
  padding: 32,
  textAlign: 'center' as const,
  color: '#656663',
  fontSize: 13,
  lineHeight: 1.6,
}

function PreviewFallback({ message }: { message?: string }) {
  return (
    <div role="status" style={fallbackStyle}>
      <span style={{ fontSize: 28, color: '#fe5b35' }} aria-hidden="true">
        ◌
      </span>
      <strong style={{ color: '#292a27', fontWeight: 500 }}>
        3D preview unavailable
      </strong>
      <span style={{ maxWidth: 290 }}>
        {message ||
          'Enable WebGL in your browser to see the interactive preview. You can still customize and download your panel.'}
      </span>
    </div>
  )
}

class PreviewBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  render() {
    return this.state.failed ? <PreviewFallback /> : this.props.children
  }
}

/** A repeating, locally generated textile texture: no external textures or HDR files. */
function createGrilleTexture(width: number, height: number) {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 8)
      const holeX = ((x + (row % 2) * 4) % 8) - 3.5
      const holeY = (y % 8) - 3.5
      const distance = Math.sqrt(holeX * holeX + holeY * holeY)
      const value = distance < 2.3 ? 15 : distance < 3.1 && holeY < 0 ? 69 : 44
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value + 2
      data[offset + 2] = value + 3
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(width / 8, height / 8)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function createRadiatorGeometry(
  width: number,
  height: number,
  thickness: number,
) {
  const radius = Math.min(width, height) / 2
  const left = -width / 2
  const right = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outline = new Shape()
  outline.moveTo(left + radius, bottom)
  outline.lineTo(right - radius, bottom)
  outline.quadraticCurveTo(right, bottom, right, bottom + radius)
  outline.lineTo(right, top - radius)
  outline.quadraticCurveTo(right, top, right - radius, top)
  outline.lineTo(left + radius, top)
  outline.quadraticCurveTo(left, top, left, top - radius)
  outline.lineTo(left, bottom + radius)
  outline.quadraticCurveTo(left, bottom, left + radius, bottom)
  outline.closePath()
  return new ExtrudeGeometry(outline, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  })
}

function SpeakerBody({
  width,
  height,
  model,
}: {
  width: number
  height: number
  model: 's' | 'm'
}) {
  const depth = model === 's' ? 55 : 64
  const faceTop = model === 's' ? 19 : 57
  const roofHeight = faceTop + (model === 's' ? 20 : 25)
  const geometry = useMemo(() => {
    const section = new Shape()
    section.moveTo(0, -height / 2 + 1)
    section.lineTo(depth, -height / 2 + 1)
    section.lineTo(depth, roofHeight)
    section.lineTo(model === 's' ? 21 : 26, roofHeight)
    section.lineTo(0, faceTop)
    section.closePath()
    const result = new ExtrudeGeometry(section, {
      depth: width - 3,
      bevelEnabled: true,
      bevelSize: 0.65,
      bevelThickness: 0.65,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 4,
    })
    result.rotateY(Math.PI / 2)
    result.translate(-(width - 3) / 2, 0, -0.9)
    return result
  }, [width, height, depth, model, faceTop, roofHeight])
  const grilleHeight = height / 2 + faceTop
  const grille = useMemo(
    () => createGrilleTexture(width, grilleHeight),
    [width, grilleHeight],
  )
  const radiatorHeight = Math.min(height - 72, 115)
  const radiatorRim = useMemo(
    () => createRadiatorGeometry(depth * 0.58, radiatorHeight, 0.45),
    [depth, radiatorHeight],
  )
  const radiatorFace = useMemo(
    () => createRadiatorGeometry(depth * 0.58 - 3, radiatorHeight - 3, 0.35),
    [depth, radiatorHeight],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => grille.dispose(), [grille])
  useEffect(() => () => radiatorRim.dispose(), [radiatorRim])
  useEffect(() => () => radiatorFace.dispose(), [radiatorFace])

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color="#272b2e"
          roughness={0.56}
          metalness={0.05}
        />
      </mesh>
      <mesh position={[0, (faceTop - height / 2) / 2, -0.04]} receiveShadow>
        <planeGeometry args={[width - 3, grilleHeight]} />
        <meshStandardMaterial map={grille} roughness={0.93} metalness={0.08} />
      </mesh>
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * (width / 2 - 0.85), -13, -depth / 2 - 1]}
          rotation={[0, (side * Math.PI) / 2, 0]}
        >
          <mesh geometry={radiatorRim}>
            <meshStandardMaterial color="#141719" roughness={0.85} />
          </mesh>
          <mesh geometry={radiatorFace} position={[0, 0, 0.45]}>
            <meshStandardMaterial color="#2b2f31" roughness={0.78} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((side) => (
        <RoundedBox
          key={side}
          args={[9, 2.5, 25]}
          radius={1}
          smoothness={3}
          position={[side * (width / 2 - 12), -height / 2 - 0.4, -depth / 2]}
        >
          <meshStandardMaterial color="#141618" roughness={0.95} />
        </RoundedBox>
      ))}
    </group>
  )
}

function SpeakerControls({
  panelColor,
  knobColor,
  model,
}: {
  panelColor: string
  knobColor: string
  model: 's' | 'm'
}) {
  const top = model === 's' ? 29.5 : 70
  const depth = model === 's' ? -6 : -8.5
  // All source panels place the control openings 28.5 mm from the centerline.
  const controlOffset = 28.5

  return (
    <>
      <group position={[-controlOffset, top, depth]} rotation={[Math.PI / 4, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[9.4, 9.4, 1.1, 48]} />
          <meshStandardMaterial color="#1f2224" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[8.85, 8.85, 0.8, 48]} />
          <meshStandardMaterial color={panelColor} roughness={0.44} />
        </mesh>
        <mesh position={[0, 0.75, -2.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.9, 4]} />
          <meshStandardMaterial
            color="#f5f5e9"
            emissive="#f5f5e9"
            emissiveIntensity={0.7}
          />
        </mesh>
      </group>
      <group
        position={[controlOffset, top + 1.3, depth + 1.3]}
        rotation={[Math.PI / 4, 0, 0]}
      >
        <mesh castShadow>
          <cylinderGeometry args={[8.1, 8.5, 4.3, 48]} />
          <meshStandardMaterial
            color={knobColor}
            roughness={0.4}
            metalness={0.06}
          />
        </mesh>
        <RoundedBox
          args={[3.4, 10.5, 13.4]}
          radius={1.1}
          smoothness={4}
          position={[0, 5.5, 0]}
          castShadow
        >
          <meshStandardMaterial
            color={knobColor}
            roughness={0.42}
            metalness={0.04}
          />
        </RoundedBox>
      </group>
    </>
  )
}

function CameraControls({
  bounds,
  view,
  resetKey,
  assembly,
}: {
  bounds: Box3
  view: 'perspective' | 'front'
  resetKey: number
  assembly: 'assembled' | 'panel' | 'exploded'
}) {
  const { camera, size, invalidate } = useThree()
  const orbit = useRef<{ target: Vector3; update: () => void } | null>(null)
  const previousFraming = useRef<{
    view: typeof view
    resetKey: number
  } | null>(null)
  const extent = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  )

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    const aspect = Math.max(size.width, 1) / Math.max(size.height, 1)
    const tangent = Math.tan((camera.fov * Math.PI) / 360)
    const target = bounds.getCenter(new Vector3())
    const resetView =
      !previousFraming.current ||
      previousFraming.current.view !== view ||
      previousFraming.current.resetKey !== resetKey
    const direction = resetView
      ? view === 'front'
        ? new Vector3(0, 0, 1)
        : new Vector3(0.63, 0.27, 1).normalize()
      : camera.position
          .clone()
          .sub(orbit.current?.target ?? target)
          .normalize()
    const right = new Vector3().crossVectors(camera.up, direction).normalize()
    const up = new Vector3().crossVectors(direction, right).normalize()
    let distance = 1
    const corner = new Vector3()
    // Fit all eight corners in camera space, including a taller or wider handle
    // and the assembled body's depth. Geometry edits preserve the orbit angle.
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          corner.set(x, y, z).sub(target)
          const depth = corner.dot(direction)
          distance = Math.max(
            distance,
            depth + (Math.abs(corner.dot(up)) * 1.25) / tangent,
            depth + (Math.abs(corner.dot(right)) * 1.25) / (tangent * aspect),
          )
        }
      }
    }
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.near = 1
    camera.far = 2400
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    if (orbit.current) {
      orbit.current.target.copy(target)
      orbit.current.update()
    }
    previousFraming.current = { view, resetKey }
    invalidate()
  }, [
    camera,
    size.width,
    size.height,
    bounds,
    view,
    resetKey,
    assembly,
    invalidate,
  ])

  return (
    <OrbitControls
      ref={(instance) => {
        orbit.current = instance
      }}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.65}
      zoomSpeed={0.65}
      minDistance={extent * 0.7}
      maxDistance={extent * 6}
      minPolarAngle={0.18}
      maxPolarAngle={Math.PI * 0.78}
    />
  )
}

function SpeakerScene({
  geometry,
  model,
  panelColor,
  knobColor,
  view,
  assembly,
  resetKey,
}: {
  geometry: BufferGeometry
  model: 's' | 'm'
  panelColor: string
  knobColor: string
  view: 'perspective' | 'front'
  assembly: 'assembled' | 'panel' | 'exploded'
  resetKey: number
}) {
  const height = model === 's' ? 130.97 : 224.97
  const width = 84.97
  const offset = assembly === 'exploded' ? 32 : 0
  const bounds = useMemo(() => {
    const result = geometry.boundingBox?.clone() ?? new Box3()
    if (result.isEmpty()) {
      const positions = geometry.getAttribute('position')
      const point = new Vector3()
      for (let index = 0; index < positions.count; index++) {
        result.expandByPoint(point.fromBufferAttribute(positions, index))
      }
    }
    result.translate(new Vector3(0, 0, offset))
    if (assembly !== 'panel') {
      const bodyDepth = model === 's' ? 55 : 64
      const controlsTop = model === 's' ? 45.5 : 86
      result.union(
        new Box3(
          new Vector3(-width / 2, -height / 2 - 1.65, -bodyDepth - 1.55),
          new Vector3(width / 2, controlsTop, 10 + offset),
        ),
      )
    }
    return result
  }, [geometry, model, assembly, offset, height])

  return (
    <>
      <ambientLight intensity={0.2} />
      <hemisphereLight args={['#fffdf8', '#9b9c9a', 0.55]} />
      <directionalLight
        position={[-100, 190, 170]}
        intensity={1.65}
        color="#fff8ef"
      />
      <directionalLight
        position={[130, 60, 90]}
        intensity={0.55}
        color="#f3f6ff"
      />
      <directionalLight position={[-80, 90, -130]} intensity={0.8} />
      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={2.2}
          color="#ffffff"
          scale={[200, 300, 1]}
          position={[-120, 100, 130]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1}
          color="#ffffff"
          scale={[130, 240, 1]}
          position={[160, 70, 30]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#ffffff"
          scale={[200, 180, 1]}
          position={[0, 200, -50]}
          target={[0, 0, 0]}
        />
      </Environment>
      {assembly !== 'panel' && (
        <SpeakerBody width={width} height={height} model={model} />
      )}
      <group position={[0, 0, offset]}>
        <mesh castShadow receiveShadow>
          <primitive object={geometry} attach="geometry" dispose={null} />
          <meshStandardMaterial
            color={panelColor}
            roughness={0.43}
            metalness={0.025}
            envMapIntensity={0.5}
          />
        </mesh>
        {assembly !== 'panel' && (
          <SpeakerControls
            panelColor={panelColor}
            knobColor={knobColor}
            model={model}
          />
        )}
      </group>
      <ContactShadows
        key={`${geometry.uuid}:${assembly}`}
        position={[0, -height / 2 - 2.1, -12]}
        opacity={0.32}
        scale={height * 2.5}
        blur={2.7}
        far={bounds.max.y + height / 2 + 12}
        resolution={512}
        color="#35332e"
        frames={1}
      />
      <CameraControls
        bounds={bounds}
        view={view}
        assembly={assembly}
        resetKey={resetKey}
      />
    </>
  )
}

export function SpeakerPreview({
  geometry,
  error,
  model,
  style,
  panelColor,
  knobColor,
  view = 'perspective',
  assembly = 'assembled',
  resetKey = 0,
  className,
  onReady,
  onError,
}: SpeakerPreviewProps) {
  const readyCallback = useRef(onReady)
  useEffect(() => {
    readyCallback.current = onReady
  }, [onReady])
  useEffect(() => {
    if (geometry) readyCallback.current?.()
  }, [geometry])
  const loading = !geometry

  return (
    <div
      className={className}
      data-panel-style={style}
      role="img"
      aria-label={`Interactive 3D preview of your CMF Speaker ${model.toUpperCase()} ${assembly === 'panel' ? 'front panel' : 'with custom front panel'}. Drag to rotate and scroll to zoom.`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 260,
        touchAction: 'none',
      }}
    >
      <PreviewBoundary onError={onError}>
        {error ? (
          <PreviewFallback message={error} />
        ) : (
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [150, 80, 260], fov: 34, near: 1, far: 2400 }}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference: 'high-performance',
            }}
            fallback={<PreviewFallback />}
            style={{
              opacity: loading ? 0.45 : 1,
              transition: 'opacity 180ms ease',
              cursor: 'grab',
            }}
          >
            {geometry && (
              <SpeakerScene
                geometry={geometry}
                model={model}
                panelColor={panelColor}
                knobColor={knobColor}
                view={view}
                assembly={assembly}
                resetKey={resetKey}
              />
            )}
          </Canvas>
        )}
      </PreviewBoundary>
      {loading && !error && (
        <div
          role="status"
          style={{
            ...fallbackStyle,
            pointerEvents: 'none',
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Loading your panel…
        </div>
      )}
    </div>
  )
}
