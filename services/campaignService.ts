/**
 * campaignService.ts
 * Server-side bulk-campaign queue — persists in Supabase so dispatches
 * continue even when the browser tab is closed or the computer hibernates.
 */
import { supabase } from './supabase';

export interface BulkCampaign {
  id: string;
  name: string;
  admin_instance: string;
  contacts: { id: string; name: string; phone: string }[];
  messages: string[];
  delay_min: number;
  delay_max: number;
  pause_every: number;
  pause_min: number;
  pause_max: number;
  use_time_window: boolean;
  window_start: string;
  window_end: string;
  status: 'pending' | 'running' | 'done' | 'stopped';
  sent_count: number;
  error_count: number;
  current_index: number;
  next_send_at: string;
  created_at: string;
  updated_at: string;
}

type NewCampaign = Omit<
  BulkCampaign,
  'id' | 'status' | 'sent_count' | 'error_count' | 'current_index' | 'next_send_at' | 'created_at' | 'updated_at'
>;

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createCampaign(data: NewCampaign): Promise<BulkCampaign> {
  const { data: row, error } = await supabase
    .from('bulk_campaigns')
    .insert({
      ...data,
      status: 'running',
      sent_count: 0,
      error_count: 0,
      current_index: 0,
      next_send_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return row as BulkCampaign;
}

export async function getCampaigns(): Promise<BulkCampaign[]> {
  const { data, error } = await supabase
    .from('bulk_campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as BulkCampaign[];
}

export async function getCampaign(id: string): Promise<BulkCampaign | null> {
  const { data } = await supabase
    .from('bulk_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data as BulkCampaign | null;
}

export async function stopCampaign(id: string): Promise<void> {
  await supabase
    .from('bulk_campaigns')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function deleteCampaign(id: string): Promise<void> {
  await supabase.from('bulk_campaigns').delete().eq('id', id);
}

// ── Tick — triggers the Edge Function to process the next pending message ─────
// The browser calls this every few seconds while open.
// pg_cron calls it every minute as server-side fallback.
const TICK_URL =
  'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

export async function triggerTick(): Promise<void> {
  await fetch(TICK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-campaign-tick': 'true',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: '{}',
  }).catch(() => {}); // non-fatal — pg_cron is the fallback
}
