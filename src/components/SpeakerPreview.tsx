import { Component, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { SpeakerRearDetails } from './SpeakerRearDetails'
import {
  BODY_COLORS,
  BODY_GRILLE_COLORS,
  normalizeBodyGrilleColor,
  type BodyColor,
  type BodyGrilleColor,
} from '@/lib/design'
import type { MaterialGeometry } from '@/lib/multicolor-geometry'
import type { PatternMaterial } from '@/lib/multicolor-settings'
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
  Matrix4,
  LinearMipmapLinearFilter,
  PerspectiveCamera,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  Spherical,
  SRGBColorSpace,
  Vector3,
} from 'three'

export interface SpeakerPreviewProps {
  /** Owned by the designer; the preview never mutates or disposes this mesh. */
  geometry: BufferGeometry | null
  error?: string | null
  model: 's' | 'm'
  bodyColor: BodyColor
  bodyGrilleColor: BodyGrilleColor
  style: 'original' | 'custom'
  panelColor: string
  materialParts?: MaterialGeometry[] | null
  materials?: PatternMaterial[]
  knobColor: string
  knobGeometry: BufferGeometry | null
  powerButtonColor: string
  powerButtonGeometry: BufferGeometry | null
  knobStyle?: string
  relief?: number
  view?: 'perspective' | 'front'
  assembly?: 'assembled' | 'panel' | 'exploded' | 'knob'
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
  color: 'var(--stage-muted)',
  fontSize: 14,
  lineHeight: 1.6,
}

