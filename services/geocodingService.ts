/**
 * geocodingService.ts
 *
 * Nominatim (OpenStreetMap) Geocoding + Haversine distance calculation.
 * Used by the Central agent to find nearby partner tenants.
 * 100% free, no API key needed.
 */

export interface GeoCoords {
  lat: number;
  lng: number;
}

/**
 * Geocode an address string → { lat, lng } using Nominatim (OpenStreetMap).
 * Returns null if the address cannot be geocoded.
 * Rate limit: 1 request/second (enforced by Nominatim policy).
 */
export async function geocodeAddress(address: string): Promise<GeoCoords | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=br&accept-language=pt-BR`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgendeZap/1.0' },
    });
    const data = await res.json();
    if (data?.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    console.warn('[Geocoding] No results for:', address);
    return null;
  } catch (e: any) {
    console.error('[Geocoding] Error:', e.message);
    return null;
  }
}

/**
 * Calculate distance between two points using the Haversine formula.
 * Returns distance in kilometers.
 */
export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // 1 decimal place
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Find nearby tenants sorted by distance.
 * Requires tenants to have lat/lon set.
 */
export function sortByDistance(
  tenants: Array<{ id: string; latitude?: number; longitude?: number; [k: string]: any }>,
  fromLat: number,
  fromLng: number
): Array<{ tenant: any; distance: number }> {
  return tenants
    .filter(t => t.latitude != null && t.longitude != null)
    .map(t => ({
      tenant: t,
      distance: calculateDistance(fromLat, fromLng, t.latitude!, t.longitude!),
    }))
    .sort((a, b) => a.distance - b.distance);
}
