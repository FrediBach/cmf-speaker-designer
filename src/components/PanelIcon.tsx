import type { PanelStyle } from '@/lib/panels'

type Props = {
  model: 's' | 'm'
  style?: PanelStyle
  className?: string
}

export function PanelIcon({ model, style = 'original', className }: Props) {
  const tall = model === 'm'
  const h = tall ? 70 : 54
  const radius = tall ? 9 : 12
  return (
    <svg
      viewBox="0 0 70 84"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="15"
        y={(84 - h) / 2}
        width="40"
        height={h}
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d={`M15 ${(84 - h) / 2 + 11}h40M15 ${(84 - h) / 2 + 19}h40`}
        stroke="currentColor"
        strokeWidth="1.1"
      />
      {tall ? (
        <rect
          x="29"
          y={(84 - h) / 2 + 4}
          width="13"
          height="4"
          rx="2"
          fill="currentColor"
          opacity=".55"
        />
      ) : (
        <circle
          cx="44"
          cy={(84 - h) / 2 + 6}
          r="3"
          fill="currentColor"
          opacity=".55"
        />
      )}
      <circle
        cx="23"
        cy={(84 - h) / 2 + 15}
        r="2.5"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d={`M46 ${(84 - h) / 2 + 13}v4`}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {(tall ? [38, 61] : [50]).map((y) => (
        <g key={y}>
          {style === 'custom' ? (
            <>
              <circle
                cx="35"
                cy={y}
                r={radius}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
              <path
                d={`M${35 - radius + 4} ${y - 3}h${2 * radius - 8}M${35 - radius + 4} ${y + 3}h${2 * radius - 8}M33 ${y - 5}v4M37 ${y + 1}v4`}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </>
          ) : (
            <circle
              cx="35"
              cy={y}
              r={radius}
              fill="currentColor"
              opacity=".8"
            />
          )}
        </g>
      ))}
    </svg>
  )
}