function PreviewFallback({ message }: { message?: string }) {
  return (
    <div role="status" style={fallbackStyle}>
      <span
        style={{ fontSize: 28, color: 'var(--accent-ink)' }}
        aria-hidden="true"
      >
        ◌
      </span>
      <strong style={{ color: 'var(--foreground)', fontWeight: 500 }}>
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
function createGrilleTexture(
  width: number,
  height: number,
  color: BodyGrilleColor,
) {
  const size = 64
  const rgb = Number.parseInt(BODY_GRILLE_COLORS[color].value.slice(1), 16)
  const red = (rgb >> 16) & 255
  const green = (rgb >> 8) & 255
  const blue = rgb & 255
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 8)
      const holeX = ((x + (row % 2) * 4) % 8) - 3.5
      const holeY = (y % 8) - 3.5
      const distance = Math.sqrt(holeX * holeX + holeY * holeY)
      const hole = distance < 2.3
      const highlight = distance < 3.1 && holeY < 0 ? 25 : 0
      const offset = (y * size + x) * 4
      // Only the woven strands change color; the openings remain dark.
      data[offset] = hole ? 15 : Math.min(255, red + highlight)
      data[offset + 1] = hole ? 17 : Math.min(255, green + highlight)
      data[offset + 2] = hole ? 18 : Math.min(255, blue + highlight)
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
  bodyColor,
  bodyGrilleColor,
}: {
  width: number
  height: number
  model: 's' | 'm'
  bodyColor: BodyColor
  bodyGrilleColor: BodyGrilleColor
}) {
  const colors = BODY_COLORS[bodyColor]
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
    () => createGrilleTexture(width, grilleHeight, bodyGrilleColor),
    [width, grilleHeight, bodyGrilleColor],
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
          color={colors.shell}
          roughness={0.56}
          metalness={0.05}
        />
      </mesh>
      <mesh position={[0, (faceTop - height / 2) / 2, -0.04]} receiveShadow>
        <planeGeometry args={[width - 3, grilleHeight]} />
        <meshStandardMaterial map={grille} roughness={0.93} metalness={0.08} />
      </mesh>
      {/* The rear face includes the shell offset and 0.65 mm bevel. */}
      <group
        position={[0, -height / 2 + 22, -depth - 1.57]}
        rotation={[0, Math.PI, 0]}
      >
        <SpeakerRearDetails bodyColor={bodyColor} />
      </group>
      {model === 's' &&
        [-1, 1].map((side) => (
          <group
            key={side}
            position={[side * (width / 2 - 0.85), -13, -depth / 2 - 1]}
            rotation={[0, (side * Math.PI) / 2, 0]}
          >
            <mesh geometry={radiatorRim}>
              <meshStandardMaterial color="#141719" roughness={0.85} />
            </mesh>
            <mesh geometry={radiatorFace} position={[0, 0, 0.45]}>
              <meshStandardMaterial color={colors.radiator} roughness={0.78} />
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
  knobColor,
  knobGeometry,
  powerButtonColor,
  powerButtonGeometry,
  model,
}: {
  knobColor: string
  knobGeometry: BufferGeometry | null
  powerButtonColor: string
  powerButtonGeometry: BufferGeometry | null
  model: 's' | 'm'
}) {
  const top = model === 's' ? 29.5 : 70
  const depth = model === 's' ? -6 : -8.5
  // All source panels place the control openings 28.5 mm from the centerline.
  const controlOffset = 28.5

  return (
    <>
      {powerButtonGeometry && (
        <group
          position={[-controlOffset, top, depth]}
          rotation={[-Math.PI / 4, 0, 0]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[9.4, 9.4, 1.1, 48]} />
            <meshStandardMaterial color="#1f2224" roughness={0.45} />
          </mesh>
          {/* The print-ready source rests on its face. Flip its actuator into
              the deck, keeping the original Ø17.9 mm cap just above it. */}
          <mesh
            position={[0, 0, 0.7]}
            rotation={[Math.PI, 0, 0]}
            castShadow
            receiveShadow
          >
            <primitive
              object={powerButtonGeometry}
              attach="geometry"
              dispose={null}
            />
            <meshStandardMaterial color={powerButtonColor} roughness={0.44} />
          </mesh>
          {/* Factory indicator overlay; the original printable cap is plain. */}
          <mesh position={[0, 2.5, 0.75]}>
            <planeGeometry args={[0.9, 4]} />
            <meshStandardMaterial
              color="#f5f5e9"
              emissive="#f5f5e9"
              emissiveIntensity={0.7}
            />
          </mesh>
        </group>
      )}
      {knobGeometry && (
        <group
          position={[controlOffset, top, depth]}
          rotation={[-Math.PI / 4, 0, 0]}
        >
          <mesh
            position={[0, 0, -(knobGeometry.userData.knob?.mountHeight ?? 5)]}
            castShadow
            receiveShadow
          >
            <primitive object={knobGeometry} attach="geometry" dispose={null} />
            <meshStandardMaterial
              color={knobColor}
              roughness={0.42}
              metalness={0.04}
            />
          </mesh>
        </group>
      )}
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
  assembly: 'assembled' | 'panel' | 'exploded' | 'knob'
}) {
  const { camera, size, invalidate, gl } = useThree()
  const orbit = useRef<{ target: Vector3; update: () => void } | null>(null)
  const previousFraming = useRef<{
    view: typeof view
    resetKey: number
    assembly: typeof assembly
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
      previousFraming.current.resetKey !== resetKey ||
      (previousFraming.current.assembly === 'knob') !== (assembly === 'knob')
    const direction = resetView
      ? view === 'front'
        ? new Vector3(0, 0, 1)
        : new Vector3(0.63, assembly === 'knob' ? 0.85 : 0.27, 1).normalize()
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
    previousFraming.current = { view, resetKey, assembly }
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

  useEffect(() => {
    const surface = gl.domElement.closest<HTMLElement>(
      '[data-preview-controls]',
    )
    if (!surface) return
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.target !== surface ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '=',
          '-',
        ].includes(event.key)
      )
        return
      event.preventDefault()
      const target = orbit.current?.target ?? new Vector3()
      const spherical = new Spherical().setFromVector3(
        camera.position.clone().sub(target),
      )
      if (event.key === 'ArrowLeft') spherical.theta -= 0.12
      if (event.key === 'ArrowRight') spherical.theta += 0.12
      if (event.key === 'ArrowUp') spherical.phi -= 0.12
      if (event.key === 'ArrowDown') spherical.phi += 0.12
      if (event.key === '+' || event.key === '=') spherical.radius *= 0.9
      if (event.key === '-') spherical.radius /= 0.9
      spherical.phi = Math.max(0.18, Math.min(Math.PI * 0.78, spherical.phi))
      spherical.radius = Math.max(
        extent * 0.7,
        Math.min(extent * 6, spherical.radius),
      )
      camera.position
        .copy(target)
        .add(new Vector3().setFromSpherical(spherical))
      camera.lookAt(target)
      orbit.current?.update()
      invalidate()
    }
    surface.addEventListener('keydown', handleKey)
    return () => surface.removeEventListener('keydown', handleKey)
  }, [camera, extent, gl, invalidate])

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
  bodyColor,
  bodyGrilleColor,
  panelColor,
  materialParts,
  materials,
  knobColor,
  knobGeometry,
  powerButtonColor,
  powerButtonGeometry,
  view,
  assembly,
  resetKey,
}: {
  geometry: BufferGeometry
  model: 's' | 'm'
  bodyColor: BodyColor
  bodyGrilleColor: BodyGrilleColor
  panelColor: string
  materialParts?: MaterialGeometry[] | null
  materials?: PatternMaterial[]
  knobColor: string
  knobGeometry: BufferGeometry | null
  powerButtonColor: string
  powerButtonGeometry: BufferGeometry | null
  view: 'perspective' | 'front'
  assembly: 'assembled' | 'panel' | 'exploded' | 'knob'
  resetKey: number
}) {
  const height = model === 's' ? 130.97 : 224.97
  const width = 84.97
  const offset = assembly === 'exploded' ? 32 : 0
  const bounds = useMemo(() => {
    if (assembly === 'knob' && knobGeometry) {
      knobGeometry.computeBoundingBox()
      return knobGeometry
        .boundingBox!.clone()
        .applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2))
    }
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
          new Vector3(-width / 2, -height / 2 - 1.65, -bodyDepth - 2),
          new Vector3(width / 2, controlsTop, 10 + offset),
        ),
      )
    }
    return result
  }, [geometry, knobGeometry, model, assembly, offset, height])

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
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#ffffff"
          scale={[180, 220, 1]}
          position={[-100, 65, -180]}
          target={[0, 0, 0]}
        />
      </Environment>
      {assembly !== 'panel' && assembly !== 'knob' && (
        <SpeakerBody
          width={width}
          height={height}
          model={model}
          bodyColor={bodyColor}
          bodyGrilleColor={bodyGrilleColor}
        />
      )}
      {assembly !== 'knob' && (
        <group position={[0, 0, offset]}>
          {materialParts ? (
            materialParts.map((part) => (
              <mesh key={part.materialId} castShadow receiveShadow>
                <primitive
                  object={part.previewGeometry ?? part.geometry}
                  attach="geometry"
                  dispose={null}
                />
                <meshStandardMaterial
                  color={
                    part.materialId === 'base'
                      ? panelColor
                      : (materials?.find(
                          (material) => material.id === part.materialId,
                        )?.color ?? panelColor)
                  }
                  roughness={0.43}
                  metalness={0.025}
                  envMapIntensity={0.5}
                />
              </mesh>
            ))
          ) : (
            <mesh castShadow receiveShadow>
              <primitive object={geometry} attach="geometry" dispose={null} />
              <meshStandardMaterial
                color={panelColor}
                roughness={0.43}
                metalness={0.025}
                envMapIntensity={0.5}
              />
            </mesh>
          )}
          {assembly !== 'panel' && (
            <SpeakerControls
              knobColor={knobColor}
              knobGeometry={knobGeometry}
              powerButtonColor={powerButtonColor}
              powerButtonGeometry={powerButtonGeometry}
              model={model}
            />
          )}
        </group>
      )}
      {assembly === 'knob' && knobGeometry && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <primitive object={knobGeometry} attach="geometry" dispose={null} />
          <meshStandardMaterial
            color={knobColor}
            roughness={0.42}
            metalness={0.04}
            envMapIntensity={0.5}
          />
        </mesh>
      )}
      <ContactShadows
        key={`${geometry.uuid}:${knobGeometry?.uuid}:${powerButtonGeometry?.uuid}:${assembly}`}
        position={[0, bounds.min.y - 0.45, assembly === 'knob' ? 0 : -12]}
        opacity={0.32}
        scale={assembly === 'knob' ? 70 : height * 2.5}
        blur={2.7}
        far={bounds.max.y - bounds.min.y + 12}
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
  bodyColor,
  bodyGrilleColor,
  style,
  panelColor,
  materialParts,
  materials,
  knobColor,
  knobGeometry,
  powerButtonColor,
  powerButtonGeometry,
  knobStyle,
  view = 'perspective',
  assembly = 'assembled',
  resetKey = 0,
  className,
  onReady,
  onError,
}: SpeakerPreviewProps) {
  const grilleColor = normalizeBodyGrilleColor(bodyColor, bodyGrilleColor)
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
      data-body-grille-color={grilleColor}
      data-knob-style={knobStyle}
      data-knob-ready={!!knobGeometry}
      data-power-button-ready={!!powerButtonGeometry}
      data-power-button-color={powerButtonColor}
      data-material-count={materialParts?.length ?? 0}
      role="img"
      data-preview-controls
      tabIndex={0}
      aria-description="Use arrow keys to rotate, plus to zoom in, and minus to zoom out. Use the Reset camera button to restore the view."
      aria-label={`Interactive 3D preview of your CMF Speaker ${model.toUpperCase()} ${assembly === 'knob' ? 'volume knob' : assembly === 'panel' ? 'front panel' : `with ${bodyColor} body, ${grilleColor} grille, custom front panel, volume knob and power button`}. Drag to rotate and scroll to zoom.`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
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
                bodyColor={bodyColor}
                bodyGrilleColor={grilleColor}
                panelColor={panelColor}
                materialParts={materialParts}
                materials={materials}
                knobColor={knobColor}
                knobGeometry={knobGeometry}
                powerButtonColor={powerButtonColor}
                powerButtonGeometry={powerButtonGeometry}
                view={view}
                assembly={assembly}
                resetKey={resetKey}
              />
            )}
          </Canvas>
        )}
      </PreviewBoundary>
      <span className="camera-keyboard-hint" aria-hidden="true">
        Arrow keys: rotate · + / −: zoom
      </span>
      {loading && !error && (
        <div
          role="status"
          style={{
            ...fallbackStyle,
            pointerEvents: 'none',
            fontFamily: 'monospace',
            fontSize: 14,
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
