// server/domain/routing/geocoder.ts — turning an address into a point.
//
// The only outbound call the app makes. It goes to the US Census Bureau's
// public geocoder: free, no API key, no account, and run by a government
// agency rather than an ad business. An address is sent once, when a property
// is first routed or its address changes; the answer is stored in
// property_locations and never asked for again.
//
// It is swappable (setGeocoder) so tests never touch the network, and so a
// deployment outside the US could point it somewhere else.

export interface Point {
  latitude: number;
  longitude: number;
}

/** Resolves to null when the address was not found; rejects only on a transport failure. */
export type Geocoder = (oneLineAddress: string) => Promise<Point | null>;

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const TIMEOUT_MS = 10_000;

interface CensusResponse {
  result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] };
}

export const censusGeocoder: Geocoder = async (address) => {
  const url = `${CENSUS_URL}?${new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  }).toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Census geocoder answered ${res.status}`);
  const body = (await res.json()) as CensusResponse;
  const c = body.result?.addressMatches?.[0]?.coordinates;
  if (typeof c?.x !== "number" || typeof c?.y !== "number") return null;
  // Census returns x = longitude, y = latitude.
  return { latitude: c.y, longitude: c.x };
};

let current: Geocoder = censusGeocoder;

export function geocode(address: string): Promise<Point | null> {
  return current(address);
}

/** Replace the geocoder (tests). Returns the previous one so it can be restored. */
export function setGeocoder(g: Geocoder): Geocoder {
  const prev = current;
  current = g;
  return prev;
}
