type Props = {
  model: 's' | 'm'
  style?: 'original' | '1' | '2' | '3'
  generatedHalo?: boolean
  className?: string
}

export function PanelIcon({
  model,
  style = 'original',
  generatedHalo = false,
  className,
}: Props) {
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
      {(tall ? [38, 61] : [50]).map((y, index) => {
        const perforated = tall ? style === '3' && index === 0 : style === '2'
        const slotted = !tall && style === '3'
        const halo = generatedHalo || (style === '1' && index === 0)
        const twinContours = tall && style === '2'
        return (
          <g key={index}>
            {perforated ? (
              Array.from({ length: 9 }, (_, row) => row - 4).flatMap((row) =>
                Array.from({ length: 9 }, (_, column) => column - 4)
                  .filter(
                    (column) =>
                      Math.hypot(column * 2.7, row * 2.7) <= radius - 0.8,
                  )
                  .map((column) => (
                    <circle
                      key={`${row}:${column}`}
                      cx={35 + column * 2.7}
                      cy={y + row * 2.7}
                      r="0.85"
                      fill="currentColor"
                    />
                  )),
              )
            ) : slotted ? (
              [-9, -6, -3, 0, 3, 6, 9].map((offset) => {
                const halfWidth = Math.sqrt(11.5 ** 2 - offset ** 2)
                return (
                  <path
                    key={offset}
                    d={`M${35 - halfWidth} ${y + offset}H33.8M36.2 ${y + offset}H${35 + halfWidth}`}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                )
              })
            ) : (
              <>
                <circle
                  cx="35"
                  cy={y}
                  r={halo ? radius - 1.2 : radius}
                  fill="currentColor"
                  opacity=".8"
                />
                {halo && (
                  <circle
                    cx="35"
                    cy={y}
                    r={radius + 1.5}
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                )}
                {twinContours && (
                  <path
                    d={`M${35 - radius - 1.7} ${y + 1}a${radius + 1.7} ${radius + 1.7} 0 0 1 ${2 * (radius + 1.7)} 0`}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                )}
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
