import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Environment,
  Html,
  Lightformer,
  Line,
  OrbitControls,
} from '@react-three/drei'
import {
  Box3,
  DataTexture,
  LinearFilter,
  MOUSE,
  PerspectiveCamera,
  RGBAFormat,
  TOUCH,
  Vector3,
} from 'three'
import { SpeakerModel } from './SpeakerPreview'
import { normalizeBodyGrilleColor } from '@/lib/design'
import type { DesignVariation } from '@/lib/design-variations'
import { useDesignGeometry } from '@/lib/use-design-geometry'

export type VariationStatus = 'loading' | 'ready' | 'error'
type DesignMeshes = ReturnType<typeof useDesignGeometry>
const ARMY_VIEW = new Vector3(0.3, 1.5, 1).normalize()

interface Props {
  variations: DesignVariation[]
  selectedId: string
  onInspect: (id: string) => void
  onCandidateStatus: (id: string, status: VariationStatus) => void
  onCandidateFallback: (id: string) => boolean
  originalMeshes: DesignMeshes
  resetKey: number
  focusKey?: number
  onError?: (error: Error) => void
}

function geometryStatus(
  meshes: DesignMeshes,
  multicolor: boolean,
): VariationStatus {
  if (
    meshes.error ||
    meshes.knobError ||
    meshes.powerButtonError ||
    meshes.multicolorError
  )
    return 'error'
  return meshes.geometry &&
    meshes.knobGeometry &&
    meshes.powerButtonGeometry &&
    (!multicolor || meshes.materialParts)
    ? 'ready'
    : 'loading'
}

function ExplorerFallback({ onError }: { onError?: (error: Error) => void }) {
  useEffect(() => {
    // R3F always mounts fallback children inside its canvas. Report only the
    // unsupported-canvas case; renderer failures reach ExplorerBoundary.
    if (
      typeof HTMLCanvasElement === 'undefined' ||
      typeof HTMLCanvasElement.prototype.getContext !== 'function'
    )
      onError?.(
        new Error('This browser does not support the variation canvas.'),
      )
  }, [onError])
  return (
    <div className="preview-loading" role="status">
      <strong>The variation preview could not load.</strong>
      <span>Cancel to return to your design, then try again.</span>
    </div>
  )
}

class ExplorerBoundary extends Component<
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
    return this.state.failed ? <ExplorerFallback /> : this.props.children
  }
}

/** An isolated draft scene: inspection never writes to the designer's config. */
export function VariationExplorer(props: Props) {
  return (
    <div
      className="variation-canvas"
      data-variation-controls
      tabIndex={0}
      aria-label="Interactive speaker variations"
      aria-description="Drag to pan, scroll or pinch to zoom, and right-drag to rotate. Arrow keys pan, plus and minus zoom. Select a numbered speaker to inspect it, then use the Use variation button to apply it."
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        touchAction: 'none',
      }}
    >
      <ExplorerBoundary onError={props.onError}>
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [400, 1800, 1400], fov: 38, near: 1, far: 30000 }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          }}
          fallback={<ExplorerFallback onError={props.onError} />}
          style={{ cursor: 'grab' }}
        >
          <VariationScene {...props} />
        </Canvas>
      </ExplorerBoundary>
      <span
        className="variation-camera-hint camera-keyboard-hint"
        aria-hidden="true"
      >
        Arrow keys: pan · + / −: zoom
      </span>
    </div>
  )
}

