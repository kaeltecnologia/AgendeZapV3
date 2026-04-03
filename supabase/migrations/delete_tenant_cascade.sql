-- ================================================================
-- AgendeZap — RPC: delete_tenant_cascade
--
-- Execute no Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql
--
-- Função SECURITY DEFINER que deleta um tenant e TODOS os dados
-- relacionados em uma única transação. Bypassa RLS.
-- ================================================================

CREATE OR REPLACE FUNCTION public.delete_tenant_cascade(p_tenant_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Tabelas com tenant_id (ordem: dependências primeiro)
  DELETE FROM whatsapp_messages  WHERE tenant_id = p_tenant_id;
  DELETE FROM agent_sessions     WHERE tenant_id = p_tenant_id;
  DELETE FROM appointments       WHERE tenant_id = p_tenant_id;
  DELETE FROM customers          WHERE tenant_id = p_tenant_id;
  DELETE FROM professionals      WHERE tenant_id = p_tenant_id;
  DELETE FROM services           WHERE tenant_id = p_tenant_id;
  DELETE FROM expenses           WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant_settings    WHERE tenant_id = p_tenant_id;
  DELETE FROM support_requests   WHERE tenant_id = p_tenant_id;
  DELETE FROM reviews            WHERE tenant_id = p_tenant_id;
  DELETE FROM central_bookings   WHERE tenant_id = p_tenant_id;
  DELETE FROM marketplace_posts  WHERE tenant_id = p_tenant_id;
  DELETE FROM customer_favorites WHERE tenant_id = p_tenant_id;
  DELETE FROM comandas           WHERE tenant_id = p_tenant_id;

  -- Finalmente, o tenant
  DELETE FROM tenants WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % não encontrado', p_tenant_id;
  END IF;
END;
$$;

-- Permitir que anon chame a função (SuperAdmin usa anon key)
GRANT EXECUTE ON FUNCTION public.delete_tenant_cascade(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.delete_tenant_cascade(TEXT) TO authenticated;
