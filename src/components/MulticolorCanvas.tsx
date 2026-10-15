import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import type { BufferGeometry } from 'three'
import { Minus, Plus, Maximize2, Move } from 'lucide-react'
import type {
  MulticolorSettings,
  PatternElement,
} from '@/lib/multicolor-settings'
import { getElementContours } from '@/lib/multicolor-patterns'

interface Props {
  value: MulticolorSettings
  panelColor: string
  geometry?: BufferGeometry | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (value: MulticolorSettings) => void
  onDuplicate: () => void
  onDelete: () => void
  onBeginTransaction?: () => void
  onEndTransaction?: () => void
}

type Point = { x: number; y: number }
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Gesture = {
  pointerId: number
  mode: 'move' | 'resize' | 'rotate' | 'vertex' | 'pan'
  initial: MulticolorSettings
  element?: PatternElement
  vertex?: number
  start: Point
  pan: Point
}

function CanvasHandle({
  x,
  y,
  radius,
  kind,
  label,
  onPointerDown,
}: {
  x: number
  y: number
  radius: number
  kind: 'resize' | 'rotate' | 'vertex'
  label: string
  onPointerDown: (event: PointerEvent<SVGGElement>) => void
}) {
  return (
    <g
      className={`multicolor-handle-target ${kind}`}
      onPointerDown={onPointerDown}
    >
      <title>{label}</title>
      <circle
        cx={x}
        cy={y}
        r={radius * 1.7}
        className="multicolor-handle-hit"
      />
      {kind === 'resize' ? (
        <rect
          x={x - radius}
          y={y - radius}
          width={radius * 2}
          height={radius * 2}
          rx={radius / 3}
          className={`multicolor-handle ${kind}`}
          pointerEvents="none"
        />
      ) : (
        <circle
          cx={x}
          cy={y}
          r={radius}
          className={`multicolor-handle ${kind}`}
          pointerEvents="none"
        />
      )}
    </g>
  )
}

function pathFor(element: PatternElement): string {
  return getElementContours(element)
    .map(
      (points) =>
        points
          .map(([x, y], index) => `${index ? 'L' : 'M'}${x},${-y}`)
          .join(' ') + 'Z',
    )
    .join(' ')
}