function VariationScene({
  variations,
  selectedId,
  onInspect,
  onCandidateStatus,
  onCandidateFallback,
  originalMeshes,
  resetKey,
  focusKey = 0,
}: Props) {
  const [statuses, setStatuses] = useState<Record<string, VariationStatus>>({})
  const [admitted, setAdmitted] = useState(1)
  const callback = useRef(onCandidateStatus)
  useEffect(() => {
    callback.current = onCandidateStatus
  }, [onCandidateStatus])
  const reportStatus = useCallback((id: string, status: VariationStatus) => {
    setStatuses((previous) =>
      previous[id] === status ? previous : { ...previous, [id]: status },
    )
    callback.current(id, status)
  }, [])
  const candidates = variations.filter((variation) => variation.ring !== 0)
  const original = variations.find((variation) => variation.ring === 0)
  const originalStatus = original
    ? geometryStatus(originalMeshes, original.design.multicolor.enabled)
    : 'error'

  // The shared multicolor worker intentionally has only one waiting slot.
  // Admit another draft only after the complete current assembly has settled.
  useEffect(() => {
    if (admitted >= candidates.length) return
    const active = candidates[admitted - 1]
    if (active && statuses[active.id] && statuses[active.id] !== 'loading')
      setAdmitted((count) => count + 1)
  }, [admitted, candidates, statuses])

  useEffect(() => {
    if (original) reportStatus(original.id, originalStatus)
  }, [original, originalStatus, reportStatus])

  const [bounds] = useState(() => {
    const box = new Box3()
    for (const variation of variations) {
      const [x, y, z] = variation.position
      const height = variation.design.model === 's' ? 130.97 : 224.97
      box.expandByPoint(new Vector3(x - 85, y - height / 2 - 2, z - 100))
      box.expandByPoint(new Vector3(x + 85, y + height / 2 + 90, z + 100))
    }
    return box
  })
  const selected =
    variations.find((variation) => variation.id === selectedId) ?? original

  return (
    <>
      <ambientLight intensity={0.25} />
      <hemisphereLight args={['#fffdf8', '#9b9c9a', 0.7]} />
      <directionalLight
        position={[-1000, 1600, 1800]}
        intensity={1.7}
        color="#fff8ef"
      />
      <directionalLight
        position={[1500, 600, 1000]}
        intensity={0.65}
        color="#f3f6ff"
      />
      <Environment resolution={64} frames={1}>
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
          intensity={1.2}
          color="#ffffff"
          scale={[180, 220, 1]}
          position={[150, 65, 100]}
          target={[0, 0, 0]}
        />
      </Environment>
      <FormationFloor variations={variations} />
      {original && (
        <Candidate
          variation={original}
          index={0}
          meshes={originalMeshes}
          status={originalStatus}
          selected={selectedId === original.id}
          onInspect={onInspect}
        />
      )}
      {candidates.map((variation, index) =>
        index < admitted ? (
          <GeneratedCandidate
            key={variation.id}
            variation={variation}
            index={index + 1}
            selected={selectedId === variation.id}
            onInspect={onInspect}
            onStatus={reportStatus}
            onFallback={onCandidateFallback}
          />
        ) : (
          <Candidate
            key={variation.id}
            variation={variation}
            index={index + 1}
            status="loading"
            selected={false}
            onInspect={onInspect}
          />
        ),
      )}
      <ExplorerCamera
        bounds={bounds}
        selected={selected}
        resetKey={resetKey}
        focusKey={focusKey}
      />
    </>
  )
}

