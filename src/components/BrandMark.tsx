interface Props {
  /** rendered size in px, square */
  size?: number;
  /** dark facets, for white paper and the printed title block */
  onLight?: boolean;
  /** collapse to the silhouette — one ink, any surface */
  flat?: boolean;
  className?: string;
}

/**
 * The კუბი mark: an isometric cube drawn as three facets meeting at a corner.
 *
 * It is the app's own geometry — the same projection `lib/iso3d.ts` uses to
 * put a panel on screen — so the logo and the drawing are describing the same
 * solid.
 *
 * Solid facets rather than an outline, deliberately. The icon set is 2px
 * strokes on a 24 grid, which is right for controls and wrong here: strokes
 * grey out at small sizes, while filled shapes keep their silhouette. Below
 * about 20px the seams close up anyway, which is why the favicon is the flat
 * hexagon these three add up to.
 */
export function BrandMark({ size = 24, onLight = false, flat = false, className }: Props) {
  const facets = onLight
    ? ['#1e2228', '#3a424c', '#565f6b']
    : ['#e6e9ee', '#c3cad4', '#9aa4b1'];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {flat ? (
        <path d="M50,18 L80,35 L80,69 L50,86 L20,69 L20,35 Z" fill="currentColor" />
      ) : (
        <>
          <path d="M50,52 L50,18 L80,35 L80,69 Z" fill={facets[0]} />
          <path d="M50,52 L20,69 L20,35 L50,18 Z" fill={facets[1]} />
          <path d="M50,52 L80,69 L50,86 L20,69 Z" fill={facets[2]} />
        </>
      )}
    </svg>
  );
}
