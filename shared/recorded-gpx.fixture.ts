/**
 * GPX enregistrés synthétiques pour les tests, en attendant un export réel d'AllTrails
 * (ALLTRAILS-AUDIT.md §6). Trace vers le nord : 0,001° de latitude ≈ 111,2 m.
 */
export type FixturePoint = { lat: number; lng: number; ele?: number; time?: string };

export function northboundPoints(
  count: number,
  { start = '2026-07-01T06:00:00Z', stepSeconds = 60, lat = 45, lng = 6, ele = 1000, climbM = 10 } = {},
): FixturePoint[] {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({
    lat: lat + i * 0.001,
    lng,
    ele: ele + i * climbM,
    time: new Date(startMs + i * stepSeconds * 1000).toISOString().replace('.000Z', 'Z'),
  }));
}

function trkpt({ lat, lng, ele, time }: FixturePoint): string {
  return `<trkpt lat="${lat}" lon="${lng}">${ele === undefined ? '' : `<ele>${ele}</ele>`}${
    time === undefined ? '' : `<time>${time}</time>`
  }</trkpt>`;
}

export function recordedGpx(
  segments: FixturePoint[][],
  { name = 'Sortie au col', creator = 'AllTrails.com' } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${creator}">
  <metadata><name><![CDATA[${name}]]></name></metadata>
  <trk><name>Piste</name>${segments
    .map((points) => `<trkseg>${points.map(trkpt).join('')}</trkseg>`)
    .join('')}</trk>
</gpx>`;
}
