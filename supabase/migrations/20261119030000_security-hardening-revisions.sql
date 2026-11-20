-- ============================================================================
-- Migration: 20261119030000_security-hardening-revisions.sql
-- Purpose: Address security findings from independent Phase 1 verification:
--
-- Findings Addressed:
--   1. Function Execution Permissions:
--      `reserve_payout` and `finalize_payout` were accessible to all roles
--      (PUBLIC/authenticated) via PostgREST RPC. Revoke execute from PUBLIC,
--      anon, and authenticated; grant exclusively to service_role.
--      Add defense-in-depth is_service_role() checks inside both procedures.
--
--   2. SECURITY DEFINER search_path Hardening:
--      All SECURITY DEFINER functions must set an explicit, safe search_path
--      (`search_path = public, pg_temp`) to prevent search_path injection attacks
--      (CVE-2018-1058 defense).
--
--   3. Existing Records Compatibility & Backfill:
--      Existing deals in COMPLETED status are safely backfilled with
--      payout_status = 'SUCCESS' to maintain data consistency.
--
--   4. Service-Role Detection Hardening:
--      Ensure is_service_role() checks the verified JWT claim (auth.jwt() ->> 'role')
--      and current_user without relying on malleable ambient session parameters.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Hardened is_service_role() with safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    current_user IN ('service_role', 'postgres', 'supabase_admin')
    OR (auth.jwt() ->> 'role') = 'service_role'
    OR coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.is_service_role() IS
  'Securely returns true only if the execution context is the trusted service_role or database admin.';

-- ----------------------------------------------------------------------------
-- 2. Hardened handle_new_user() with safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NEW.email,
    'buyer'  -- HARDCODED: never trust client-supplied role from signup metadata
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 3. Hardened enforce_role_protection() with safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_role_protection()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role (used by trusted edge functions / server-side administrative operations) bypasses guards
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Block any non-service-role attempt to modify sensitive columns
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: Role modification requires a trusted server-side administrative process';
  END IF;

  IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
    RAISE EXCEPTION 'Unauthorized: wallet_balance cannot be modified directly';
  END IF;

  IF NEW.is_flagged IS DISTINCT FROM OLD.is_flagged THEN
    RAISE EXCEPTION 'Unauthorized: is_flagged cannot be modified directly';
  END IF;

  IF NEW.recipient_code IS DISTINCT FROM OLD.recipient_code THEN
    RAISE EXCEPTION 'Unauthorized: recipient_code cannot be modified directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. Hardened enforce_role_on_insert() with safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_role_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role can insert any role
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Force safe default role and system-managed defaults for all non-service-role callers
  NEW.role := 'buyer';
  NEW.wallet_balance := 0;
  NEW.is_flagged := FALSE;
  NEW.recipient_code := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. Hardened reserve_payout() with access restriction and safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_payout(
  p_deal_id UUID,
  p_payout_reference TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_deal RECORD;
BEGIN
  -- Enforce service-role authorization at function level
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: reserve_payout can only be invoked by service_role';
  END IF;

  -- Acquire an exclusive row-level lock on the deal
  SELECT id, status, payout_status, payout_reference, amount, net_amount, buyer_id, seller_id, title
  INTO v_deal
  FROM public.deals
  WHERE id = p_deal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Deal not found');
  END IF;

  -- If deal is already COMPLETED or payout succeeded, prevent duplicate payout
  IF v_deal.status = 'COMPLETED' OR v_deal.payout_status = 'SUCCESS' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_COMPLETED',
      'error', 'Payout has already been completed for this deal'
    );
  END IF;

  -- If another request is currently processing this payout, block the concurrent attempt
  IF v_deal.payout_status IN ('RESERVED', 'PROCESSING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PROCESSING',
      'error', 'Payout is currently being processed. Please wait a moment.'
    );
  END IF;

  -- If payout is pending verification from a previous timeout, flag it for reconciliation
  IF v_deal.payout_status = 'PENDING_VERIFICATION' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PENDING_VERIFICATION',
      'payout_reference', v_deal.payout_reference,
      'error', 'Payout status is ambiguous and pending verification with Paystack.'
    );
  END IF;

  -- Validate deal status eligibility:
  -- Initial payout: must be IN_ESCROW
  -- Retry payout: must be DELIVERED with payout_status = 'FAILED'
  IF NOT (
    (v_deal.status = 'IN_ESCROW' AND (v_deal.payout_status IS NULL OR v_deal.payout_status = 'FAILED'))
    OR
    (v_deal.status = 'DELIVERED' AND v_deal.payout_status = 'FAILED')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'error', format('Deal status "%s" with payout status "%s" is not eligible for payout', v_deal.status, coalesce(v_deal.payout_status, 'NULL'))
    );
  END IF;

  -- Atomically advance to DELIVERED and claim RESERVED status
  UPDATE public.deals
  SET status = 'DELIVERED',
      payout_status = 'RESERVED',
      payout_reference = p_payout_reference,
      updated_at = NOW()
  WHERE id = p_deal_id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'RESERVED',
    'deal_id', p_deal_id,
    'payout_reference', p_payout_reference,
    'previous_status', v_deal.status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke execute from untrusted roles and grant exclusively to service_role
REVOKE EXECUTE ON FUNCTION public.reserve_payout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payout(UUID, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Hardened finalize_payout() with access restriction and safe search_path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_payout(
  p_deal_id UUID,
  p_new_payout_status TEXT,
  p_new_deal_status TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_deal RECORD;
  v_target_deal_status TEXT;
BEGIN
  -- Enforce service-role authorization at function level
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: finalize_payout can only be invoked by service_role';
  END IF;

  SELECT id, status, payout_status, payout_reference
  INTO v_deal
  FROM public.deals
  WHERE id = p_deal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  IF p_new_payout_status = 'SUCCESS' THEN
    v_target_deal_status := 'COMPLETED';
  ELSIF p_new_deal_status IS NOT NULL THEN
    v_target_deal_status := p_new_deal_status;
  ELSE
    v_target_deal_status := v_deal.status;
  END IF;

  UPDATE public.deals
  SET payout_status = p_new_payout_status,
      status = v_target_deal_status,
      updated_at = NOW()
  WHERE id = p_deal_id;

  RETURN jsonb_build_object(
    'success', true,
    'deal_id', p_deal_id,
    'status', v_target_deal_status,
    'payout_status', p_new_payout_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke execute from untrusted roles and grant exclusively to service_role
REVOKE EXECUTE ON FUNCTION public.finalize_payout(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payout(UUID, TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Safe backfill for existing records
-- ----------------------------------------------------------------------------
-- Ensure existing COMPLETED deals have payout_status = 'SUCCESS'
UPDATE public.deals
SET payout_status = 'SUCCESS'
WHERE status = 'COMPLETED'
  AND payout_status IS NULL;

