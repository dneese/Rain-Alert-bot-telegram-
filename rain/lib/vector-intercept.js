// Vector-based rain-cell interception math (pure, no I/O).
// Given a rain cell's location + intensity and the cloud-motion vector,
// decide whether/when the rain will reach the user.
//
// Stage 1: cheap bounding-box filter (~30 x 39 km) => early return.
// Stage 2: haversine distance + initial bearing.
// Stage 3: dynamic interception sector (accounts for the cloud's width).
// Then: intensity filter and ETA projection (time until the rain line crosses
// the user), clamped to a sane window.

/**
 * @typedef {Object} GeoPoint
 * @property {number} lat
 * @property {number} lon
 */

/**
 * @typedef {Object} RainCell
 * @property {number} lat
 * @property {number} lon
 * @property {number} intensityMmh  // precipitation rate, mm/h
 */

/**
 * @typedef {Object} CloudMotion
 * @property {number} speedKmH     // km/h
 * @property {number} directionDeg // heading the cloud is moving TOWARD (0..360)
 */

/**
 * @typedef {Object} InterceptionResult
 * @property {boolean} willRainHit
 * @property {number} distanceKm
 * @property {number} etaMinutes
 * @property {number} fromDeg        // bearing from the user toward the cell (= where the rain comes FROM)
 * @property {number} cardinalIndex  // 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
 * @property {number} intensityMmh
 */

const CARDINALS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/**
 * Great-circle distance between two points (km).
 * @param {GeoPoint} a
 * @param {GeoPoint} b
 * @returns {number}
 */
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Initial bearing FROM point A TO point B (degrees 0..360).
 * @param {GeoPoint} a
 * @param {GeoPoint} b
 * @returns {number}
 */
export function initialBearingDeg(a, b) {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad);
  const x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lon - a.lon) * toRad);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Smallest absolute angular difference between two headings (0..180).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function angularDiffDeg(a, b) {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * 8-way cardinal index for a bearing: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW.
 * @param {number} deg
 * @returns {number}
 */
export function cardinalIndex(deg) {
  const d = ((deg % 360) + 360) % 360;
  return Math.round(d / 45) % 8;
}

/**
 * Cardinal token (matching the i18n keys dir_n..dir_nw) for an index.
 * @param {number} index
 * @returns {string}
 */
export function cardinalName(index) {
  return CARDINALS[((index % 8) + 8) % 8] || 'n';
}

/**
 * Convert a meteorological wind (direction it blows FROM) into the cloud-motion
 * vector (heading TOWARD).
 * @param {number|null} windFromDeg
 * @param {number|null} windKph
 * @returns {CloudMotion|null}
 */
export function cloudMotionFromWind(windFromDeg, windKph) {
  if (windFromDeg == null || !windKph || windKph <= 0) return null;
  const from = ((windFromDeg % 360) + 360) % 360;
  return { speedKmH: windKph, directionDeg: (from + 180) % 360 };
}

/**
 * Tolerated deviation of the cloud heading from the line to the user:
 * cloud width visible as an angle at distance + a base fudge for wind-model error.
 * @param {number} cloudRadiusKm
 * @param {number} distanceKm
 * @param {number} [baseMarginDeg]
 * @returns {number}
 */
export function interceptionMarginDeg(cloudRadiusKm, distanceKm, baseMarginDeg = 15) {
  const ratio = distanceKm > 0 ? Math.min(cloudRadiusKm, distanceKm) / distanceKm : 1;
  const spread = Math.asin(ratio) * (180 / Math.PI);
  return baseMarginDeg + spread;
}

const DEFAULT_OPTS = {
  cloudRadiusKm: 2,
  baseMarginDeg: 15,
  minIntensityMmh: 0.5,
  minEtaMin: 3,
  maxEtaMin: 60,
  bboxDeg: 0.35,
};

/**
 * Decide whether a rain cell will reach the user.
 * @param {{user: GeoPoint, cell: RainCell, motion: CloudMotion, opts?: Object}} args
 * @returns {InterceptionResult|null}
 */
export function interceptRainCell({ user, cell, motion, opts = {} }) {
  if (!user || !cell || !motion) return null;
  const o = { ...DEFAULT_OPTS, ...opts };

  // Stage 1: bounding-box filter (cheap, no trigonometry).
  if (Math.abs(cell.lat - user.lat) > o.bboxDeg || Math.abs(cell.lon - user.lon) > o.bboxDeg) {
    return null;
  }

  // Intensity filter: ignore micro-drizzle.
  const intensity = typeof cell.intensityMmh === 'number' ? cell.intensityMmh : 0;
  if (intensity < o.minIntensityMmh) return null;

  // No drift => nothing to intercept.
  if (!motion.speedKmH || motion.speedKmH <= 0) return null;

  // Stage 2: distance + bearing from the cell toward the user.
  const distanceKm = haversineKm(cell, user);
  const cellToUser = initialBearingDeg(cell, user);

  // Stage 3: dynamic sector (cloud width + fudge).
  const ang = angularDiffDeg(motion.directionDeg, cellToUser);
  const margin = interceptionMarginDeg(o.cloudRadiusKm, distanceKm, o.baseMarginDeg);
  if (ang > margin) return null;

  // ETA: projection of the displacement onto the user line.
  const etaMin = (distanceKm * Math.cos((ang * Math.PI) / 180) / Math.max(motion.speedKmH, 1)) * 60;
  if (etaMin < o.minEtaMin || etaMin > o.maxEtaMin) return null;

  const fromDeg = (cellToUser + 180) % 360;
  return {
    willRainHit: true,
    distanceKm: Math.round(distanceKm * 10) / 10,
    etaMinutes: Math.round(etaMin),
    fromDeg,
    cardinalIndex: cardinalIndex(fromDeg),
    intensityMmh: intensity,
  };
}