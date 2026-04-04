-- Atomic JSONB key update for tenant_settings.follow_up
-- Prevents race conditions when webhook and frontend write to follow_up concurrently
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/cnnfnqrnjckntnxdgwae/sql

-- Sets a single top-level key inside follow_up JSONB atomically
-- Usage: SELECT set_follow_up_key('tenant-uuid', '_customerData', '{"phone:123": {"aiPaused": true}}'::jsonb);
CREATE OR REPLACE FUNCTION set_follow_up_key(
  p_tenant_id UUID,
  p_key TEXT,
  p_value JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE tenant_settings
  SET follow_up = COALESCE(follow_up, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
  WHERE tenant_id = p_tenant_id;

  -- If no row was updated, insert one
  IF NOT FOUND THEN
    INSERT INTO tenant_settings (tenant_id, follow_up)
    VALUES (p_tenant_id, jsonb_build_object(p_key, p_value))
    ON CONFLICT (tenant_id)
    DO UPDATE SET follow_up = COALESCE(tenant_settings.follow_up, '{}'::jsonb) || jsonb_build_object(p_key, p_value);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sets a nested key inside _customerData atomically
-- This is the most common operation (human takeover, waitlist, etc.)
-- Usage: SELECT set_customer_data_key('tenant-uuid', 'customer-id', '{"aiPaused": true}'::jsonb);
CREATE OR REPLACE FUNCTION set_customer_data_key(
  p_tenant_id UUID,
  p_customer_key TEXT,
  p_value JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE tenant_settings
  SET follow_up = jsonb_set(
    COALESCE(follow_up, '{}'::jsonb),
    ARRAY['_customerData', p_customer_key],
    COALESCE(
      (COALESCE(follow_up, '{}'::jsonb) -> '_customerData' -> p_customer_key),
      '{}'::jsonb
    ) || p_value,
    true  -- create_if_missing
  )
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service_role (edge functions use this)
GRANT EXECUTE ON FUNCTION set_follow_up_key(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION set_customer_data_key(UUID, TEXT, JSONB) TO service_role;