function FormationFloor({ variations }: { variations: DesignVariation[] }) {
  const height = variations[0].design.model === 's' ? 130.97 : 224.97
  const floorY = -height / 2 - 1.65
  // Share one soft contact texture across the formation. Geometry arrivals do
  // not trigger repeated shadow passes over every detailed printable mesh.
  const shadow = useMemo(() => {
    const size = 64
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const radius = Math.hypot(
          ((x + 0.5) / size) * 2 - 1,
          ((y + 0.5) / size) * 2 - 1,
        )
        data[(y * size + x) * 4 + 3] = Math.round(
          Math.pow(Math.max(0, 1 - radius), 1.5) * 160,
        )
      }
    }
    const texture = new DataTexture(data, size, size, RGBAFormat)
    texture.minFilter = texture.magFilter = LinearFilter
    texture.needsUpdate = true
    return texture
  }, [])
  useEffect(() => () => shadow.dispose(), [shadow])
  return (
    <group>
      <gridHelper
        args={[1600, 20, '#85897d', '#85897d']}
        position={[0, floorY, 0]}
        material-transparent
        material-opacity={0.14}
        material-depthWrite={false}
      />
      {variations.map(({ id, position }) => (
        <mesh
          key={id}
          position={[position[0], floorY + 0.2, position[2] - 28]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[150, 130]} />
          <meshBasicMaterial
            map={shadow}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function GeneratedCandidate({
  variation,
  onStatus,
  onFallback,
  ...props
}: {
  variation: DesignVariation
  index: number
  selected: boolean
  onInspect: (id: string) => void
  onStatus: (id: string, status: VariationStatus) => void
  onFallback: (id: string) => boolean
}) {
  // These hooks own their geometry and cancel/dispose it when the explorer closes.
  const meshes = useDesignGeometry(variation.design, 0)
  const status = geometryStatus(meshes, variation.design.multicolor.enabled)
  useEffect(() => {
    // Keep an otherwise useful palette/knob proposal when a color boundary
    // cannot partition its new panel safely. The parent replaces the draft,
    // so the rendered geometry and eventually applied config still agree.
    if (
      status === 'error' &&
      meshes.multicolorError &&
      onFallback(variation.id)
    )
      return
    onStatus(variation.id, status)
  }, [variation.id, status, meshes.multicolorError, onStatus, onFallback])
  return (
    <Candidate
      {...props}
      variation={variation}
      status={status}
      meshes={meshes}
    />
  )
}

function Candidate({
  variation,
  index,
  selected,
  status,
  meshes,
  onInspect,
}: {
  variation: DesignVariation
  index: number
  selected: boolean
  status: VariationStatus
  meshes?: DesignMeshes
  onInspect: (id: string) => void
}) {
  const { design } = variation
  const height = design.model === 's' ? 130.97 : 224.97
  const ready = status === 'ready' && meshes?.geometry
  const failureMessage =
    meshes?.error ||
    meshes?.knobError ||
    meshes?.powerButtonError ||
    meshes?.multicolorError
  const inspect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (ready && event.delta < 5) onInspect(variation.id)
  }
  const panelBounds = meshes?.geometry?.boundingBox
  const left = Math.min(-55, panelBounds?.min.x ?? -55) - 12
  const right = Math.max(55, panelBounds?.max.x ?? 55) + 12
  const floorY = -height / 2 - 1.65
  const markerText = index === 0 ? 'Original' : String(index).padStart(2, '0')
  return (
    <group position={variation.position}>
      <group onClick={inspect}>
        {ready ? (
          <SpeakerModel
            geometry={meshes.geometry!}
            model={design.model}
            bodyColor={design.bodyColor}
            bodyGrilleColor={normalizeBodyGrilleColor(
              design.bodyColor,
              design.bodyGrilleColor,
            )}
            panelColor={design.panelColor}
            materialParts={
              design.multicolor.enabled ? meshes.materialParts : null
            }
            materials={design.multicolor.materials}
            knobColor={design.knobColor}
            knobGeometry={meshes.knobGeometry}
            powerButtonColor={design.powerButtonColor}
            powerButtonGeometry={meshes.powerButtonGeometry}
          />
        ) : (
          <mesh position={[0, 0, -30]}>
            <boxGeometry args={[85, height, 58]} />
            <meshBasicMaterial
              color={status === 'error' ? '#b67767' : '#a7a29a'}
              wireframe
              transparent
              opacity={0.2}
            />
          </mesh>
        )}
      </group>
      {selected && (
        <Line
          points={[
            [left, floorY + 0.4, -92],
            [right, floorY + 0.4, -92],
            [right, floorY + 0.4, 40],
            [left, floorY + 0.4, 40],
            [left, floorY + 0.4, -92],
          ]}
          color="#e85f2a"
          lineWidth={1.5}
          transparent
          opacity={0.8}
        />
      )}
      <Html position={[0, floorY + 2, 70]} center zIndexRange={[15, 0]}>
        <button
          type="button"
          className={`variation-marker${selected ? ' is-selected' : ''}${index === 0 ? ' is-original' : ''}`}
          data-variation-id={variation.id}
          data-status={status}
          aria-label={`Inspect ${variation.label}${status === 'loading' ? ' (building)' : status === 'error' ? ' (unavailable)' : ''}`}
          aria-pressed={selected}
          disabled={!ready}
          title={`${variation.label}${status === 'loading' ? ' · Building geometry' : status === 'error' ? ` · ${failureMessage || 'Could not generate'}` : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            if (ready) onInspect(variation.id)
          }}
        >
          <span className="variation-marker-label">{markerText}</span>
          {status !== 'ready' && (
            <span className="variation-marker-status" aria-hidden="true">
              {status === 'error' ? '!' : '·'}
            </span>
          )}
        </button>
      </Html>
    </group>
  )
}

function ExplorerCamera({
  bounds,
  selected,
  resetKey,
  focusKey,
}: {
  bounds: Box3
  selected?: DesignVariation
  resetKey: number
  focusKey: number
}) {
  const { camera, size, invalidate, gl } = useThree()
  const orbit = useRef<{ target: Vector3; update: () => void } | null>(null)
  const previousSelection = useRef(selected?.id)
  const previousFocus = useRef(focusKey)
  const maxDistance = useRef(15000)

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    const center = bounds.getCenter(new Vector3())
    const aspect = Math.max(1, size.width) / Math.max(1, size.height)
    const tangent = Math.tan((camera.fov * Math.PI) / 360)
    const right = new Vector3().crossVectors(camera.up, ARMY_VIEW).normalize()
    const up = new Vector3().crossVectors(ARMY_VIEW, right).normalize()
    const point = new Vector3()
    let distance = 1
    // Fit every corner in the elevated camera's frame, including the rows'
    // depth and the labels in front of their feet.
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          point.set(x, y, z).sub(center)
          distance = Math.max(
            distance,
            point.dot(ARMY_VIEW) +
              Math.max(
                (Math.abs(point.dot(right)) * 1.13) / (tangent * aspect),
                (Math.abs(point.dot(up)) * 1.13) / tangent,
              ),
          )
        }
      }
    }
    maxDistance.current = distance * 3
    camera.position.copy(center).addScaledVector(ARMY_VIEW, distance)
    camera.lookAt(center)
    camera.far = Math.max(30000, distance * 4)
    camera.updateProjectionMatrix()
    orbit.current?.target.copy(center)
    orbit.current?.update()
    invalidate()
  }, [bounds, camera, size.width, size.height, resetKey, invalidate])

  useEffect(() => {
    if (!selected || !(camera instanceof PerspectiveCamera)) return
    const focus = previousFocus.current !== focusKey
    if (!focus && previousSelection.current === selected.id) return
    previousFocus.current = focusKey
    previousSelection.current = selected.id
    const target = new Vector3(...selected.position)
    target.y += 18
    if (focus) {
      const height = selected.design.model === 's' ? 255 : 350
      const aspect = Math.max(1, size.width) / Math.max(1, size.height)
      const tangent = Math.tan((camera.fov * Math.PI) / 360)
      const distance =
        Math.max(height / tangent, 190 / (tangent * aspect)) * 0.65
      camera.position.copy(target).addScaledVector(ARMY_VIEW, distance)
    } else {
      camera.position.add(
        target.clone().sub(orbit.current?.target ?? new Vector3()),
      )
    }
    camera.lookAt(target)
    orbit.current?.target.copy(target)
    orbit.current?.update()
    invalidate()
  }, [camera, selected, focusKey, invalidate, size.width, size.height])

  useEffect(() => {
    const surface = gl.domElement.closest<HTMLElement>(
      '[data-variation-controls]',
    )
    if (!surface) return
    const onKeyDown = (event: KeyboardEvent) => {
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
      const offset = camera.position.clone().sub(target)
      if (event.key === '+' || event.key === '=' || event.key === '-') {
        const distance = Math.max(
          180,
          Math.min(
            maxDistance.current,
            offset.length() * (event.key === '-' ? 1.18 : 1 / 1.18),
          ),
        )
        camera.position.copy(target).add(offset.setLength(distance))
      } else {
        const step = offset.length() * 0.055
        const movement = new Vector3()
        if (event.key === 'ArrowLeft') movement.x -= step
        if (event.key === 'ArrowRight') movement.x += step
        if (event.key === 'ArrowUp') movement.y += step
        if (event.key === 'ArrowDown') movement.y -= step
        movement.applyQuaternion(camera.quaternion)
        target.add(movement)
        camera.position.add(movement)
      }
      orbit.current?.update()
      invalidate()
    }
    surface.addEventListener('keydown', onKeyDown)
    return () => surface.removeEventListener('keydown', onKeyDown)
  }, [camera, gl, invalidate])

  return (
    <OrbitControls
      ref={(instance) => {
        orbit.current = instance
      }}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning
      panSpeed={0.85}
      zoomSpeed={0.8}
      rotateSpeed={0.5}
      minDistance={180}
      maxDistance={30000}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI / 2 - 0.08}
      mouseButtons={{
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.ROTATE,
      }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
    />
  )
}
