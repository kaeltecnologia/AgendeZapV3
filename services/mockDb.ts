
/**
 * =====================================================================
 *  Supabase DB Service — AgendeZap
 * =====================================================================
 *
 *  Required SQL migrations (run once in Supabase SQL Editor):
 *
 *  -- Appointment plan flag (only required addition)
 *  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_plan BOOLEAN DEFAULT FALSE;
 *
 *  NOTE: Plans, customer modes and customer plan data are all stored inside
 *        tenant_settings.follow_up JSONB (_plans, _customerData keys).
 *        No additional table or column changes are required.
 *
 * =====================================================================
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Tenant, Professional, Service, Appointment,
  Customer, AppointmentStatus, PaymentMethod, TenantSettings,
  TenantStatus, BookingSource, Expense, BreakPeriod, Plan,
  FollowUpNamedMode, InventoryItem, RecurringSchedule, Comanda, Product,
  NotaFiscal, Adiantamento, PagamentoPro, FocusNfeConfig, SupportMessage, ConversationLog
} from '../types';

// ─── Helpers ────────────────────────────────────────────────────────

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

/** Format a Date as a local-time ISO string (no UTC conversion). */
function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}


class DatabaseService {
  private connectionStatus: 'online' | 'offline' | 'checking' = 'checking';

  constructor() {
    this.checkConnection();
  }

