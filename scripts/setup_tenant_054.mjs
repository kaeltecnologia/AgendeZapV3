// Script de setup completo — tenant #054 (Jennifer liz manicure)
// Uso: node scripts/setup_tenant_054.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const SUPABASE_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';
const CSV_PATH = 'C:/Users/mathe/Downloads/776-CLIENTE/cliente_dados.csv';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Serviços da Jennifer (preço mais frequente de cada um) ───
const SERVICES = [
  { name: 'Esmaltação em Gel',               price: 75,  durationMinutes: 60  },
  { name: 'Esmaltação em Gel Mão e Pé',      price: 120, durationMinutes: 90  },
  { name: 'Manutenção',                       price: 100, durationMinutes: 60  },
  { name: 'Manutenção e Pé Normal',           price: 140, durationMinutes: 90  },
  { name: 'Manutenção e Pé em Gel',           price: 150, durationMinutes: 90  },
  { name: 'Manicure e Pedicure',              price: 60,  durationMinutes: 60  },
  { name: 'Pedicure',                         price: 40,  durationMinutes: 45  },
  { name: 'Manicure',                         price: 40,  durationMinutes: 45  },
  { name: 'Esmaltação em Gel Pé',             price: 80,  durationMinutes: 60  },
  { name: 'Alongamento',                      price: 150, durationMinutes: 120 },
  { name: 'Banho de Gel',                     price: 100, durationMinutes: 60  },
];

// ─── Horário de atendimento: Seg-Sáb 8:00-19:00 ───
const OPERATING_HOURS = {
  0: { active: false, range: '08:00-19:00' }, // Domingo
  1: { active: true,  range: '08:00-19:00' }, // Segunda
  2: { active: true,  range: '08:00-19:00' }, // Terça
  3: { active: true,  range: '08:00-19:00' }, // Quarta
  4: { active: true,  range: '08:00-19:00' }, // Quinta
  5: { active: true,  range: '08:00-19:00' }, // Sexta
  6: { active: true,  range: '08:00-19:00' }, // Sábado
};

// ─── Parse CSV com separador ";" ───
function parseClientesDados(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const rows = lines.slice(1); // pular cabeçalho
  return rows.map(line => {
    const parts = line.split(';');
    const nome = (parts[1] || '').trim() || (parts[2] || '').trim();
    const telefone = (parts[3] || '').replace(/\D/g, '');
    const email = (parts[8] || '').trim() || null;
    const nascimento = (parts[11] || '').trim() || null;
    return { nome, telefone, email, nascimento };
  }).filter(r => r.nome && r.telefone && r.telefone.length >= 10);
}

