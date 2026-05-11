// Script de importação de clientes — tenant #043
// Uso: node scripts/import_customers.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SUPABASE_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';
const CSV_PATH = 'C:/Users/mathe/Downloads/Base_de_Cliente_Magnatas_Sem_Letra.csv';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Normaliza telefone: remove tudo que não for dígito
function normalizePhone(raw) {
  return raw.replace(/\D/g, '');
}

// Parse CSV simples (encoding pode ter latin-1, lida com isso)
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  // Pula cabeçalho
  const rows = lines.slice(1);
  return rows.map(line => {
    const parts = line.split(',');
    const nome = (parts[0] || '').trim();
    const telefone = normalizePhone((parts[1] || '').trim());
    return { nome, telefone };
  }).filter(r => r.nome && r.telefone);
}

async function main() {
  // 1) Encontrar tenant #043 (43ª linha por created_at ou id sequencial)
  console.log('Buscando tenant #043...');
  const { data: tenants, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, nome, slug')
    .order('created_at', { ascending: true })
    .range(42, 42); // índice 42 = 43ª linha (0-based)

  if (tenantErr || !tenants?.length) {
    console.error('Erro ao buscar tenant:', tenantErr);
    process.exit(1);
  }

  const tenant = tenants[0];
  console.log(`Tenant encontrado: ${tenant.nome} (${tenant.slug}) — ID: ${tenant.id}`);

  // 2) Parse CSV
  const raw = readFileSync(CSV_PATH, 'latin1');
  const customers = parseCSV(raw);
  console.log(`Clientes no CSV: ${customers.length}`);

  // 3) Buscar telefones já existentes para evitar duplicatas
  console.log('Buscando clientes existentes...');
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
  console.log(`Clientes já existentes: ${existingPhones.size}`);

  // 4) Filtrar apenas novos
  const toInsert = customers.filter(c => !existingPhones.has(c.telefone));
  console.log(`A inserir (novos): ${toInsert.length}`);

  if (!toInsert.length) {
    console.log('Nenhum cliente novo para inserir.');
    return;
  }

  // 5) Inserir em lotes de 200
  const BATCH = 200;
  let ok = 0, fail = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map(c => ({
      tenant_id: tenant.id,
      nome: c.nome,
      telefone: c.telefone,
    }));
    const { error } = await supabase.from('customers').insert(batch);
    if (error) {
      console.error(`Lote ${i}-${i+BATCH} falhou:`, error.message);
      // tenta individualmente
      for (const row of batch) {
        const { error: e2 } = await supabase.from('customers').insert(row);
        if (!e2) ok++; else fail++;
      }
    } else {
      ok += batch.length;
    }
    process.stdout.write(`\r${ok} inseridos, ${fail} erros...`);
  }

  console.log(`\n\nConcluído! ✅ ${ok} inseridos, ❌ ${fail} erros`);
}

main().catch(err => { console.error(err); process.exit(1); });
