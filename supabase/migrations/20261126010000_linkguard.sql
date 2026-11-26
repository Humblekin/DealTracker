-- ============================================================
-- LinkGuard: Automatic Link Verification & Anti-Phishing
-- ============================================================
-- Adds cryptographic token hashing (SHA-256), link expiration
-- and revocation columns, updates get_shared_deal() and
-- protect_deal_mutations(), and provides verify_deal_link()
-- and revoke_deal_link() server-side functions.
-- ============================================================

-- 1. Add link lifecycle & token-hash columns to deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS share_token_hash TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS link_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_revoked     BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deals_share_token_hash
  ON public.deals(share_token_hash);

COMMENT ON COLUMN public.deals.share_token_hash IS
  'SHA-256 hex digest of the share_token used for backend link verification';
COMMENT ON COLUMN public.deals.link_expires_at IS
  'UTC timestamp after which the share link is no longer valid';
COMMENT ON COLUMN public.deals.link_revoked IS
  'Set to true by admin or creator to immediately invalidate the share link';

-- 2. Backfill existing deals safely (controlled migration):
--    - Compute SHA-256 hash for all existing non-null share_token rows
--    - Give existing AWAITING_COUNTERPARTY deals a 7-day expiration window
UPDATE public.deals
  SET share_token_hash = encode(sha256(convert_to(lower(share_token), 'UTF8')), 'hex')
  WHERE share_token IS NOT NULL
    AND share_token_hash IS NULL;

UPDATE public.deals
  SET link_expires_at = NOW() + INTERVAL '7 days'
  WHERE status = 'AWAITING_COUNTERPARTY'
    AND link_expires_at IS NULL;

-- 3. Update protect_deal_mutations() to generate share_token_hash and
--    link lifecycle defaults on INSERT, and protect them from client UPDATE.
CREATE OR REPLACE FUNCTION public.protect_deal_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transfer_fee NUMERIC(12, 2);
  v_platform_fee NUMERIC(12, 2);
  v_user_role TEXT;
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NOT (
      (NEW.creator_role = 'BUYER' AND NEW.buyer_id = auth.uid()) OR
      (NEW.creator_role = 'SELLER' AND NEW.seller_id = auth.uid())
    ) THEN
      RAISE EXCEPTION 'A deal must be created by its declared creator';
    END IF;

    IF NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Deal amount must be positive';
    END IF;

    NEW.buyer_id := CASE WHEN NEW.creator_role = 'BUYER' THEN auth.uid() ELSE NULL END;
    NEW.seller_id := CASE WHEN NEW.creator_role = 'SELLER' THEN auth.uid() ELSE NULL END;
    NEW.status := 'AWAITING_COUNTERPARTY';
    NEW.payment_status := 'INITIALIZED';
    NEW.payment_reference := NULL;
    NEW.paystack_reference := NULL;
    NEW.payout_status := NULL;
    NEW.payout_reference := NULL;
    NEW.share_token := gen_random_uuid()::TEXT;
    NEW.share_token_hash := encode(sha256(convert_to(lower(NEW.share_token), 'UTF8')), 'hex');

    -- LinkGuard: set default expiration (7 days) and ensure not revoked
    NEW.link_expires_at := NOW() + INTERVAL '7 days';
    NEW.link_revoked := false;

    v_transfer_fee := CASE
      WHEN NEW.amount <= 100 THEN 1
      WHEN NEW.amount <= 500 THEN 3
      WHEN NEW.amount <= 2000 THEN 5
      ELSE 8
    END;
    v_platform_fee := greatest(5, least(NEW.amount * 0.02, 50));
    NEW.platform_fee := round(v_platform_fee, 2);
    NEW.net_amount := round(NEW.amount - v_transfer_fee, 2);
    NEW.fee_breakdown := jsonb_build_object(
      'dealAmount', round(NEW.amount, 2),
      'processingFee', 0,
      'platformFee', round(v_platform_fee, 2),
      'transferFee', v_transfer_fee,
      'totalPayable', round(NEW.amount + v_platform_fee, 2),
      'sellerReceives', round(NEW.amount - v_transfer_fee, 2)
    );
    RETURN NEW;
  END IF;

  -- UPDATE path: block client mutations on sensitive columns
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.creator_role IS DISTINCT FROM OLD.creator_role
    OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
    OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.share_token IS DISTINCT FROM OLD.share_token
    OR NEW.share_token_hash IS DISTINCT FROM OLD.share_token_hash
    OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
    OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
    OR NEW.fee_breakdown IS DISTINCT FROM OLD.fee_breakdown
    OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paystack_reference IS DISTINCT FROM OLD.paystack_reference
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.payout_status IS DISTINCT FROM OLD.payout_status
    OR NEW.payout_reference IS DISTINCT FROM OLD.payout_reference
    OR NEW.link_expires_at IS DISTINCT FROM OLD.link_expires_at
    OR NEW.link_revoked IS DISTINCT FROM OLD.link_revoked
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Financial and deal-state fields can only be changed by trusted server workflows';
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid();
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
    IF v_user_role <> 'admin' AND NOT (
      OLD.status = 'AWAITING_COUNTERPARTY' AND
      (auth.uid() = OLD.buyer_id OR auth.uid() = OLD.seller_id)
    ) THEN
      RAISE EXCEPTION 'Only an administrator or deal creator may edit contract text before joining';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. verify_deal_link() — core LinkGuard verification function