async function main() {
  // ─── 1. Encontrar tenant #054 ───
  console.log('🔍 Buscando tenant #054...');
  const { data: tenants, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, nome, slug, plan')
    .order('created_at', { ascending: true })
    .range(53, 53); // índice 53 = 54ª linha (0-based)

  if (tenantErr || !tenants?.length) {
    console.error('❌ Erro ao buscar tenant:', tenantErr);
    process.exit(1);
  }

  const tenant = tenants[0];
  console.log(`✅ Tenant: ${tenant.nome} (${tenant.slug}) — ID: ${tenant.id}`);

  // ─── 2. Atualizar dados básicos do tenant ───
  console.log('\n📝 Atualizando dados do tenant...');
  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ nome: 'Jennifer liz manicure', plan: 'PROFISSIONAL' })
    .eq('id', tenant.id);

  if (updateErr) console.error('⚠️  Erro ao atualizar tenant:', updateErr.message);
  else console.log('✅ Nome e plano atualizados');

  // ─── 3. Configurar tenant_settings ───
  console.log('\n⚙️  Configurando tenant_settings...');

  // Buscar follow_up existente para não sobrescrever
  const { data: existing } = await supabase
    .from('tenant_settings')
    .select('follow_up')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const existingFollowUp = existing?.follow_up || {};

  const { error: settingsErr } = await supabase
    .from('tenant_settings')
    .upsert({
      tenant_id: tenant.id,
      operating_hours: OPERATING_HOURS,
      ai_active: true,
      theme_color: '#ec4899', // rosa — ideal para nail designer
      follow_up: {
        ...existingFollowUp,
        _whatsapp: '41991025625',
        aviso: existingFollowUp.aviso || {
          active: true,
          message: 'Olá {nome}! 👋 Passando para avisar que amanhã você tem horário às {hora} com a Jennifer. Qualquer dúvida, é só chamar! 💅',
          timing: 1440, // 24h antes
        },
        lembrete: existingFollowUp.lembrete || {
          active: true,
          message: 'Oi {nome}! 😊 Só lembrando do seu horário HOJE às {hora} com a Jennifer. Te espero! 💅',
          timing: 120, // 2h antes
        },
        reativacao: existingFollowUp.reativacao || {
          active: true,
          message: 'Oi {nome}! Faz um tempinho que você não passa por aqui. 🥰 Que tal agendar um horário? Temos vagas disponíveis! 💅',
          timing: 30, // dias
        },
      },
    }, { onConflict: 'tenant_id' });

  if (settingsErr) console.error('⚠️  Erro nas settings:', settingsErr.message);
  else console.log('✅ Settings configuradas (horário seg-sáb 8h-19h, WhatsApp, IA ativa)');

  // ─── 4. Criar profissional Jennifer ───
  console.log('\n👩 Configurando profissional Jennifer...');

  // Verificar se já existe
  const { data: existingProfs } = await supabase
    .from('professionals')
    .select('id, name')
    .eq('tenant_id', tenant.id);

  const jenniferExists = existingProfs?.find(p =>
    p.name.toLowerCase().includes('jennifer')
  );

  if (jenniferExists) {
    console.log(`✅ Profissional já existe: ${jenniferExists.name} (${jenniferExists.id})`);
  } else {
    const { data: profData, error: profErr } = await supabase
      .from('professionals')
      .insert({
        tenant_id: tenant.id,
        nome: 'Jennifer Liz Machado de Jesus',
        phone: '41991025625',
        especialidade: 'Manicure e Nail Designer',
        ativo: true,
      })
      .select()
      .single();

    if (profErr) console.error('⚠️  Erro ao criar profissional:', profErr.message);
    else console.log('✅ Profissional Jennifer criada');
  }

  // ─── 5. Criar serviços ───
  console.log('\n💅 Criando serviços...');

  // Buscar serviços existentes para evitar duplicatas
  const { data: existingServices } = await supabase
    .from('services')
    .select('name')
    .eq('tenant_id', tenant.id);

  const existingNames = new Set((existingServices || []).map(s => s.name.toLowerCase()));

  let svcsOk = 0, svcsSkip = 0;
  for (const svc of SERVICES) {
    if (existingNames.has(svc.name.toLowerCase())) {
      svcsSkip++;
      continue;
    }
    const { error } = await supabase.from('services').insert({
      tenant_id: tenant.id,
      nome: svc.name,
      preco: svc.price,
      duracao_minutos: svc.durationMinutes,
      ativo: true,
    });
    if (error) console.error(`  ⚠️  Serviço "${svc.name}":`, error.message);
    else svcsOk++;
  }
  console.log(`✅ Serviços: ${svcsOk} criados, ${svcsSkip} já existiam`);

  // ─── 6. Importar clientes ───
  console.log('\n👥 Importando clientes...');
  const raw = readFileSync(CSV_PATH, 'latin1');
  const customers = parseClientesDados(raw);
  console.log(`   CSV: ${customers.length} clientes válidos`);

  // Buscar telefones já existentes
  let existingPhones = new Set();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await supabase
      .from('customers')
      .select('telefone')
      .eq('tenant_id', tenant.id)
      .range(from, from + PAGE - 1);
    if (!page?.length) break;
    page.forEach(r => existingPhones.add(r.telefone));
    if (page.length < PAGE) break;
    from += PAGE;
  }
  console.log(`   Existentes no banco: ${existingPhones.size}`);

  const toInsert = customers.filter(c => !existingPhones.has(c.telefone));
  console.log(`   A inserir (novos): ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('   ℹ️  Nenhum cliente novo para inserir.');
  } else {
    const BATCH = 200;
    let ok = 0, fail = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH).map(c => ({
        tenant_id: tenant.id,
        nome: c.nome,
        telefone: c.telefone,
        ...(c.email ? { email: c.email } : {}),
        ...(c.nascimento ? { data_nascimento: c.nascimento } : {}),
      }));
      const { error } = await supabase.from('customers').insert(batch);
      if (error) {
        // tenta individualmente
        for (const row of batch) {
          const { error: e2 } = await supabase.from('customers').insert(row);
          if (!e2) ok++; else fail++;
        }
      } else {
        ok += batch.length;
      }
      process.stdout.write(`\r   ${ok} inseridos, ${fail} erros...`);
    }
    console.log(`\n✅ Clientes: ${ok} inseridos, ${fail} erros`);
  }

  console.log('\n🎉 Setup do tenant #054 concluído!');
  console.log(`   Tenant ID: ${tenant.id}`);
  console.log('   Acesse o painel SuperAdmin para conferir.');
}

main().catch(err => { console.error(err); process.exit(1); });
