import type { SpeakerModel } from './panels'
import { normalizeSvgCutout, type SvgCutout } from './svg-cutout'

export type HandleCutout = 'none' | 'circle' | 'slot' | 'svg'
export interface HandleSettings {
  mode: 'original' | 'custom'
  height: number
  width: number
  cornerRadius: number
  cutout: HandleCutout
  svgCutout: SvgCutout | null
  holeCount: number
  holeWidth: number
  holeHeight: number
  holeGap: number
  offsetX: number
  offsetY: number
}
export type HandleNumericKey = Exclude<
  keyof HandleSettings,
  'mode' | 'cutout' | 'svgCutout'
>
export type HandleLimits = Record<
  HandleNumericKey,
  { min: number; max: number }
>

export const HANDLE_THICKNESS = 4
export const HANDLE_MIN_WEB = 3
export const HANDLE_SHOULDER_HEIGHT = 4
export const DEFAULT_HANDLE_SETTINGS: HandleSettings = {
  mode: 'original',
  height: 24,
  width: 85,
  cornerRadius: 3,
  cutout: 'slot',
  svgCutout: null,
  holeCount: 1,
  holeWidth: 40,
  holeHeight: 12,
  holeGap: 6,
  offsetX: 0,
  offsetY: 0,
}

export function getDefaultHandleSettings(model: SpeakerModel): HandleSettings {
  return { ...DEFAULT_HANDLE_SETTINGS, height: model === 's' ? 24 : 27 }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Fit all openings into a conservative rectangle inside the rounded silhouette.
 * It leaves >=3 mm material around openings and between adjacent openings.
 * The bottom 4 mm is a shoulder joining the original-width attachment collar.
 */
export function normalizeHandleSettings(
  model: SpeakerModel,
  input: Partial<HandleSettings> = {},
): HandleSettings {
  const defaults = getDefaultHandleSettings(model)
  const height = clamp(finite(input.height, defaults.height), 16, 70)
  const width = clamp(finite(input.width, defaults.width), 60, 110)
  const cornerRadius = clamp(
    finite(input.cornerRadius, defaults.cornerRadius),
    0,
    Math.min(16, (width - 30) / 2, (height - 4) / 2),
  )
  const cutout =
    input.cutout === 'none' ||
    input.cutout === 'circle' ||
    input.cutout === 'slot' ||
    input.cutout === 'svg'
      ? input.cutout
      : defaults.cutout
  const svgCutout = normalizeSvgCutout(input.svgCutout)
  const aspectRatio = svgCutout?.aspectRatio ?? 1
  const holeCount =
    cutout === 'svg'
      ? 1
      : clamp(Math.round(finite(input.holeCount, defaults.holeCount)), 1, 3)
  const availableWidth = width - 2 * (cornerRadius + HANDLE_MIN_WEB)
  const availableHeight = height - HANDLE_SHOULDER_HEIGHT - 2 * HANDLE_MIN_WEB
  const maxGap =
    holeCount > 1
      ? Math.min(20, (availableWidth - holeCount * 6) / (holeCount - 1))
      : 20
  const holeGap = clamp(finite(input.holeGap, defaults.holeGap), 3, maxGap)
  const maxWidth = Math.min(
    64,
    (availableWidth - (holeCount - 1) * holeGap) / holeCount,
    cutout === 'circle'
      ? availableHeight
      : cutout === 'svg'
        ? availableHeight * aspectRatio
        : 64,
  )
  const holeWidth = clamp(
    finite(input.holeWidth, defaults.holeWidth),
    cutout === 'svg' ? Math.min(6, maxWidth) : 6,
    maxWidth,
  )
  const holeHeight =
    cutout === 'circle'
      ? holeWidth
      : cutout === 'svg'
        ? holeWidth / aspectRatio
        : clamp(
            finite(input.holeHeight, defaults.holeHeight),
            6,
            Math.min(30, availableHeight, holeWidth),
          )
  const groupWidth = holeCount * holeWidth + (holeCount - 1) * holeGap
  const xRoom = Math.min(30, Math.max(0, (availableWidth - groupWidth) / 2))
  const yRoom = Math.min(24, Math.max(0, (availableHeight - holeHeight) / 2))
  return {
    mode: input.mode === 'custom' ? 'custom' : 'original',
    height,
    width,
    cornerRadius,
    cutout,
    svgCutout,
    holeCount,
    holeWidth,
    holeHeight,
    holeGap,
    offsetX: clamp(finite(input.offsetX, defaults.offsetX), -xRoom, xRoom),
    offsetY: clamp(finite(input.offsetY, defaults.offsetY), -yRoom, yRoom),
  }
}

export function getHandleLimits(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
): HandleLimits {
  const settings = normalizeHandleSettings(model, input)
  const availableWidth =
    settings.width - 2 * (settings.cornerRadius + HANDLE_MIN_WEB)
  const availableHeight =
    settings.height - HANDLE_SHOULDER_HEIGHT - 2 * HANDLE_MIN_WEB
  const groupWidth =
    settings.holeCount * settings.holeWidth +
    (settings.holeCount - 1) * settings.holeGap
  const xRoom = Math.min(30, Math.max(0, (availableWidth - groupWidth) / 2))
  const yRoom = Math.min(
    24,
    Math.max(0, (availableHeight - settings.holeHeight) / 2),
  )
  const maxWidth = Math.min(
    64,
    (availableWidth - (settings.holeCount - 1) * settings.holeGap) /
      settings.holeCount,
    settings.cutout === 'circle'
      ? availableHeight
      : settings.cutout === 'svg'
        ? availableHeight * (settings.svgCutout?.aspectRatio ?? 1)
        : 64,
  )
  return {
    height: { min: 16, max: 70 },
    width: { min: 60, max: 110 },
    cornerRadius: {
      min: 0,
      max: Math.min(16, (settings.width - 30) / 2, (settings.height - 4) / 2),
    },
    holeCount: { min: 1, max: settings.cutout === 'svg' ? 1 : 3 },
    holeWidth: {
      min: settings.cutout === 'svg' ? Math.min(6, maxWidth) : 6,
      max: maxWidth,
    },
    holeHeight:
      settings.cutout === 'circle' || settings.cutout === 'svg'
        ? { min: settings.holeHeight, max: settings.holeHeight }
        : { min: 6, max: Math.min(30, availableHeight, settings.holeWidth) },
    holeGap: {
      min: 3,
      max:
        settings.holeCount > 1
          ? Math.min(
              20,
              (availableWidth - settings.holeCount * 6) /
                (settings.holeCount - 1),
            )
          : 20,
    },
    offsetX: { min: -xRoom, max: xRoom },
    offsetY: { min: -yRoom, max: yRoom },
  }
}

/** Profile coordinates are relative to the join with the existing control deck. */
export function getHandleOutline(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
  baseWidth = 84.9715,
): [number, number][] {
  const settings = normalizeHandleSettings(model, input)
  const half = settings.width / 2
  const radius = settings.cornerRadius
  const top = settings.height
  const points: [number, number][] = [
    [-baseWidth / 2, -0.25],
    [baseWidth / 2, -0.25],
    [baseWidth / 2, 0],
    [half, HANDLE_SHOULDER_HEIGHT],
  ]
  if (radius > 0) {
    points.push([half, top - radius])
    for (const [cx, start] of [
      [half - radius, 0],
      [-half + radius, 90],
    ]) {
      for (let step = 1; step <= 16; step += 1) {
        const angle = ((start + (step * 90) / 16) * Math.PI) / 180
        points.push([
          cx + Math.cos(angle) * radius,
          top - radius + Math.sin(angle) * radius,
        ])
      }
      if (start === 0) points.push([-half + radius, top])
    }
  } else points.push([half, top], [-half, top])
  points.push([-half, HANDLE_SHOULDER_HEIGHT], [-baseWidth / 2, 0])
  return points
}

export function getHandleHoleCenters(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
) {
  const settings = normalizeHandleSettings(model, input)
  if (settings.cutout === 'none' || settings.cutout === 'svg') return []
  return Array.from({ length: settings.holeCount }, (_, index) => ({
    x:
      settings.offsetX +
      (index - (settings.holeCount - 1) / 2) *
        (settings.holeWidth + settings.holeGap),
    y: settings.height / 2 + HANDLE_SHOULDER_HEIGHT / 2 + settings.offsetY,
    width: settings.holeWidth,
    height:
      settings.cutout === 'circle' ? settings.holeWidth : settings.holeHeight,
  }))
}

/** SVG's downward Y axis is flipped into the handle's upward profile axis. */
export function getHandleSvgPaths(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
): SvgCutout['paths'] {
  const settings = normalizeHandleSettings(model, input)
  if (settings.cutout !== 'svg' || !settings.svgCutout) return []
  const centerY =
    settings.height / 2 + HANDLE_SHOULDER_HEIGHT / 2 + settings.offsetY
  return settings.svgCutout.paths.map((path) => ({
    fillRule: path.fillRule,
    contours: path.contours.map((contour) =>
      contour.map(([x, y]) => [
        settings.offsetX + x * settings.holeWidth,
        centerY - y * settings.holeHeight,
      ]),
    ),
  }))
}
