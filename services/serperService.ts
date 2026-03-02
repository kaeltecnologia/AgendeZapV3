/**
 * serperService.ts
 * Prospecção de contatos via Google Maps usando Serper.dev.
 */
import { supabase } from './supabase';

// Special tenant_id row used to persist SuperAdmin-level config in Supabase
const SA_ID = 'superadmin';

export interface SerperPlace {
  id: string;
  name: string;
  address: string;
  phone: string;
  website?: string;
  rating?: number;
  reviewsCount?: number;
  category?: string;
}

export interface ProspectContact {
  id: string;
  name: string;
  phone: string;
  address: string;
}

export interface ProspectCampaign {
  id: string;
  name: string;
  keyword: string;
  city: string;
  contacts: ProspectContact[];
  createdAt: string;
}

const CAMPAIGNS_KEY = 'agz_prospect_campaigns';
const SERPER_KEY_STORAGE = 'agz_serper_key';
const ADMIN_INSTANCE_KEY = 'agz_admin_instance';

export function loadCampaigns(): ProspectCampaign[] {
  try { return JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) || '[]'); } catch { return []; }
}

export function saveCampaigns(campaigns: ProspectCampaign[]) {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

export function loadSerperKey(): string {
  return localStorage.getItem(SERPER_KEY_STORAGE) || '';
}

export function saveSerperKey(key: string) {
  localStorage.setItem(SERPER_KEY_STORAGE, key);
}

/** Load Serper key from Supabase (cross-device). Returns '' on failure. */
export async function loadSerperKeyRemote(): Promise<string> {
  try {
    const { data } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', SA_ID)
      .maybeSingle();
    return (data?.follow_up as any)?._serper_key || '';
  } catch { return ''; }
}

/** Persist Serper key to Supabase so it survives browser clears and device switches. */
export async function saveSerperKeyRemote(key: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', SA_ID)
      .maybeSingle();
    const follow_up = { ...(data?.follow_up as object || {}), _serper_key: key };
    await supabase
      .from('tenant_settings')
      .upsert({ tenant_id: SA_ID, follow_up }, { onConflict: 'tenant_id' });
  } catch { /* non-fatal — localStorage is the fallback */ }
}

export function loadAdminInstance(): string {
  return localStorage.getItem(ADMIN_INSTANCE_KEY) || 'agz_superadmin';
}

export function saveAdminInstance(name: string) {
  localStorage.setItem(ADMIN_INSTANCE_KEY, name);
}

export interface SearchResult {
  places: SerperPlace[];
  duplicatesRemoved: number;
}

export async function searchGoogleMaps(
  keyword: string,
  city: string,
  apiKey: string,
  onProgress?: (page: number, found: number) => void,
): Promise<SearchResult> {
  const q = `${keyword.trim()} em ${city.trim()}`;
  const MAX_PAGES = 10; // up to ~200 results
  const allRaw: any[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    onProgress?.(page, allRaw.length);

    const res = await fetch('https://google.serper.dev/maps', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'br', hl: 'pt', num: 20, page }),
    });

    if (!res.ok) {
      if (page === 1) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(err.message || `Serper API — erro ${res.status}`);
      }
      break; // subsequent pages failing → stop gracefully
    }

    const data = await res.json();
    const pagePlaces: any[] = data.places || [];

    if (!pagePlaces.length) break; // no more results
    allRaw.push(...pagePlaces);
    if (pagePlaces.length < 20) break; // last partial page
  }

  const mapped = allRaw
    .map((p, i) => ({
      id: p.placeId || `serper-${i}`,
      name: p.title || p.name || '',
      address: p.address || '',
      phone: (p.phoneNumber || p.phone || '').replace(/\D/g, ''),
      website: p.website || undefined,
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      reviewsCount: p.ratingCount ?? p.reviews ?? undefined,
      category: p.type || p.category || undefined,
    }))
    .filter(p => p.name);

  // Deduplicate: skip entries with the same phone (if non-empty) or same normalized name
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  const places = mapped.filter(p => {
    const normName = p.name.toLowerCase().trim();
    if (p.phone) {
      if (seenPhones.has(p.phone)) return false;
      seenPhones.add(p.phone);
    }
    if (seenNames.has(normName)) return false;
    seenNames.add(normName);
    return true;
  });

  return { places, duplicatesRemoved: mapped.length - places.length };
}