function elementBounds(element: PatternElement): Bounds {
  const points = getElementContours(element).flat()
  return points.reduce<Bounds>(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      maxX: Math.max(bounds.maxX, x),
      minY: Math.min(bounds.minY, y),
      maxY: Math.max(bounds.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

function resized(element: PatternElement, scale: number): PatternElement {
  switch (element.kind) {
    case 'stripe':
      return {
        ...element,
        width: element.width * scale,
        height: element.height * scale,
      }
    case 'circle':
      return {
        ...element,
        radius: element.radius * scale,
        innerRadius: element.innerRadius * scale,
      }
    case 'cross':
      return {
        ...element,
        left: element.left * scale,
        right: element.right * scale,
        top: element.top * scale,
        bottom: element.bottom * scale,
        horizontalThickness: element.horizontalThickness * scale,
        verticalThickness: element.verticalThickness * scale,
      }
    case 'polygon':
      return {
        ...element,
        points: element.points.map(([x, y]) => [x * scale, y * scale]),
      }
  }
}

/** Every projected triangle uses the same winding, so the nonzero fill is their union. */
function projectedPanel(geometry?: BufferGeometry | null) {
  if (!geometry) return null
  const position = geometry.getAttribute('position')
  if (!position) return null
  const index = geometry.getIndex()
  const count = index?.count ?? position.count
  const segments: string[] = []
  const bounds: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }
  const decimal = (value: number) => Number(value.toFixed(4))
  for (let offset = 0; offset < count; offset += 3) {
    const vertices = [0, 1, 2].map((corner) => {
      const vertex = index ? index.getX(offset + corner) : offset + corner
      return [position.getX(vertex), position.getY(vertex)]
    })
    const [a, b, c] = vertices
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
    if (Math.abs(area) < 1e-8) continue
    if (area < 0) vertices.reverse()
    for (const [x, y] of vertices) {
      bounds.minX = Math.min(bounds.minX, x)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxY = Math.max(bounds.maxY, y)
    }
    segments.push(
      vertices
        .map(
          ([x, y], corner) =>
            `${corner ? 'L' : 'M'}${decimal(x)},${decimal(-y)}`,
        )
        .join('') + 'Z',
    )
  }
  return segments.length ? { path: segments.join(''), bounds } : null
}

export function MulticolorCanvas({
  value,
  panelColor,
  geometry,
  selectedId,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  onBeginTransaction,
  onEndTransaction,
}: Props) {
  const id = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const latestValue = useRef(value)
  useLayoutEffect(() => {
    latestValue.current = value
  }, [value])
  useEffect(
    () => () => {
      if (gesture.current && gesture.current.mode !== 'pan')
        onEndTransaction?.()
      gesture.current = null
    },
    [onEndTransaction],
  )
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [panMode, setPanMode] = useState(false)
  const [snap, setSnap] = useState(true)
  const projected = useMemo(() => projectedPanel(geometry), [geometry])
  const paths = useMemo(
    () =>
      new Map(value.elements.map((element) => [element.id, pathFor(element)])),
    [value.elements],
  )
  const selected = value.elements.find((element) => element.id === selectedId)
  const bounds = selected ? elementBounds(selected) : null
  const frame = value.frame
  const left = Math.min(
    projected?.bounds.minX ?? Infinity,
    frame.centerX - frame.width / 2,
  )
  const right = Math.max(
    projected?.bounds.maxX ?? -Infinity,
    frame.centerX + frame.width / 2,
  )
  const bottom = Math.min(
    projected?.bounds.minY ?? Infinity,
    frame.centerY - frame.height / 2,
  )
  const top = Math.max(
    projected?.bounds.maxY ?? -Infinity,
    frame.centerY + frame.height / 2,
  )
  const sceneWidth = right - left + 20
  const sceneHeight = top - bottom + 20
  const viewWidth = sceneWidth / zoom
  const viewHeight = sceneHeight / zoom
  const viewX = (left + right) / 2 - viewWidth / 2 + pan.x
  const viewY = -(bottom + top) / 2 - viewHeight / 2 - pan.y
  const handleSize = Math.max(viewWidth, viewHeight) * 0.017
  const materialColor = (materialId: string) =>
    materialId === 'base'
      ? panelColor
      : (value.materials.find((material) => material.id === materialId)
          ?.color ?? panelColor)

  const pointAt = (clientX: number, clientY: number): Point => {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const point = new DOMPoint(clientX, clientY).matrixTransform(
      matrix.inverse(),
    )
    return { x: point.x, y: -point.y }
  }
  const start = (
    event: PointerEvent<SVGElement>,
    mode: Gesture['mode'],
    element?: PatternElement,
    vertex?: number,
  ) => {
    if (event.button !== 0 && event.button !== 1) return
    if (gesture.current) return
    event.preventDefault()
    event.stopPropagation()
    // A focused numeric draft owns a separate history step. Commit it before
    // capturing the drag baseline; the pointer handler came from the old render.
    flushSync(() => {
      if (document.activeElement instanceof HTMLInputElement)
        document.activeElement.blur()
    })
    svgRef.current?.focus()
    const initial = latestValue.current
    const currentElement = element
      ? initial.elements.find((candidate) => candidate.id === element.id)
      : undefined
    if (element && !currentElement) return
    if (currentElement) onSelect(currentElement.id)
    const actualMode =
      panMode || event.button === 1 || event.shiftKey ? 'pan' : mode
    gesture.current = {
      pointerId: event.pointerId,
      mode: actualMode,
      initial,
      element: currentElement,
      vertex,
      start: pointAt(event.clientX, event.clientY),
      pan: { ...pan },
    }
    svgRef.current?.setPointerCapture(event.pointerId)
    if (actualMode !== 'pan') onBeginTransaction?.()
  }
  const finish = (cancel = false) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (cancel) {
      if (current.mode === 'pan') setPan(current.pan)
      else onChange(current.initial)
    }
    if (svgRef.current?.hasPointerCapture(current.pointerId))
      svgRef.current.releasePointerCapture(current.pointerId)
    if (current.mode !== 'pan') onEndTransaction?.()
  }
  const changeElement = (next: PatternElement, initial = value) =>
    onChange({
      ...initial,
      elements: initial.elements.map((element) =>
        element.id === next.id ? next : element,
      ),
    })

  return (
    <div className="multicolor-canvas-wrap">
      <div className="multicolor-canvas-toolbar">
        <span>
          Front view <small>mm</small>
        </span>
        <div>
          <button
            type="button"
            title="Pan canvas (or hold Shift)"
            aria-label="Pan canvas"
            aria-pressed={panMode}
            onClick={() => setPanMode(!panMode)}
          >
            <Move size={15} />
          </button>
          <button
            type="button"
            aria-label="Zoom out artwork"
            onClick={() => setZoom(Math.max(0.5, zoom / 1.3))}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            aria-label="Zoom in artwork"
            onClick={() => setZoom(Math.min(8, zoom * 1.3))}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            aria-label="Fit canvas view"
            onClick={() => {
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className={`multicolor-canvas${panMode ? ' is-panning' : ''}`}
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
        role="application"
        aria-label="Multicolor artwork editor. Select shapes and use arrow keys to move. Shift moves ten millimeters. Escape cancels a drag."
        tabIndex={0}
        onPointerDown={(event) => {
          if (panMode || event.shiftKey || event.button === 1)
            start(event, 'pan')
          else onSelect(null)
        }}
        onPointerMove={(event) => {
          const current = gesture.current
          if (!current || current.pointerId !== event.pointerId) return
          const point = pointAt(event.clientX, event.clientY)
          if (current.mode === 'pan') {
            setPan({
              x: pan.x + current.start.x - point.x,
              y: pan.y + current.start.y - point.y,
            })
            return
          }
          const element = current.element
          if (!element) return
          const quantize = (number: number) =>
            snap && !event.altKey
              ? Math.round(number * 2) / 2
              : Math.round(number * 100) / 100
          if (current.mode === 'move')
            changeElement(
              {
                ...element,
                x: quantize(element.x + point.x - current.start.x),
                y: quantize(element.y + point.y - current.start.y),
              },
              current.initial,
            )
          else if (current.mode === 'resize') {
            const initialDistance = Math.hypot(
              current.start.x - element.x,
              current.start.y - element.y,
            )
            const distance = Math.hypot(
              point.x - element.x,
              point.y - element.y,
            )
            changeElement(
              resized(
                element,
                Math.max(0.02, distance / Math.max(initialDistance, 0.001)),
              ),
              current.initial,
            )
          } else if (current.mode === 'rotate') {
            const delta =
              ((Math.atan2(point.y - element.y, point.x - element.x) -
                Math.atan2(
                  current.start.y - element.y,
                  current.start.x - element.x,
                )) *
                180) /
              Math.PI
            const angle = element.rotation + delta
            changeElement(
              {
                ...element,
                rotation:
                  snap && !event.altKey ? Math.round(angle / 5) * 5 : angle,
              },
              current.initial,
            )
          } else if (current.mode === 'vertex' && element.kind === 'polygon') {
            const angle = (-element.rotation * Math.PI) / 180
            const dx = point.x - element.x
            const dy = point.y - element.y
            changeElement(
              {
                ...element,
                points: element.points.map((vertex, index) =>
                  index === current.vertex
                    ? [
                        quantize(dx * Math.cos(angle) - dy * Math.sin(angle)),
                        quantize(dx * Math.sin(angle) + dy * Math.cos(angle)),
                      ]
                    : vertex,
                ),
              },
              current.initial,
            )
          }
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (gesture.current) finish(true)
            else onSelect(null)
            return
          }
          if (!selected || event.target !== event.currentTarget) return
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            onDelete()
            return
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'd'
          ) {
            event.preventDefault()
            onDuplicate()
            return
          }
          const distance = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
          const directions: Record<string, Point> = {
            ArrowLeft: { x: -distance, y: 0 },
            ArrowRight: { x: distance, y: 0 },
            ArrowUp: { x: 0, y: distance },
            ArrowDown: { x: 0, y: -distance },
          }
          const direction = directions[event.key]
          if (direction) {
            event.preventDefault()
            changeElement({
              ...selected,
              x: selected.x + direction.x,
              y: selected.y + direction.y,
            })
          }
        }}
      >
        <defs>
          <pattern
            id={`${id}-grid`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M10 0H0V10"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.15"
            />
          </pattern>
          <clipPath id={`${id}-panel`}>
            {projected ? (
              <path d={projected.path} clipRule="nonzero" />
            ) : (
              <rect
                x={frame.centerX - frame.width / 2}
                y={-frame.centerY - frame.height / 2}
                width={frame.width}
                height={frame.height}
              />
            )}
          </clipPath>
          <clipPath id={`${id}-frame`}>
            <rect
              x={frame.centerX - frame.width / 2}
              y={-frame.centerY - frame.height / 2}
              width={frame.width}
              height={frame.height}
            />
          </clipPath>
        </defs>
        <rect
          x={viewX}
          y={viewY}
          width={viewWidth}
          height={viewHeight}
          fill={`url(#${id}-grid)`}
          className="multicolor-grid"
        />
        <g clipPath={`url(#${id}-panel)`}>
          <rect
            x={left}
            y={-top}
            width={right - left}
            height={top - bottom}
            fill={panelColor}
          />
          <g clipPath={`url(#${id}-frame)`}>
            {value.elements
              .filter((element) => element.visible)
              .map((element) => (
                <path
                  key={element.id}
                  d={paths.get(element.id)}
                  fill={materialColor(element.materialId)}
                  fillRule="evenodd"
                  className="multicolor-shape"
                  onPointerDown={(event) => start(event, 'move', element)}
                >
                  <title>{element.name}</title>
                </path>
              ))}
          </g>
        </g>
        <rect
          x={frame.centerX - frame.width / 2}
          y={-frame.centerY - frame.height / 2}
          width={frame.width}
          height={frame.height}
          fill="none"
          className="multicolor-frame"
          pointerEvents="none"
        />
        {selected && bounds && Number.isFinite(bounds.minX) && (
          <g className="multicolor-selection">
            <path
              d={paths.get(selected.id)}
              fill="none"
              pointerEvents="stroke"
              onPointerDown={(event) => start(event, 'move', selected)}
            />
            <rect
              x={bounds.minX}
              y={-bounds.maxY}
              width={bounds.maxX - bounds.minX}
              height={bounds.maxY - bounds.minY}
              fill="none"
              strokeDasharray="2 2"
              pointerEvents="none"
            />
            <line
              x1={selected.x}
              y1={-bounds.maxY}
              x2={selected.x}
              y2={-bounds.maxY - handleSize * 4}
              pointerEvents="none"
            />
            <CanvasHandle
              x={selected.x}
              y={-bounds.maxY - handleSize * 4}
              radius={handleSize}
              kind="rotate"
              label={`Rotate ${selected.name}`}
              onPointerDown={(event) => start(event, 'rotate', selected)}
            />
            {[
              [bounds.minX, bounds.minY],
              [bounds.maxX, bounds.minY],
              [bounds.minX, bounds.maxY],
              [bounds.maxX, bounds.maxY],
            ].map(([x, y], index) => (
              <CanvasHandle
                key={index}
                x={x}
                y={-y}
                radius={handleSize}
                kind="resize"
                label={`Resize ${selected.name}`}
                onPointerDown={(event) => start(event, 'resize', selected)}
              />
            ))}
            {selected.kind === 'polygon' &&
              selected.points.map(([x, y], index) => {
                const angle = (selected.rotation * Math.PI) / 180
                return (
                  <CanvasHandle
                    key={index}
                    x={selected.x + x * Math.cos(angle) - y * Math.sin(angle)}
                    y={
                      -(selected.y + x * Math.sin(angle) + y * Math.cos(angle))
                    }
                    radius={handleSize}
                    kind="vertex"
                    label={`Move vertex ${index + 1}`}
                    onPointerDown={(event) =>
                      start(event, 'vertex', selected, index)
                    }
                  />
                )
              })}
          </g>
        )}
      </svg>
      <div className="multicolor-canvas-caption">
        <label>
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => setSnap(event.target.checked)}
          />{' '}
          Snap 0.5 mm / 5°
        </label>
        <span>
          {selected
            ? `${selected.x.toFixed(1)}, ${selected.y.toFixed(1)} mm`
            : `${Math.round(zoom * 100)}%`}
        </span>
      </div>
      <p className="multicolor-hint">
        {geometry
          ? 'Openings stay empty. The dashed rectangle is the artwork frame.'
          : 'Panel geometry is loading; the frame is shown for placement.'}{' '}
        Drag to move, corners to resize. Hold Shift to pan or Alt to bypass
        snapping.
      </p>
    </div>
  )
}
