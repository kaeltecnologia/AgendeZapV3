-- ============================================================
-- Atualização Central — SQL Migrations
-- ============================================================

-- 1. Tabela de avaliações
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  appointment_id TEXT,
  rating INT CHECK (rating >= 0 AND rating <= 10),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_tenant_idx ON reviews(tenant_id);
ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;

-- 2. Novos campos nos tenants (endereço + marketplace)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS latitude FLOAT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS longitude FLOAT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_visible BOOLEAN DEFAULT false;

-- 3. Leads do marketplace/central
CREATE TABLE IF NOT EXISTS marketplace_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  city TEXT,
  nicho_interest TEXT,
  source TEXT DEFAULT 'central_whatsapp',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketplace_leads ADD COLUMN IF NOT EXISTS latitude FLOAT;
ALTER TABLE marketplace_leads ADD COLUMN IF NOT EXISTS longitude FLOAT;
ALTER TABLE marketplace_leads DISABLE ROW LEVEL SECURITY;

-- 4. Agendamentos feitos via Central
CREATE TABLE IF NOT EXISTS central_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_phone TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  cashback_earned NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE central_bookings DISABLE ROW LEVEL SECURITY;

-- 5. Saldo de cashback por telefone
CREATE TABLE IF NOT EXISTS cashback_balance (
  phone TEXT PRIMARY KEY,
  balance NUMERIC DEFAULT 0,
  total_earned NUMERIC DEFAULT 0,
  total_used NUMERIC DEFAULT 0,
  bookings_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cashback_balance DISABLE ROW LEVEL SECURITY;

-- 6. Contador de visitas do marketplace por tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_views INT DEFAULT 0;

-- 7. Posts do marketplace (feed social)
CREATE TABLE IF NOT EXISTS marketplace_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  cidade TEXT,
  nicho TEXT,
  likes_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mp_posts_created_idx ON marketplace_posts(created_at DESC);
ALTER TABLE marketplace_posts DISABLE ROW LEVEL SECURITY;

-- 8. Curtidas nos posts
CREATE TABLE IF NOT EXISTS marketplace_post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES marketplace_posts(id) ON DELETE CASCADE,
  liker_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(post_id, liker_id)
);
ALTER TABLE marketplace_post_likes DISABLE ROW LEVEL SECURITY;

-- 9. Comentários nos posts
CREATE TABLE IF NOT EXISTS marketplace_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES marketplace_posts(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketplace_post_comments DISABLE ROW LEVEL SECURITY;