--    Restricted to service_role only (called via verify-link Edge Function)
--    so callers cannot bypass Edge Function domain checks and rate limiting.
CREATE OR REPLACE FUNCTION public.verify_deal_link(
  p_share_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal RECORD;
  v_normalized_token TEXT;
  v_token_hash TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'verify_deal_link may only be executed by trusted server functions';
  END IF;

  -- 1. Token format validation — must be a valid UUID
  v_normalized_token := lower(trim(coalesce(p_share_token, '')));
  IF length(v_normalized_token) <> 36
    OR v_normalized_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'invalid_token',
      'message', 'We couldn''t authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link.'
    );
  END IF;

  -- 2. Hash token with SHA-256 and look up the deal by hash
  v_token_hash := encode(sha256(convert_to(v_normalized_token, 'UTF8')), 'hex');

  SELECT
    id, title, amount, status, creator_role,
    link_expires_at, link_revoked
  INTO v_deal
  FROM public.deals
  WHERE share_token_hash = v_token_hash;

  -- 3. Not found
  IF v_deal IS NULL THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'not_found',
      'message', 'We couldn''t authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link.'
    );
  END IF;

  -- 4. Revoked
  IF v_deal.link_revoked THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'revoked',
      'deal_id', v_deal.id,
      'message', 'This transaction link has expired or is no longer active. Please contact the sender for a valid link.'
    );
  END IF;

  -- 5. Expired
  IF v_deal.link_expires_at IS NOT NULL AND v_deal.link_expires_at < NOW() THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'expired',
      'deal_id', v_deal.id,
      'message', 'This transaction link has expired or is no longer active. Please contact the sender for a valid link.'
    );
  END IF;

  -- 6. Terminal deal states — link is no longer actionable
  IF v_deal.status IN ('CANCELLED', 'COMPLETED', 'REFUNDED') THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'closed',
      'deal_id', v_deal.id,
      'deal_status', v_deal.status,
      'message', 'This transaction has been ' || lower(v_deal.status) || ' and this link is no longer active.'
    );
  END IF;

  -- 7. Disputed — link is suspended
  IF v_deal.status = 'DISPUTED' THEN
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'suspended',
      'deal_id', v_deal.id,
      'deal_status', v_deal.status,
      'message', 'This transaction is currently under administrative review.'
    );
  END IF;

  -- 8. Verified — return minimal safe preview info (no buyer/seller PII or payment refs)
  RETURN jsonb_build_object(
    'verified', true,
    'reason', 'valid',
    'deal_id', v_deal.id,
    'deal_title', v_deal.title,
    'deal_amount', v_deal.amount,
    'deal_status', v_deal.status,
    'creator_role', v_deal.creator_role,
    'message', 'Verified DealGuider Transaction. This link has been authenticated by DealGuider.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_deal_link(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_deal_link(TEXT) TO service_role;

-- 5. Harden get_shared_deal() so direct RPC callers cannot bypass LinkGuard
--    revocation, expiration, or terminal-state restrictions.
CREATE OR REPLACE FUNCTION public.get_shared_deal(p_share_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'description', d.description,
    'amount', d.amount,
    'creator_role', d.creator_role,
    'buyer_id', d.buyer_id,
    'seller_id', d.seller_id,
    'status', d.status,
    'buyer_name', buyer.full_name,
    'seller_name', seller.full_name
  )
  FROM public.deals d
  LEFT JOIN public.profiles buyer ON buyer.id = d.buyer_id
  LEFT JOIN public.profiles seller ON seller.id = d.seller_id
  WHERE d.share_token_hash = encode(sha256(convert_to(lower(trim(coalesce(p_share_token, ''))), 'UTF8')), 'hex')
    AND d.link_revoked = false
    AND (d.link_expires_at IS NULL OR d.link_expires_at > NOW())
    AND d.status NOT IN ('CANCELLED', 'COMPLETED', 'REFUNDED', 'DISPUTED');
$$;

REVOKE ALL ON FUNCTION public.get_shared_deal(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_deal(TEXT) TO service_role;

-- 6. revoke_deal_link() — allows admin or deal creator to revoke a link
CREATE OR REPLACE FUNCTION public.revoke_deal_link(
  p_deal_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal RECORD;
  v_caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT id, buyer_id, seller_id, link_revoked, status
  INTO v_deal
  FROM public.deals
  WHERE id = p_deal_id;

  IF v_deal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  IF v_deal.link_revoked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link already revoked');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(
    v_caller_role = 'admin'
    OR auth.uid() = v_deal.buyer_id
    OR auth.uid() = v_deal.seller_id,
    false
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE public.deals
    SET link_revoked = true
    WHERE id = p_deal_id;

  INSERT INTO public.audit_logs (deal_id, action, actor_id, details)
  VALUES (p_deal_id, 'LINK_REVOKED', auth.uid(), jsonb_build_object(
    'revoked_by', auth.uid(),
    'deal_status', v_deal.status
  ));

  RETURN jsonb_build_object('success', true, 'message', 'Link revoked successfully');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_deal_link(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_deal_link(UUID) TO authenticated;