  async checkConnection() {
    if (!isSupabaseConfigured) {
      this.connectionStatus = 'offline';
      return false;
    }
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      const query = supabase.from('tenants').select('id').limit(1);
      await Promise.race([query, timeout]);
      this.connectionStatus = 'online';
      return true;
    } catch (err) {
      console.warn("Supabase Connection Failed:", err);
      this.connectionStatus = 'offline';
      return false;
    }
  }

  isOnline() {
    return this.connectionStatus === 'online';
  }

  // ─── TENANTS ────────────────────────────────────────────────────────

  async getAllTenants(): Promise<Tenant[]> {
    try {
      const { data, error } = await supabase.from('tenants').select('*');
      if (error) throw error;
      return (data || []).map(t => ({
        id: t.id,
        name: t.nome || 'Sem Nome',
        slug: t.slug,
        email: t.email,
        password: t.password,
        phone: t.phone,
        due_day: t.due_day ? Number(t.due_day) : undefined,
        evolution_instance: t.evolution_instance,
        nicho: t.nicho || 'Barbearia',
        plan: t.plan || 'START',
        status: t.status as TenantStatus,
        monthlyFee: Number(t.mensalidade || 0),
        createdAt: t.created_at
      }));
    } catch (err) {
      console.error("Error fetching tenants:", err);
      return [];
    }
  }

  async getTenant(id: string): Promise<Tenant | null> {
    try {
      const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        name: data.nome || 'Sem Nome',
        slug: data.slug,
        email: data.email,
        password: data.password,
        phone: data.phone,
        due_day: data.due_day ? Number(data.due_day) : undefined,
        evolution_instance: data.evolution_instance,
        plan: data.plan || 'START',
        status: data.status as TenantStatus,
        monthlyFee: Number(data.mensalidade || 0),
        createdAt: data.created_at
      };
    } catch (err) {
      console.error("Error fetching tenant:", err);
      return null;
    }
  }

  async addTenant(tenant: { name: string; slug: string; email?: string; password?: string; plan?: string; status?: TenantStatus; monthlyFee?: number; nicho?: string; subscriptionPlan?: string }) {
    try {
      const payload = {
        nome: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        password: tenant.password,
        plan: tenant.subscriptionPlan || tenant.plan || 'START',
        status: tenant.status || TenantStatus.ACTIVE,
        mensalidade: tenant.monthlyFee || 0,
        nicho: tenant.nicho || 'Barbearia',
        evolution_instance: `agz_${tenant.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '').trim()}`
      };
      const { data, error } = await supabase.from('tenants').insert(payload).select().single();
      if (error) throw error;
      return {
        id: data.id,
        name: data.nome,
        slug: data.slug,
        email: data.email,
        password: data.password,
        plan: data.plan,
        status: data.status,
        monthlyFee: data.mensalidade,
        nicho: data.nicho || 'Barbearia',
        createdAt: data.created_at
      } as Tenant;
    } catch (e) {
      console.error("Supabase Tenant Insert Error:", e);
      throw e;
    }
  }

  async updateTenant(id: string, updates: Partial<Tenant>) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.nome = updates.name;
      if (updates.status) payload.status = updates.status;
      if (updates.monthlyFee !== undefined) payload.mensalidade = updates.monthlyFee;
      if (updates.plan) payload.plan = updates.plan;
      if (updates.email !== undefined) payload.email = updates.email;
      if (updates.password !== undefined) payload.password = updates.password;
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.due_day !== undefined) payload.due_day = updates.due_day;
      if (updates.nicho !== undefined) payload.nicho = updates.nicho;
      const { error } = await supabase.from('tenants').update(payload).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Tenant Update Error:", e);
      throw e;
    }
  }

  async deleteTenant(id: string) {
    try {
      const { error } = await supabase.from('tenants').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Tenant Delete Error:", e);
      throw e;
    }
  }

  // ─── APPOINTMENTS ───────────────────────────────────────────────────

  async getAppointments(tenantId: string): Promise<Appointment[]> {
    try {
      const { data, error } = await supabase.from('appointments').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(a => {
        const start = new Date(a.inicio);
        const end = new Date(a.fim);
        const duration = Math.round((end.getTime() - start.getTime()) / 60000);
        return {
          id: a.id,
          tenant_id: a.tenant_id,
          customer_id: a.customer_id,
          professional_id: a.professional_id,
          service_id: a.service_id,
          startTime: a.inicio,
          durationMinutes: duration,
          status: a.status as AppointmentStatus,
          source: a.origem as BookingSource,
          paymentMethod: a.payment_method as PaymentMethod,
          amountPaid: Number(a.amount_paid || 0),
          isPlan: a.is_plan ?? false
        };
      });
    } catch (err) {
      console.error("Error fetching appointments:", err);
      return [];
    }
  }

  async addAppointment(app: any) {
    try {
      const start = new Date(app.startTime);
      const end = new Date(start.getTime() + (app.durationMinutes || 30) * 60000);
      // Use local time strings — avoids UTC offset storing the wrong time
      const inicio = toLocalISO(start);
      const fim = toLocalISO(end);
      const payload: any = {
        tenant_id: app.tenant_id,
        customer_id: app.customer_id,
        professional_id: app.professional_id,
        service_id: app.service_id,
        inicio,
        fim,
        status: app.status || AppointmentStatus.PENDING,
        origem: app.source || BookingSource.WEB,
        is_plan: app.isPlan ?? false
      };
      let { data, error } = await supabase.from('appointments').insert(payload).select().single();
      // Fallback: if is_plan column not yet migrated, retry without it
      if (error && (error.message?.includes('is_plan') || (error as any).code === '42703')) {
        console.warn('[DB] is_plan column missing — run migration. Retrying without it.');
        const { is_plan, ...payloadWithout } = payload;
        const r2 = await supabase.from('appointments').insert(payloadWithout).select().single();
        data = r2.data; error = r2.error;
      }
      if (error) throw error;
      return {
        ...data,
        startTime: data.inicio,
        durationMinutes: app.durationMinutes,
        source: data.origem,
        isPlan: data.is_plan ?? false
      };
    } catch (e) {
      console.error("Supabase Appointment Insert Error:", e);
      throw e;
    }
  }

  async updateAppointmentStatus(id: string, status: AppointmentStatus, updates: Partial<Appointment>) {
    try {
      const { error } = await supabase.from('appointments').update({
        status,
        payment_method: updates.paymentMethod,
        amount_paid: updates.amountPaid,
        extra_note: updates.extraNote,
        extra_value: updates.extraValue
      }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Appointment Update Error:", e);
      throw e;
    }
  }

  async updateAppointmentSchedule(
    id: string,
    professionalId: string,
    serviceId: string,
    startTime: Date,
    durationMinutes: number
  ): Promise<void> {
    const fim = new Date(startTime.getTime() + durationMinutes * 60000);
    const { error } = await supabase.from('appointments').update({
      professional_id: professionalId,
      service_id: serviceId,
      inicio: startTime.toISOString(),
      fim: fim.toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async deleteAppointment(id: string): Promise<void> {
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Appointment Delete Error:", e);
      throw e;
    }
  }

  // ─── PROFESSIONALS ──────────────────────────────────────────────────

  async getProfessionals(tenantId: string): Promise<Professional[]> {
    try {
      const [{ data, error }, settings] = await Promise.all([
        supabase.from('professionals').select('*').eq('tenant_id', tenantId),
        this.getSettings(tenantId)
      ]);
      if (error) throw error;
      const profMeta = settings.professionalMeta || {};
      return (data || []).map(p => ({
        id: p.id,
        tenant_id: p.tenant_id,
        name: p.nome || 'Sem Nome',
        phone: p.phone || '',
        specialty: p.especialidade || '',
        active: p.ativo ?? true,
        role: profMeta[p.id]?.role || 'colab'
      }));
    } catch (err) {
      console.error("Error fetching professionals:", err);
      return [];
    }
  }

  async addProfessional(pro: any) {
    try {
      const { data, error } = await supabase.from('professionals').insert({
        tenant_id: pro.tenant_id,
        nome: pro.name,
        phone: pro.phone || '',
        especialidade: pro.specialty || '',
        ativo: pro.active ?? true
      }).select().single();
      if (error) throw error;
      return { ...data, name: data.nome, specialty: data.especialidade, active: data.ativo };
    } catch (e) {
      console.error("Supabase Professional Insert Error:", e);
      throw e;
    }
  }

  async updateProfessional(tenantId: string, id: string, pro: Partial<Professional>) {
    try {
      const payload: any = {};
      if (pro.name !== undefined) payload.nome = pro.name;
      if (pro.phone !== undefined) payload.phone = pro.phone;
      if (pro.specialty !== undefined) payload.especialidade = pro.specialty;
      if (pro.active !== undefined) payload.ativo = pro.active;
      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('professionals').update(payload).eq('id', id);
        if (error) throw error;
      }
      // Role is stored in settings JSONB (no schema change needed)
      if (pro.role !== undefined) {
        const s = await this.getSettings(tenantId);
        const meta = { ...(s.professionalMeta || {}) };
        meta[id] = { ...(meta[id] || {}), role: pro.role };
        await this.updateSettings(tenantId, { professionalMeta: meta });
      }
    } catch (e) {
      console.error("Supabase Professional Update Error:", e);
      throw e;
    }
  }

  async deleteProfessional(tenantId: string, id: string): Promise<void> {
    try {
      // Remove appointments linked to this professional first (FK constraint)
      const { error: apptErr } = await supabase.from('appointments')
        .delete().eq('professional_id', id).eq('tenant_id', tenantId);
      if (apptErr) throw apptErr;

      // Remove breaks linked to this professional from settings JSONB
      const s = await this.getSettings(tenantId);
      const meta = { ...(s.professionalMeta || {}) };
      delete meta[id];
      const breaks = (s.breaks || []).filter((b: any) => b.professionalId !== id);
      await this.updateSettings(tenantId, { professionalMeta: meta, breaks });

      // Now safe to delete the professional row
      const { error } = await supabase.from('professionals').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Professional Delete Error:", e);
      throw e;
    }
  }

  // ─── SERVICES ───────────────────────────────────────────────────────

  async getServices(tenantId: string): Promise<Service[]> {
    try {
      const { data, error } = await supabase.from('services').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(s => ({
        id: s.id,
        tenant_id: s.tenant_id,
        name: s.nome || 'Sem Nome',
        price: Number(s.preco || 0),
        durationMinutes: s.duracao_minutos || 30,
        active: s.ativo ?? true
      }));
    } catch (err) {
      console.error("Error fetching services:", err);
      return [];
    }
  }

  async addService(svc: any) {
    try {
      const payload = {
        tenant_id: svc.tenant_id,
        nome: svc.name,
        preco: svc.price,
        duracao_minutos: svc.durationMinutes,
        ativo: svc.ativo ?? true
      };
      const { data, error } = await supabase.from('services').insert(payload).select().single();
      if (error) throw error;
      return {
        id: data.id,
        tenant_id: data.tenant_id,
        name: data.nome,
        price: Number(data.preco),
        durationMinutes: data.duracao_minutos,
        active: data.ativo
      };
    } catch (e) {
      console.error("Supabase Service Insert Error:", e);
      throw e;
    }
  }

  async updateService(id: string, svc: Partial<Service>) {
    try {
      const { error } = await supabase.from('services').update({
        nome: svc.name,
        preco: svc.price,
        duracao_minutos: svc.durationMinutes,
        ativo: svc.active
      }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Service Update Error:", e);
      throw e;
    }
  }

  // ─── CUSTOMERS ──────────────────────────────────────────────────────
  //
  // Plan assignments and follow-up mode IDs are stored in
  // tenant_settings.follow_up._customerData (JSONB) — no schema changes needed.

  private buildCustomer(c: any, cData: any = {}): Customer {
    return {
      id: c.id,
      tenant_id: c.tenant_id,
      name: c.nome || 'Sem Nome',
      phone: c.telefone || '',
      active: true,
      followUpPreferences: { aviso: true, lembrete: true, reativacao: true },
      avisoModeId: cData.avisoModeId || 'standard',
      lembreteModeId: cData.lembreteModeId || 'standard',
      reativacaoModeId: cData.reativacaoModeId || 'standard',
      planId: cData.planId || null,
      planServiceId: cData.planServiceId || null,
      recurringSchedule: cData.recurringSchedule
    };
  }

  async getCustomers(tenantId: string): Promise<Customer[]> {
    try {
      const [{ data, error }, settings] = await Promise.all([
        supabase.from('customers').select('*').eq('tenant_id', tenantId),
        this.getSettings(tenantId)
      ]);
      if (error) throw error;
      const customerData = settings.customerData || {};
      return (data || []).map(c => this.buildCustomer(c, customerData[c.id] || {}));
    } catch (err: any) {
      console.error("Error fetching customers:", err?.code, err?.message, err?.details);
      return [];
    }
  }

  async addCustomer(customer: any) {
    try {
      const { data, error } = await supabase.from('customers').insert({
        tenant_id: customer.tenant_id,
        nome: customer.name,
        telefone: customer.phone
      }).select().single();

      // Unique constraint violation: customer with same phone already exists
      if (error?.code === '23505') {
        const { data: existing } = await supabase.from('customers')
          .select('*').eq('tenant_id', customer.tenant_id).eq('telefone', customer.phone).maybeSingle();
        if (existing) return this.buildCustomer(existing, {});
      }

      if (error) {
        console.error("Supabase Customer Insert Error:", error.code, error.message, error.details, error.hint);
        throw error;
      }
      return this.buildCustomer(data, {});
    } catch (e: any) {
      if (e?.code !== '23505') console.error("Supabase Customer Insert Error:", e);
      throw e;
    }
  }

  /** tenantId is required so we can write plan/mode data to settings JSONB. */
  async updateCustomer(tenantId: string, id: string, updates: Partial<Customer>) {
    try {
      // Update only name/phone in the customers table
      const payload: any = {};
      if (updates.name !== undefined) payload.nome = updates.name;
      if (updates.phone !== undefined) payload.telefone = updates.phone;
      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('customers').update(payload).eq('id', id);
        if (error) throw error;
      }

      // Write plan/mode assignments to settings JSONB (_customerData)
      const hasCData =
        'planId' in updates ||
        'planServiceId' in updates ||
        'recurringSchedule' in updates ||
        updates.avisoModeId !== undefined ||
        updates.lembreteModeId !== undefined ||
        updates.reativacaoModeId !== undefined;

      if (hasCData) {
        const s = await this.getSettings(tenantId);
        const allCData = { ...(s.customerData || {}) };
        const prev = allCData[id] || {};
        allCData[id] = {
          ...prev,
          planId: 'planId' in updates ? (updates.planId ?? null) : prev.planId,
          planServiceId: 'planServiceId' in updates ? (updates.planServiceId ?? null) : prev.planServiceId,
          avisoModeId: updates.avisoModeId !== undefined ? updates.avisoModeId : prev.avisoModeId,
          lembreteModeId: updates.lembreteModeId !== undefined ? updates.lembreteModeId : prev.lembreteModeId,
          reativacaoModeId: updates.reativacaoModeId !== undefined ? updates.reativacaoModeId : prev.reativacaoModeId,
          recurringSchedule: 'recurringSchedule' in updates ? (updates.recurringSchedule as RecurringSchedule | undefined) : prev.recurringSchedule
        };
        await this.updateSettings(tenantId, { customerData: allCData });
      }
    } catch (e) {
      console.error("Supabase Customer Update Error:", e);
      throw e;
    }
  }

  async findOrCreateCustomer(tenantId: string, phone: string, name: string) {
    try {
      const [{ data: existing, error: fetchError }, settings] = await Promise.all([
        supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle(),
        this.getSettings(tenantId)
      ]);
      if (fetchError) throw fetchError;
      const customerData = settings.customerData || {};
      if (existing) return this.buildCustomer(existing, customerData[existing.id] || {});
      return await this.addCustomer({ tenant_id: tenantId, name, phone });
    } catch (err) {
      console.error("Error findOrCreateCustomer:", err);
      throw err;
    }
  }

  /** Search a customer by (partial) name — used when barber books via WhatsApp. */
  async findOrCreateCustomerByName(tenantId: string, name: string): Promise<Customer> {
    try {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('nome', `%${name}%`)
        .limit(1)
        .maybeSingle();
      if (data) {
        const s = await this.getSettings(tenantId);
        return this.buildCustomer(data, (s.customerData || {})[data.id] || {});
      }
      return await this.addCustomer({ tenant_id: tenantId, name, phone: '' });
    } catch (err) {
      console.error("Error findOrCreateCustomerByName:", err);
      throw err;
    }
  }

  async isSlotAvailable(tenantId: string, professionalId: string, startTime: Date, durationMinutes: number): Promise<{ available: boolean; reason?: string }> {
    try {
      const settings = await this.getSettings(tenantId);
      const dayIndex = startTime.getDay();
      const dayConfig = settings.operatingHours[dayIndex];
      if (!dayConfig || !dayConfig.active) {
        return { available: false, reason: "Barbearia fechada neste dia." };
      }

      const [startRange, endRange] = dayConfig.range.split('-');
      const [startH, startM] = startRange.split(':').map(Number);
      const [endH, endM] = endRange.split(':').map(Number);

      const rangeStart = new Date(startTime);
      rangeStart.setHours(startH, startM, 0, 0);
      const rangeEnd = new Date(startTime);
      rangeEnd.setHours(endH, endM, 0, 0);
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

      // Se acceptLastSlot está ON, permite iniciar no horário exato de fechamento
      // (o agendamento pode ultrapassar o horário de fechamento)
      const exceedsEnd = dayConfig.acceptLastSlot
        ? startTime > rangeEnd   // só bloqueia se começar DEPOIS do fechamento
        : endTime > rangeEnd;    // comportamento padrão: deve terminar até o fechamento
      if (startTime < rangeStart || exceedsEnd) {
        return { available: false, reason: `Fora do horário de funcionamento (${dayConfig.range}).` };
      }

      // Check break periods
      const slotLabel = `${String(startTime.getHours()).padStart(2,'0')}:${String(startTime.getMinutes()).padStart(2,'0')}`;
      const endLabel = `${String(endTime.getHours()).padStart(2,'0')}:${String(endTime.getMinutes()).padStart(2,'0')}`;
      const dateStr = `${startTime.getFullYear()}-${String(startTime.getMonth()+1).padStart(2,'0')}-${String(startTime.getDate()).padStart(2,'0')}`;
      for (const brk of (settings.breaks || [])) {
        if (brk.professionalId && brk.professionalId !== professionalId) continue;
        // Férias: verifica faixa de datas (date → vacationEndDate)
        if ((brk as any).type === 'vacation') {
          const vacStart = brk.date || '';
          const vacEnd = (brk as any).vacationEndDate || brk.date || '';
          if (vacStart && dateStr >= vacStart && dateStr <= vacEnd) {
            return { available: false, reason: `${brk.label || 'Profissional de férias'} (até ${vacEnd}).` };
          }
          continue;
        }
        const matchDate = !brk.date || brk.date === dateStr;
        const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
        if (matchDate && matchDay) {
          if (slotLabel < brk.endTime && endLabel > brk.startTime) {
            return { available: false, reason: `Período de intervalo: ${brk.label} (${brk.startTime}–${brk.endTime}).` };
          }
        }
      }

      const { data, error } = await supabase
        .from('appointments')
        .select('inicio, fim')
        .eq('tenant_id', tenantId)
        .eq('professional_id', professionalId)
        .neq('status', AppointmentStatus.CANCELLED) // frontend: 'CANCELLED'
        .neq('status', 'cancelado')                 // IA (Edge Function): 'cancelado'
        .gte('inicio', `${dateStr}T00:00:00`)
        .lte('inicio', `${dateStr}T23:59:59`);
      if (error) throw error;

      // Margem de 11 min: permite sobreposição de até 11 min entre procedimentos
      const BUFFER_MS = 11 * 60 * 1000;
      const conflicts = (data || []).filter(a => {
        const aStart = new Date(a.inicio);
        const aEnd = new Date(a.fim);
        // Overlap duration = max(0, min(endTime, aEnd) - max(startTime, aStart))
        const overlapMs = Math.max(0,
          Math.min(endTime.getTime(), aEnd.getTime()) - Math.max(startTime.getTime(), aStart.getTime())
        );
        return overlapMs > BUFFER_MS; // conflito somente se sobreposição > 11 min
      });
      return conflicts.length > 0 ? { available: false, reason: "Horário ocupado." } : { available: true };
    } catch (err) {
      console.error("Error checking slot availability:", err);
      return { available: false, reason: "Erro ao verificar disponibilidade." };
    }
  }

  // ─── SETTINGS ───────────────────────────────────────────────────────
  //
  // Extra fields (whatsapp, breaks, plans, modes, etc.) are stored inside
  // the existing `follow_up` JSONB column under _-prefixed keys so no
  // schema changes are required.

  async getSettings(tenantId: string): Promise<TenantSettings> {
    const defaults: TenantSettings = {
      followUp: {
        aviso: { active: true, message: "Aviso", timing: 0, fixedTime: "08:00" },
        lembrete: { active: true, message: "Lembrete", timing: 60 },
        reativacao: { active: true, message: "Sumido", timing: 30 }
      },
      operatingHours: {
        1: { active: true, range: "09:00-18:00" },
        2: { active: true, range: "09:00-18:00" },
        3: { active: true, range: "09:00-18:00" },
        4: { active: true, range: "09:00-18:00" },
        5: { active: true, range: "09:00-18:00" },
        6: { active: true, range: "09:00-18:00" },
        0: { active: false, range: "09:00-18:00" }
      },
      aiActive: false,
      themeColor: "#f97316",
      whatsapp: '',
      breaks: [],
      customModes: [],
      avisoModes: [],
      lembreteModes: [],
      reativacaoModes: [],
      plans: [],
      planUsage: {},
      professionalMeta: {},
      customerData: {},
      followUpSent: {},
      inventory: []
    };
    try {
      const { data, error } = await supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (error) throw error;
      if (data) {
        const fu = data.follow_up || {};
        return {
          followUp: {
            aviso: fu.aviso || defaults.followUp.aviso,
            lembrete: fu.lembrete || defaults.followUp.lembrete,
            reativacao: fu.reativacao || defaults.followUp.reativacao,
          },
          operatingHours: data.operating_hours || defaults.operatingHours,
          aiActive: data.ai_active ?? false,
          themeColor: data.theme_color || '#f97316',
          whatsapp: fu._whatsapp || '',
          breaks: fu._breaks || [],
          customModes: fu._customModes || [],
          avisoModes: fu._avisoModes || [],
          lembreteModes: fu._lembreteModes || [],
          reativacaoModes: fu._reativacaoModes || [],
          plans: fu._plans || [],
          planUsage: fu._planUsage || {},
          professionalMeta: fu._professionalMeta || {},
          customerData: fu._customerData || {},
          followUpSent: fu._followUpSent || {},
          profAgendaSent: fu._profAgendaSent || {},
          agendaDiariaHora: fu._agendaDiariaHora || '00:01',
          inventory: fu._inventory || [],
          monthlyRevenueGoal: fu._monthlyRevenueGoal ?? 0,
          cardFees: fu._cardFees ?? { debit: 0, credit: 0, installment: 0 },
          aiLeadActive: fu._aiLeadActive !== false,
          aiProfessionalActive: !!fu._aiProfessionalActive,
          systemPrompt: fu._systemPrompt || '',
          agentName: fu._agentName || '',
          openaiApiKey: fu._openaiApiKey || '',
          msgBufferSecs: fu._msgBufferSecs ?? 30,
          trialStartDate: fu._trialStartDate ?? null,
          trialWarningSent: fu._trialWarningSent ?? false,
          focusNfeConfig: fu._focusNfeConfig ?? null,
          adiantamentos: fu._adiantamentos ?? [],
          pagamentosPro: fu._pagamentosPro ?? [],
          notasFiscais: fu._notasFiscais ?? [],
          lastOptimizedAt: fu._lastOptimizedAt ?? undefined,
          lastOptimizationSummary: fu._lastOptimizationSummary ?? undefined,
        };
      }
    } catch (e) {
      console.error("Error fetching settings:", e);
    }
    return defaults;
  }

  async updateSettings(tenantId: string, updates: any) {
    try {
      const curr = await this.getSettings(tenantId);
      const newS = { ...curr, ...updates };

      // Merge ALL metadata back into follow_up JSONB so nothing is lost
      const followUpWithMeta = {
        ...newS.followUp,
        _whatsapp: newS.whatsapp ?? curr.whatsapp ?? '',
        _breaks: newS.breaks ?? curr.breaks ?? [],
        _customModes: newS.customModes ?? curr.customModes ?? [],
        _avisoModes: newS.avisoModes ?? curr.avisoModes ?? [],
        _lembreteModes: newS.lembreteModes ?? curr.lembreteModes ?? [],
        _reativacaoModes: newS.reativacaoModes ?? curr.reativacaoModes ?? [],
        _plans: newS.plans ?? curr.plans ?? [],
        _planUsage: newS.planUsage ?? curr.planUsage ?? {},
        _professionalMeta: newS.professionalMeta ?? curr.professionalMeta ?? {},
        _customerData: newS.customerData ?? curr.customerData ?? {},
        _followUpSent: newS.followUpSent ?? curr.followUpSent ?? {},
        _profAgendaSent: newS.profAgendaSent ?? curr.profAgendaSent ?? {},
        _agendaDiariaHora: newS.agendaDiariaHora ?? curr.agendaDiariaHora ?? '00:01',
        _inventory: newS.inventory ?? curr.inventory ?? [],
        _monthlyRevenueGoal: newS.monthlyRevenueGoal ?? curr.monthlyRevenueGoal ?? 0,
        _cardFees: newS.cardFees ?? curr.cardFees ?? { debit: 0, credit: 0, installment: 0 },
        _aiLeadActive: newS.aiLeadActive ?? curr.aiLeadActive ?? true,
        _aiProfessionalActive: newS.aiProfessionalActive ?? curr.aiProfessionalActive ?? false,
        _systemPrompt: newS.systemPrompt ?? curr.systemPrompt ?? '',
        _agentName: newS.agentName ?? curr.agentName ?? '',
        _openaiApiKey: newS.openaiApiKey ?? curr.openaiApiKey ?? '',
        _msgBufferSecs: newS.msgBufferSecs ?? curr.msgBufferSecs ?? 30,
        _trialStartDate: newS.trialStartDate !== undefined ? newS.trialStartDate : (curr.trialStartDate ?? null),
        _trialWarningSent: newS.trialWarningSent ?? curr.trialWarningSent ?? false,
        _focusNfeConfig: newS.focusNfeConfig !== undefined ? newS.focusNfeConfig : (curr.focusNfeConfig ?? null),
        _adiantamentos: newS.adiantamentos ?? curr.adiantamentos ?? [],
        _pagamentosPro: newS.pagamentosPro ?? curr.pagamentosPro ?? [],
        _notasFiscais: newS.notasFiscais ?? curr.notasFiscais ?? [],
        _lastOptimizedAt: newS.lastOptimizedAt !== undefined ? newS.lastOptimizedAt : (curr.lastOptimizedAt ?? null),
        _lastOptimizationSummary: newS.lastOptimizationSummary !== undefined ? newS.lastOptimizationSummary : (curr.lastOptimizationSummary ?? null),
      };

      const { error } = await supabase.from('tenant_settings').upsert(
        {
          tenant_id: tenantId,
          follow_up: followUpWithMeta,
          operating_hours: newS.operatingHours,
          ai_active: newS.aiActive,
          theme_color: newS.themeColor
        },
        { onConflict: 'tenant_id' }  // required to avoid duplicate key error
      );
      if (error) throw error;
    } catch (e) {
      console.error("Error updating settings:", e);
      throw e;
    }
  }

  // ─── SUPPORT REQUESTS ───────────────────────────────────────────────

  async sendSupportRequest(tenantId: string, message: string, currentPlan: string, feature: string): Promise<void> {
    try {
      const { data } = await supabase.from('tenant_settings').select('follow_up').eq('tenant_id', tenantId).maybeSingle();
      const follow_up = {
        ...(data?.follow_up || {}),
        _supportRequest: {
          message: message.trim() || 'Solicitar upgrade de plano',
          currentPlan,
          feature,
          ts: new Date().toISOString(),
          status: 'pending'
        }
      };
      await supabase.from('tenant_settings').upsert({ tenant_id: tenantId, follow_up }, { onConflict: 'tenant_id' });
    } catch (e) { console.error('Error sending support request:', e); throw e; }
  }

  async getAllSupportRequests(): Promise<Array<{ tenantId: string; tenantName: string; plan: string; request: { message: string; currentPlan: string; feature: string; ts: string; status: string } }>> {
    try {
      const [{ data: settings }, { data: tenants }] = await Promise.all([
        supabase.from('tenant_settings').select('tenant_id, follow_up'),
        supabase.from('tenants').select('id, nome, plan')
      ]);
      const tenantMap = Object.fromEntries((tenants || []).map(t => [t.id, { name: t.nome || 'Sem Nome', plan: t.plan || 'START' }]));
      return (settings || [])
        .filter(s => s.follow_up?._supportRequest?.status === 'pending')
        .map(s => ({
          tenantId: s.tenant_id,
          tenantName: tenantMap[s.tenant_id]?.name || 'Desconhecido',
          plan: tenantMap[s.tenant_id]?.plan || 'START',
          request: s.follow_up._supportRequest
        }));
    } catch (e) { console.error('Error getting support requests:', e); return []; }
  }

  async dismissSupportRequest(tenantId: string): Promise<void> {
    try {
      const { data } = await supabase.from('tenant_settings').select('follow_up').eq('tenant_id', tenantId).maybeSingle();
      const follow_up = {
        ...(data?.follow_up || {}),
        _supportRequest: { ...(data?.follow_up?._supportRequest || {}), status: 'resolved' }
      };
      await supabase.from('tenant_settings').upsert({ tenant_id: tenantId, follow_up }, { onConflict: 'tenant_id' });
    } catch (e) { console.error('Error dismissing support request:', e); throw e; }
  }

  async createInvitedDemo(inviterTenantId: string, inviterName: string, inviteeName: string, inviteePhone: string): Promise<{ email: string; password: string; slug: string }> {
    const base = inviteeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]/g, '').substring(0, 18);
    const slug = `${base}-demo`;
    const email = `${slug}@agendezap.com`;
    const password = `Demo@${Math.floor(1000 + Math.random() * 9000)}`;
    const trialUntil = new Date();
    trialUntil.setDate(trialUntil.getDate() + 7);
    const trialStr = trialUntil.toLocaleDateString('pt-BR');

    const newTenant = await this.addTenant({
      name: inviteeName,
      slug,
      email,
      password,
      plan: 'START',
      status: TenantStatus.ACTIVE,
      monthlyFee: 0
    });

    await this.updateSettings(newTenant.id, { aiActive: false, themeColor: '#f97316' });

    // Write invite notification to support inbox (attached to new demo tenant)
    await this.sendSupportRequest(
      newTenant.id,
      `🎁 Convite de parceiro\n\nIndicado por: ${inviterName} (ID: ${inviterTenantId})\nConvidado: ${inviteeName} | WhatsApp: ${inviteePhone}\nLogin: ${email}\nSenha: ${password}\nAcesso gratuito até: ${trialStr}`,
      'DEMO',
      'convite_parceiro'
    );

    return { email, password, slug };
  }

  // ─── BREAK PERIODS (convenience wrappers over settings) ─────────────

  async getBreaks(tenantId: string): Promise<BreakPeriod[]> {
    const s = await this.getSettings(tenantId);
    return s.breaks || [];
  }

  async saveBreaks(tenantId: string, breaks: BreakPeriod[]): Promise<void> {
    await this.updateSettings(tenantId, { breaks });
  }

  // ─── PLANS (stored inside settings JSONB — no separate table needed) ─

  async getPlans(tenantId: string): Promise<Plan[]> {
    const s = await this.getSettings(tenantId);
    return (s.plans || []).filter(p => p.active);
  }

  async addPlan(plan: Omit<Plan, 'id'>): Promise<Plan> {
    const s = await this.getSettings(plan.tenant_id);
    const newPlan: Plan = { ...plan, id: generateId() };
    await this.updateSettings(plan.tenant_id, { plans: [...(s.plans || []), newPlan] });
    return newPlan;
  }

  async updatePlan(tenantId: string, id: string, updates: Partial<Plan>): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.plans || []).map(p => p.id === id ? { ...p, ...updates } : p);
    await this.updateSettings(tenantId, { plans: updated });
  }

  async deletePlan(tenantId: string, id: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.plans || []).map(p => p.id === id ? { ...p, active: false } : p);
    await this.updateSettings(tenantId, { plans: updated });
  }

  // ─── PLAN USAGE TRACKING ────────────────────────────────────────────

  async getPlanUsageCount(tenantId: string, customerId: string): Promise<number> {
    const s = await this.getSettings(tenantId);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const key = `${customerId}::${month}`;
    return (s.planUsage || {})[key] || 0;
  }

  async incrementPlanUsage(tenantId: string, customerId: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const key = `${customerId}::${month}`;
    const usage = { ...(s.planUsage || {}) };
    usage[key] = (usage[key] || 0) + 1;
    await this.updateSettings(tenantId, { planUsage: usage });
  }

  // ─── FOLLOW-UP NAMED MODES (convenience wrappers) ───────────────────

  async getNamedModes(tenantId: string): Promise<{ aviso: FollowUpNamedMode[]; lembrete: FollowUpNamedMode[]; reativacao: FollowUpNamedMode[] }> {
    const s = await this.getSettings(tenantId);
    return {
      aviso: s.avisoModes || [],
      lembrete: s.lembreteModes || [],
      reativacao: s.reativacaoModes || []
    };
  }

  // ─── RECURRING APPOINTMENT GENERATOR ────────────────────────────────
  // Called periodically (every 60 s) to pre-create plan appointments
  // for customers who have a recurringSchedule configured.

  async generateRecurringAppointments(tenantId: string): Promise<number> {
    try {
      const [customers, appointments, services] = await Promise.all([
        this.getCustomers(tenantId),
        this.getAppointments(tenantId),
        this.getServices(tenantId),
      ]);

      const now = new Date();
      const weeksAhead = 4;
      let created = 0;

      const pad = (n: number) => String(n).padStart(2, '0');
      const toDateStr = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      for (const customer of customers) {
        const sched = customer.recurringSchedule;
        if (!sched?.enabled || !sched.professionalId || !sched.slots?.length) continue;

        const serviceId = sched.serviceId || customer.planServiceId || '';
        if (!serviceId) continue;

        const service = services.find(s => s.id === serviceId && s.active);
        if (!service) continue;

        for (const slot of sched.slots) {
          for (let week = 0; week < weeksAhead; week++) {
            // Find next occurrence of slot.dayOfWeek from today
            const target = new Date(now);
            const daysUntil = ((slot.dayOfWeek - target.getDay()) + 7) % 7;
            target.setDate(target.getDate() + daysUntil + week * 7);

            const [h, m] = slot.time.split(':').map(Number);
            target.setHours(h, m, 0, 0);

            // Skip past moments
            if (target <= now) continue;

            const dateStr = toDateStr(target);

            // Skip if appointment already exists for this customer at this date/time
            const exists = appointments.some(a =>
              a.customer_id === customer.id &&
              a.startTime.slice(0, 10) === dateStr &&
              a.startTime.slice(11, 16) === slot.time &&
              a.status !== AppointmentStatus.CANCELLED
            );
            if (exists) continue;

            await this.addAppointment({
              tenant_id: tenantId,
              customer_id: customer.id,
              professional_id: sched.professionalId,
              service_id: serviceId,
              startTime: `${dateStr}T${slot.time}:00`,
              durationMinutes: service.durationMinutes,
              status: AppointmentStatus.CONFIRMED,
              source: BookingSource.PLAN,
              isPlan: true,
            });
            created++;
            console.log(`[RecurSched] Criado: ${customer.name} → ${dateStr} ${slot.time}`);
          }
        }
      }

      return created;
    } catch (e) {
      console.error('[RecurSched] Erro ao gerar agendamentos recorrentes:', e);
      return 0;
    }
  }

  // ─── FINANCIAL ──────────────────────────────────────────────────────

  async getFinancialSummary(tenantId: string, period: number, professionalId?: string) {
    try {
      const apps = await this.getAppointments(tenantId);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period);
      const filtered = apps.filter(a =>
        new Date(a.startTime) >= startDate &&
        a.status === AppointmentStatus.FINISHED &&
        !a.isPlan &&                              // exclude plan appointments
        a.source !== BookingSource.PLAN &&        // exclude plan source too
        (!professionalId || a.professional_id === professionalId)
      );
      const res: any = {
        totalRevenue: 0, totalExpenses: 0,
        [PaymentMethod.MONEY]: 0, [PaymentMethod.PIX]: 0,
        [PaymentMethod.DEBIT]: 0, [PaymentMethod.CREDIT]: 0
      };
      filtered.forEach(a => {
        res.totalRevenue += (a.amountPaid || 0);
        if (a.paymentMethod) res[a.paymentMethod] = (res[a.paymentMethod] || 0) + (a.amountPaid || 0);
      });
      return res;
    } catch (err) {
      console.error("Error getting financial summary:", err);
      return { totalRevenue: 0, totalExpenses: 0 };
    }
  }

  async getGlobalStats() {
    try {
      const tenants = await this.getAllTenants();
      const active = tenants.filter(t => t.status === TenantStatus.ACTIVE);
      const nowMonth = new Date().toISOString().slice(0, 7);
      const newThisMonth = tenants.filter(t => t.createdAt?.startsWith(nowMonth)).length;

      // Global appointments aggregation
      const { data: appts } = await supabase
        .from('appointments')
        .select('status, amount_paid');
      const allAppts = appts || [];
      const totalAppts = allAppts.length;
      const grossBilling = allAppts
        .filter((a: any) => a.status === 'FINALIZADO' || a.status === 'FINISHED' || a.status === 'CONCLUIDO')
        .reduce((s: number, a: any) => s + Number(a.amount_paid || 0), 0);

      // Customers count
      const { count: totalCustomers } = await supabase
        .from('customers')
        .select('id', { count: 'exact', head: true });

      return {
        totalTenants: tenants.length,
        activeTenants: active.length,
        mrr: active.reduce((acc, t) => acc + (t.monthlyFee || 0), 0),
        globalVolume: grossBilling,
        totalAppts,
        newThisMonth,
        totalCustomers: totalCustomers || 0,
        byStatus: Object.fromEntries(
          Object.values(TenantStatus).map(s => [s, tenants.filter(t => t.status === s).length])
        ),
      };
    } catch (err) {
      console.error("Error getting global stats:", err);
      return {
        totalTenants: 0, activeTenants: 0, mrr: 0, globalVolume: 0,
        totalAppts: 0, newThisMonth: 0, totalCustomers: 0, byStatus: {}
      };
    }
  }

  async getExpenses(tenantId: string, _period?: number, _professionalId?: string): Promise<Expense[]> {
    try {
      const { data, error } = await supabase.from('expenses').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(e => ({
        id: e.id,
        tenant_id: e.tenant_id,
        description: e.description,
        amount: Number(e.amount),
        category: e.category,
        professional_id: e.professional_id,
        date: e.date,
        paymentMethod: e.payment_method || undefined
      }));
    } catch (err) {
      console.error("Error fetching expenses:", err);
      return [];
    }
  }

  async addExpense(exp: any) {
    try {
      const { error } = await supabase.from('expenses').insert({
        tenant_id: exp.tenant_id,
        description: exp.description,
        amount: exp.amount,
        category: exp.category,
        professional_id: exp.professional_id,
        date: exp.date || new Date().toISOString(),
        payment_method: exp.paymentMethod || null
      });
      if (error) throw error;
    } catch (e) {
      console.error("Error adding expense:", e);
      throw e;
    }
  }

  async getCoverImage(_tenantId: string): Promise<string> { return ''; }
  async setCoverImage(_tenantId: string, _url: string) {}

  // ─── INVENTORY ──────────────────────────────────────────────────────

  async getInventory(tenantId: string): Promise<InventoryItem[]> {
    const s = await this.getSettings(tenantId);
    return s.inventory || [];
  }

  async addInventoryItem(tenantId: string, item: Omit<InventoryItem, 'id' | 'lastUpdated'>): Promise<InventoryItem> {
    const s = await this.getSettings(tenantId);
    const newItem: InventoryItem = { ...item, id: generateId(), lastUpdated: new Date().toISOString() };
    await this.updateSettings(tenantId, { inventory: [...(s.inventory || []), newItem] });
    return newItem;
  }

  async updateInventoryItem(tenantId: string, id: string, updates: Partial<InventoryItem>): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.inventory || []).map(i =>
      i.id === id ? { ...i, ...updates, lastUpdated: new Date().toISOString() } : i
    );
    await this.updateSettings(tenantId, { inventory: updated });
  }

  async deleteInventoryItem(tenantId: string, id: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    await this.updateSettings(tenantId, { inventory: (s.inventory || []).filter(i => i.id !== id) });
  }

  async addStockEntry(tenantId: string, id: string, qty: number, cost: number): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.inventory || []).map(i =>
      i.id === id
        ? { ...i, quantity: i.quantity + qty, purchaseCost: cost, lastUpdated: new Date().toISOString() }
        : i
    );
    await this.updateSettings(tenantId, { inventory: updated });
  }

  // ── Comanda (ordem de serviço) ─────────────────────────────────────
  // Supabase-first with localStorage fallback (key: agz_comandas_<tenantId>)

  private _lsComandaKey(tenantId: string) { return `agz_comandas_${tenantId}`; }

  private _nextComandaNumber(tenantId: string): number {
    const key = `agz_comanda_counter_${tenantId}`;
    const n = parseInt(localStorage.getItem(key) || '0') + 1;
    try { localStorage.setItem(key, String(n)); } catch {}
    return n;
  }

  private _lsGetComandas(tenantId: string): Comanda[] {
    try { return JSON.parse(localStorage.getItem(this._lsComandaKey(tenantId)) || '[]'); }
    catch { return []; }
  }

  private _lsSaveComandas(tenantId: string, list: Comanda[]) {
    try { localStorage.setItem(this._lsComandaKey(tenantId), JSON.stringify(list)); } catch {}
  }

  private _rowToComanda(r: any): Comanda {
    return {
      id: r.id,
      tenant_id: r.tenant_id,
      appointment_id: r.appointment_id,
      professional_id: r.professional_id,
      customer_id: r.customer_id,
      items: r.items || [],
      status: r.status,
      paymentMethod: r.payment_method ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.created_at || r.createdAt,
      closedAt: r.closed_at ?? r.closedAt ?? undefined,
      number: r.number ?? undefined,
    } as Comanda;
  }

  async createComanda(data: Omit<Comanda, 'id' | 'createdAt'>): Promise<Comanda> {
    const number = this._nextComandaNumber(data.tenant_id);
    const comanda: Comanda = { ...data, id: generateId(), createdAt: new Date().toISOString(), number };
    try {
      const { error } = await supabase.from('comandas').insert({
        id: comanda.id,
        tenant_id: comanda.tenant_id,
        appointment_id: comanda.appointment_id,
        professional_id: comanda.professional_id,
        customer_id: comanda.customer_id,
        items: comanda.items,
        status: comanda.status,
        payment_method: comanda.paymentMethod ?? null,
        notes: comanda.notes ?? null,
        created_at: comanda.createdAt,
        closed_at: comanda.closedAt ?? null,
        number: comanda.number ?? null,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.warn('[Comandas] Supabase insert failed, using localStorage:', err);
      const list = this._lsGetComandas(comanda.tenant_id);
      list.unshift(comanda);
      this._lsSaveComandas(comanda.tenant_id, list);
    }
    return comanda;
  }

  async getComandas(tenantId: string): Promise<Comanda[]> {
    try {
      const { data, error } = await supabase
        .from('comandas')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const supabaseList = (data || []).map((r: any) => this._rowToComanda(r));
      // Merge with localStorage (in case some were created offline)
      const local = this._lsGetComandas(tenantId);
      const supabaseIds = new Set(supabaseList.map(c => c.id));
      const onlyLocal = local.filter(c => !supabaseIds.has(c.id));
      return [...onlyLocal, ...supabaseList];
    } catch (err) {
      console.warn('[Comandas] Supabase fetch failed, using localStorage:', err);
      return this._lsGetComandas(tenantId);
    }
  }

  async getComanda(id: string): Promise<Comanda | null> {
    try {
      const { data } = await supabase.from('comandas').select('*').eq('id', id).maybeSingle();
      if (data) return this._rowToComanda(data);
    } catch {}
    // Fallback: search localStorage across all tenants
    const keys = Object.keys(localStorage).filter(k => k.startsWith('agz_comandas_'));
    for (const k of keys) {
      try {
        const list: Comanda[] = JSON.parse(localStorage.getItem(k) || '[]');
        const found = list.find(c => c.id === id);
        if (found) return found;
      } catch {}
    }
    return null;
  }

  async updateComanda(id: string, updates: Partial<Comanda>): Promise<void> {
    // Update in localStorage first (works offline)
    const keys = Object.keys(localStorage).filter(k => k.startsWith('agz_comandas_'));
    for (const k of keys) {
      try {
        const list: Comanda[] = JSON.parse(localStorage.getItem(k) || '[]');
        const idx = list.findIndex(c => c.id === id);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updates };
          localStorage.setItem(k, JSON.stringify(list));
        }
      } catch {}
    }
    // Try Supabase
    try {
      const patch: Record<string, any> = {};
      if (updates.items !== undefined)         patch.items          = updates.items;
      if (updates.status !== undefined)        patch.status         = updates.status;
      if (updates.paymentMethod !== undefined) patch.payment_method = updates.paymentMethod;
      if (updates.notes !== undefined)         patch.notes          = updates.notes;
      if (updates.closedAt !== undefined)      patch.closed_at      = updates.closedAt;
      const { error } = await supabase.from('comandas').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    } catch (err) {
      console.warn('[Comandas] Supabase update failed, localStorage updated only:', err);
    }
  }

  async decrementInventory(tenantId: string, itemId: string, qty: number): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.inventory || []).map(i =>
      i.id === itemId
        ? { ...i, quantity: Math.max(0, i.quantity - qty), lastUpdated: new Date().toISOString() }
        : i
    );
    await this.updateSettings(tenantId, { inventory: updated });
  }

  // ─── PRODUCTS (retail products for sale to clients) ──────────────────

  async getProducts(tenantId: string): Promise<Product[]> {
    const s = await this.getSettings(tenantId);
    return s.products || [];
  }

  async addProduct(tenantId: string, item: Omit<Product, 'id' | 'lastUpdated'>): Promise<Product> {
    const s = await this.getSettings(tenantId);
    const newItem: Product = { ...item, id: generateId(), lastUpdated: new Date().toISOString() };
    await this.updateSettings(tenantId, { products: [...(s.products || []), newItem] });
    return newItem;
  }

  async updateProduct(tenantId: string, id: string, updates: Partial<Product>): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.products || []).map(p =>
      p.id === id ? { ...p, ...updates, lastUpdated: new Date().toISOString() } : p
    );
    await this.updateSettings(tenantId, { products: updated });
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    await this.updateSettings(tenantId, { products: (s.products || []).filter(p => p.id !== id) });
  }

  async decrementProduct(tenantId: string, itemId: string, qty: number): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.products || []).map(p =>
      p.id === itemId && p.quantity !== undefined
        ? { ...p, quantity: Math.max(0, p.quantity - qty), lastUpdated: new Date().toISOString() }
        : p
    );
    await this.updateSettings(tenantId, { products: updated });
  }

  // ─── FOCUS NFE CONFIG ───────────────────────────────────────────────

  async getFocusNfeConfig(tenantId: string): Promise<FocusNfeConfig | null> {
    const s = await this.getSettings(tenantId);
    return s.focusNfeConfig ?? null;
  }

  async saveFocusNfeConfig(tenantId: string, cfg: FocusNfeConfig): Promise<void> {
    await this.updateSettings(tenantId, { focusNfeConfig: cfg });
  }

  // ─── NOTAS FISCAIS (NFS-e) ──────────────────────────────────────────

  async getNotasFiscais(tenantId: string): Promise<NotaFiscal[]> {
    const s = await this.getSettings(tenantId);
    return s.notasFiscais ?? [];
  }

  async saveNotaFiscal(tenantId: string, nota: NotaFiscal): Promise<void> {
    const s = await this.getSettings(tenantId);
    const existing = s.notasFiscais ?? [];
    const idx = existing.findIndex(n => n.id === nota.id);
    const updated = idx >= 0
      ? existing.map(n => n.id === nota.id ? nota : n)
      : [...existing, nota];
    await this.updateSettings(tenantId, { notasFiscais: updated });
  }

  // ─── ADIANTAMENTOS ──────────────────────────────────────────────────

  async getAdiantamentos(tenantId: string): Promise<Adiantamento[]> {
    const s = await this.getSettings(tenantId);
    return s.adiantamentos ?? [];
  }

  async addAdiantamento(tenantId: string, a: Omit<Adiantamento, 'id' | 'createdAt'>): Promise<Adiantamento> {
    const s = await this.getSettings(tenantId);
    const newA: Adiantamento = { ...a, id: generateId(), createdAt: new Date().toISOString() };
    await this.updateSettings(tenantId, { adiantamentos: [...(s.adiantamentos ?? []), newA] });
    return newA;
  }

  async deleteAdiantamento(tenantId: string, id: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    await this.updateSettings(tenantId, { adiantamentos: (s.adiantamentos ?? []).filter(a => a.id !== id) });
  }

  // ─── PAGAMENTOS PROFISSIONAL ────────────────────────────────────────

  async getPagamentosPro(tenantId: string): Promise<PagamentoPro[]> {
    const s = await this.getSettings(tenantId);
    return s.pagamentosPro ?? [];
  }

  async addPagamentoPro(tenantId: string, p: Omit<PagamentoPro, 'id' | 'createdAt'>): Promise<PagamentoPro> {
    const s = await this.getSettings(tenantId);
    const newP: PagamentoPro = { ...p, id: generateId(), createdAt: new Date().toISOString() };
    await this.updateSettings(tenantId, { pagamentosPro: [...(s.pagamentosPro ?? []), newP] });
    return newP;
  }

  async updatePagamentoPro(tenantId: string, id: string, updates: Partial<PagamentoPro>): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.pagamentosPro ?? []).map(p => p.id === id ? { ...p, ...updates } : p);
    await this.updateSettings(tenantId, { pagamentosPro: updated });
  }

  // ── Cross-process message deduplication ───────────────────────────
  // Uses the msg_dedup table (PRIMARY KEY = fingerprint) for atomic claims.
  // Only ONE process/tab/server can successfully INSERT a given fingerprint.
  // Returns true  → this caller claimed the message (should process it).
  // Returns false → another process already claimed it (skip processing).
  // Fails open: if the table doesn't exist or any unexpected error occurs,
  // returns true so the message is still processed (avoids silent drops).
  //
  // Required SQL (run once in Supabase SQL Editor):
  //   CREATE TABLE IF NOT EXISTS msg_dedup (fp text PRIMARY KEY, ts timestamptz DEFAULT now());
  async claimMessage(fp: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('msg_dedup').insert({ fp });
      if (error?.code === '23505') return false; // unique violation — already claimed
      if (error) return true; // table missing or other error — fail open
      // Fire-and-forget: prune entries older than 2 minutes to keep the table small
      void Promise.resolve(
        supabase.from('msg_dedup').delete().lt('ts', new Date(Date.now() - 120_000).toISOString())
      ).catch(() => {});
      return true;
    } catch {
      return true; // unexpected error — fail open
    }
  }

  // ─── Global Config (SuperAdmin-only, shared across all tenants) ─────────────
  // SQL (run once): CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT);
  private readonly GLOBAL_LS_KEY = 'agz_global_cfg';

  async getGlobalConfig(): Promise<Record<string, string>> {
    try {
      const { data } = await supabase.from('global_settings').select('key, value');
      if (data && data.length > 0) {
        return Object.fromEntries(data.map((r: any) => [r.key, r.value]));
      }
    } catch {}
    try {
      const raw = localStorage.getItem(this.GLOBAL_LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  }

  async saveGlobalConfig(updates: Record<string, string>): Promise<void> {
    try {
      const rows = Object.entries(updates).map(([key, value]) => ({ key, value }));
      await supabase.from('global_settings').upsert(rows);
    } catch {}
    // Always persist to localStorage too (works offline / before table is created)
    try {
      const current = await this.getGlobalConfig();
      localStorage.setItem(this.GLOBAL_LS_KEY, JSON.stringify({ ...current, ...updates }));
    } catch {}
  }

  // ─── WHATSAPP MESSAGES — PERSISTENT HISTORY ──────────────────────────
  // Table: whatsapp_messages (see supabase/migrations/whatsapp_messages.sql)

  async saveWaMessages(tenantId: string, messages: Array<{
    msg_id: string; phone: string; direction: 'in' | 'out';
    body: string; msg_type: string; push_name: string;
    from_me: boolean; ts: number; raw?: any;
  }>): Promise<void> {
    if (!messages.length) return;
    try {
      const rows = messages.map(m => ({
        msg_id:    m.msg_id,
        tenant_id: tenantId,
        phone:     m.phone,
        direction: m.direction,
        body:      m.body      || '',
        msg_type:  m.msg_type  || 'text',
        push_name: m.push_name || '',
        from_me:   m.from_me,
        ts:        m.ts,
        raw:       m.raw || {},
      }));
      await supabase
        .from('whatsapp_messages')
        .upsert(rows, { onConflict: 'tenant_id,msg_id', ignoreDuplicates: true });
    } catch (e) { console.error('[mockDb] saveWaMessages error:', e); }
  }

  async getWaMessages(tenantId: string, sinceDays = 365): Promise<any[]> {
    try {
      const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('ts', since)
        .order('ts', { ascending: false })
        .limit(10000);
      // Reverse so messages are in chronological order (oldest → newest)
      return (data || []).reverse();
    } catch (e) {
      console.error('[mockDb] getWaMessages error:', e);
      return [];
    }
  }

  // ─── SUPPORT CHAT (bidirectional) ────────────────────────────────────

  async getSupportMessages(tenantId: string): Promise<SupportMessage[]> {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        sender: r.sender as 'tenant' | 'support',
        content: r.content ?? undefined,
        imageUrl: r.image_url ?? undefined,
        read: r.read,
        createdAt: r.created_at,
      }));
    } catch (e) {
      console.error('[mockDb] getSupportMessages error:', e);
      return [];
    }
  }

  async sendTenantSupportMessage(tenantId: string, content: string, imageUrl?: string): Promise<void> {
    try {
      const { error } = await supabase.from('support_messages').insert({
        tenant_id: tenantId,
        sender: 'tenant',
        content: content || null,
        image_url: imageUrl || null,
        read: false,
      });
      if (error) throw error;
    } catch (e) {
      console.error('[mockDb] sendTenantSupportMessage error:', e);
      throw e;
    }
  }

  async sendSupportReply(tenantId: string, content: string, imageUrl?: string): Promise<void> {
    try {
      const { error } = await supabase.from('support_messages').insert({
        tenant_id: tenantId,
        sender: 'support',
        content: content || null,
        image_url: imageUrl || null,
        read: false,
      });
      if (error) throw error;
    } catch (e) {
      console.error('[mockDb] sendSupportReply error:', e);
      throw e;
    }
  }

  async markSupportRead(tenantId: string, sender: 'tenant' | 'support'): Promise<void> {
    try {
      await supabase
        .from('support_messages')
        .update({ read: true })
        .eq('tenant_id', tenantId)
        .eq('sender', sender)
        .eq('read', false);
    } catch (e) {
      console.error('[mockDb] markSupportRead error:', e);
    }
  }

  async getAllSupportChats(): Promise<Array<{
    tenantId: string; tenantName: string; lastMessage: string;
    lastAt: string; unreadCount: number;
  }>> {
    try {
      const [{ data: messages }, { data: tenants }] = await Promise.all([
        supabase.from('support_messages').select('tenant_id, sender, content, image_url, read, created_at').order('created_at', { ascending: false }),
        supabase.from('tenants').select('id, nome'),
      ]);
      const tenantMap: Record<string, string> = Object.fromEntries((tenants || []).map(t => [t.id, t.nome || 'Desconhecido']));
      const grouped: Record<string, { lastMessage: string; lastAt: string; unreadCount: number }> = {};
      for (const m of (messages || [])) {
        if (!grouped[m.tenant_id]) {
          grouped[m.tenant_id] = {
            lastMessage: m.content || (m.image_url ? '📷 Imagem' : ''),
            lastAt: m.created_at,
            unreadCount: 0,
          };
        }
        if (!m.read && m.sender === 'tenant') grouped[m.tenant_id].unreadCount++;
      }
      return Object.entries(grouped).map(([tenantId, v]) => ({
        tenantId,
        tenantName: tenantMap[tenantId] || 'Desconhecido',
        ...v,
      })).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    } catch (e) {
      console.error('[mockDb] getAllSupportChats error:', e);
      return [];
    }
  }

  // ─── CONVERSATION LOGS (auto-training) ──────────────────────────────

  async logConversation(
    tenantId: string,
    phone: string,
    outcome: 'booked' | 'abandoned' | 'info',
    history: Array<{ role: string; text: string }>,
    startedAt?: string
  ): Promise<void> {
    try {
      await supabase.from('conversation_logs').insert({
        tenant_id: tenantId,
        phone,
        outcome,
        turns: history.filter(h => h.role === 'user').length,
        history,
        started_at: startedAt || new Date().toISOString(),
      });
    } catch (e) {
      console.error('[mockDb] logConversation error:', e);
    }
  }

  async getConversationLogs(tenantId: string, sinceDays = 7): Promise<ConversationLog[]> {
    try {
      const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
      const { data, error } = await supabase
        .from('conversation_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        phone: r.phone,
        outcome: r.outcome as 'booked' | 'abandoned' | 'info',
        turns: r.turns,
        history: r.history || [],
        startedAt: r.started_at ?? undefined,
        createdAt: r.created_at,
      }));
    } catch (e) {
      console.error('[mockDb] getConversationLogs error:', e);
      return [];
    }
  }

  async deleteConversationLog(id: string): Promise<void> {
    try {
      await supabase.from('conversation_logs').delete().eq('id', id);
    } catch (e) {
      console.error('[mockDb] deleteConversationLog error:', e);
    }
  }

  async updateConversationLog(id: string, updates: { outcome?: ConversationLog['outcome']; adminNote?: string }): Promise<void> {
    try {
      const payload: Record<string, any> = {};
      if (updates.outcome) payload.outcome = updates.outcome;
      if (updates.adminNote !== undefined) payload.admin_note = updates.adminNote;
      await supabase.from('conversation_logs').update(payload).eq('id', id);
    } catch (e) {
      console.error('[mockDb] updateConversationLog error:', e);
    }
  }

  async uploadSupportImage(tenantId: string, file: File): Promise<string> {
    const path = `${tenantId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error } = await supabase.storage.from('support-images').upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('support-images').getPublicUrl(path);
    return data.publicUrl;
  }
}

export const db = new DatabaseService();
