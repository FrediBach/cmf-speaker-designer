import type { KnobStyle } from '@/lib/knob-settings'

type Props = {
  style: KnobStyle
  className?: string
}

function RaisedGripIcon({ style }: { style: 'triangle' | 'arrow' | 'v' }) {
  const outline = {
    triangle: [
      [0, 11],
      [-11, -8],
      [11, -8],
    ],
    arrow: [
      [0, 12],
      [-11, 1],
      [-3.5, 1],
      [-3.5, -10],
      [3.5, -10],
      [3.5, 1],
      [11, 1],
    ],
    v: [
      [-11, 10],
      [0, -11],
      [11, 10],
      [6, 10],
      [0, -2],
      [-6, 10],
    ],
  }[style].map(([x, y]) => [36 + x * 1.7, 25 - y])
  const points = outline.map((point) => point.join(',')).join(' ')
  return (
    <>
      {outline.map(([x, y], index) => {
        const [nextX, nextY] = outline[(index + 1) % outline.length]
        return (
          <polygon
            key={index}
            points={`${x},${y} ${nextX},${nextY} ${nextX},${nextY + 11} ${x},${y + 11}`}
            fill="var(--card)"
          />
        )
      })}
      <polygon points={points} fill="var(--card)" />
      <polygon points={points} fill="currentColor" fillOpacity=".12" />
    </>
  )
}

export function KnobIcon({ style, className }: Props) {
  const fluted = style === 'fluted'
  const hex = style === 'hex'
  const shaped = style === 'triangle' || style === 'arrow' || style === 'v'
  const grip =
    style === 'bar' || style === 'cross' || style === 'text' || shaped

  return (
    <svg
      viewBox="0 0 72 66"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {hex ? (
        <>
          <path
            d="M15 25 36 15 57 25v19L36 54 15 44Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path d="m15 25 21 10 21-10M36 35v19" />
          <path d="M15 25v19m42-19v19" opacity=".5" />
          <ellipse cx="36" cy="25" rx="8" ry="4" />
        </>
      ) : (
        <>
          <path
            d={
              grip
                ? 'M13 39v7a23 11 0 0 0 46 0v-7'
                : 'M13 25v17a23 11 0 0 0 46 0V25'
            }
            fill="currentColor"
            fillOpacity=".12"
          />
          <ellipse
            cx="36"
            cy={grip ? 39 : 25}
            rx="23"
            ry="11"
            fill="currentColor"
            fillOpacity=".08"
          />
          {!grip && <ellipse cx="36" cy="25" rx="9" ry="4.8" />}
          {fluted &&
            [-19, -13, -6.5, 0, 6.5, 13, 19].map((x) => {
              const y = 25 + 11 * Math.sqrt(1 - (x / 23) ** 2)
              return (
                <path
                  key={x}
                  d={`M${36 + x} ${y + 1}v14`}
                  strokeWidth="2.2"
                  opacity=".7"
                />
              )
            })}
          {style === 'ring' && <path d="M27 25v4m18-4v4" opacity=".5" />}
          {shaped && <RaisedGripIcon style={style} />}
          {style === 'text' && (
            <>
              <path
                d="m24 33 9-21h7l10 21v10h-8l-2-5h-8l-2 5h-6Z"
                fill="var(--card)"
              />
              <path d="M24 33v10m6-10v10m12-10v10m8-10v10M32 28v10m8-10v10" />
              <path
                d="m24 33 9-21h7l10 21h-8l-2-5h-8l-2 5Zm10-10h4l-2-5Z"
                fill="var(--card)"
                fillRule="evenodd"
              />
              <path
                d="m24 33 9-21h7l10 21h-8l-2-5h-8l-2 5Zm10-10h4l-2-5Z"
                fill="currentColor"
                fillOpacity=".12"
                fillRule="evenodd"
              />
            </>
          )}
          {style === 'bar' && (
            <>
              <path d="m16 17 8-4 32 17v14l-8 4-32-17Z" fill="var(--card)" />
              <path
                d="m16 17 32 17 8-4M48 34v14"
                fill="currentColor"
                fillOpacity=".14"
              />
            </>
          )}
          {style === 'cross' && (
            <>
              <path
                d="m22 16 9 4 12-6 9 4-12 6 16 8v13l-9 4-16-8-12 6-9-4V30l12-6Z"
                fill="var(--card)"
              />
              <path
                d="m22 16 9 4 12-6 9 4-12 6 16 8-9 4-16-8-12 6-9-4 12-6Z"
                fill="currentColor"
                fillOpacity=".12"
              />
              <path d="M19 34v13m28-11v13m-16-8V28" />
            </>
          )}
        </>
      )}
    </svg>
  )
}
