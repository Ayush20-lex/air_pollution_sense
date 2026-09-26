/**
 * Places a Delhi reader already knows, for orienting on the plume map.
 *
 * The map draws an interpolated PM2.5 surface over the NCR with station pins
 * on top. Both are accurate and neither tells a reader where they are: the
 * basemap's own labels are deliberately desaturated so the plume reads over
 * them, and a station called "Sri Auribindo Marg" locates the instrument
 * rather than the city. Someone looking at a plume over east Delhi wants to
 * know it is over Akshardham and NH24, and nothing on the map said so.
 *
 * These are landmarks, not measurements. They carry no reading and never
 * will - putting an AQI on Qutub Minar would invent a station that is not
 * there, and the mesh's own pin is a few hundred metres away and real. They
 * are drawn quiet and behind everything else for the same reason.
 *
 * Nine of them, spread to cover the region rather than clustered on the
 * monuments: three in the centre, then the airport, the eastern corridor, the
 * southern ridge, and one each for Gurugram and Noida, which are the halves of
 * the NCR a Delhi-only map tends to leave anonymous.
 *
 * Coordinates are the published locations of each place, rounded to about a
 * hundred metres - enough to put the label on the right neighbourhood, which
 * is all a label is for.
 */
export type Landmark = {
  id: string;
  /** What a reader calls it, not its postal name. */
  label: string;
  lat: number;
  lon: number;
  /**
   * Which labels survive when the map is too tight to draw them all.
   *
   * Lower wins. Ordered by how much area a name orients rather than by how
   * famous it is: the airport, Cyber City and Sector 62 anchor the three
   * corners a Delhi-centred reader is least sure of, so they place first, and
   * the monuments in the centre - which sit within a few kilometres of each
   * other and collide first - come last.
   */
  rank: number;
};

export const LANDMARKS: Landmark[] = [
  { id: 'connaught', label: 'Connaught Place', lat: 28.6315, lon: 77.2167, rank: 0 },
  { id: 'igi', label: 'IGI Airport', lat: 28.5562, lon: 77.1, rank: 1 },
  { id: 'cyber-city', label: 'Cyber City · Gurugram', lat: 28.4949, lon: 77.089, rank: 2 },
  { id: 'sector-62', label: 'Sector 62 · Noida', lat: 28.6247, lon: 77.3717, rank: 3 },
  { id: 'anand-vihar', label: 'Anand Vihar ISBT', lat: 28.6469, lon: 77.3159, rank: 4 },
  { id: 'qutub', label: 'Qutub Minar', lat: 28.5245, lon: 77.1855, rank: 5 },
  { id: 'akshardham', label: 'Akshardham · NH24', lat: 28.6127, lon: 77.2773, rank: 6 },
  { id: 'red-fort', label: 'Red Fort · Old Delhi', lat: 28.6562, lon: 77.241, rank: 7 },
  { id: 'india-gate', label: 'India Gate', lat: 28.6129, lon: 77.2295, rank: 8 },
];
