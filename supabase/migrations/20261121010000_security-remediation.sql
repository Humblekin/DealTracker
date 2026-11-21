-- Restrict client mutations and access to sensitive rows. Payment and payout
-- state transitions remain in service-role Edge Functions.

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin')
    OR coalesce(auth.jwt() ->> 'role' = 'service_role', false);
$$;

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view profiles" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Anyone can view shared deals" ON public.deals;
DROP POLICY IF EXISTS "Users can view own deals" ON public.deals;
CREATE POLICY "Users can view own deals" ON public.deals
  FOR SELECT USING (
    auth.uid() = buyer_id OR
    auth.uid() = seller_id OR
    public.get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Buyers can insert payments" ON public.payments;

DROP POLICY IF EXISTS "Users can create disputes" ON public.disputes;

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

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.creator_role IS DISTINCT FROM OLD.creator_role
    OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
    OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.share_token IS DISTINCT FROM OLD.share_token
    OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
    OR NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
    OR NEW.fee_breakdown IS DISTINCT FROM OLD.fee_breakdown
    OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paystack_reference IS DISTINCT FROM OLD.paystack_reference
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.payout_status IS DISTINCT FROM OLD.payout_status
    OR NEW.payout_reference IS DISTINCT FROM OLD.payout_reference
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

DROP TRIGGER IF EXISTS protect_deal_mutations ON public.deals;
CREATE TRIGGER protect_deal_mutations
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.protect_deal_mutations();

CREATE OR REPLACE FUNCTION public.protect_merchant_approval_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_service_role() OR public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.webhook_secret IS DISTINCT FROM OLD.webhook_secret THEN
    RAISE EXCEPTION 'Merchant approval and ownership fields are administrator-managed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_merchant_approval_fields ON public.merchants;
CREATE TRIGGER protect_merchant_approval_fields
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.protect_merchant_approval_fields();

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
  WHERE d.share_token = p_share_token;
$$;

REVOKE ALL ON FUNCTION public.get_shared_deal(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_deal(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_deal_party_names(p_deal_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() = d.buyer_id OR auth.uid() = d.seller_id
      OR public.get_user_role() = 'admin'
    THEN jsonb_build_object(
      'buyer_name', buyer.full_name,
      'seller_name', seller.full_name
    )
    ELSE NULL
  END
  FROM public.deals d
  LEFT JOIN public.profiles buyer ON buyer.id = d.buyer_id
  LEFT JOIN public.profiles seller ON seller.id = d.seller_id
  WHERE d.id = p_deal_id;
$$;

REVOKE ALL ON FUNCTION public.get_deal_party_names(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deal_party_names(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_deal_action(
  p_deal_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may apply deal actions';
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;
  IF p_actor_id IS NULL OR (
    p_actor_id IS DISTINCT FROM v_deal.buyer_id AND
    p_actor_id IS DISTINCT FROM v_deal.seller_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a deal participant may perform this action');
  END IF;

  IF p_action = 'cancel' THEN
    IF v_deal.status NOT IN ('AWAITING_COUNTERPARTY', 'AWAITING_PAYMENT')
      OR v_deal.payment_status IN ('PENDING', 'PROCESSING', 'SUCCESS') THEN
      RETURN jsonb_build_object('success', false, 'error', 'This deal cannot be cancelled while payment is processing or secured');
    END IF;

    UPDATE public.deals SET status = 'CANCELLED', updated_at = NOW() WHERE id = p_deal_id;
    INSERT INTO public.audit_logs (deal_id, action, actor_id, details)
    VALUES (p_deal_id, 'DEAL_CANCELLED', p_actor_id, '{}'::JSONB);
    RETURN jsonb_build_object('success', true, 'status', 'CANCELLED');
  ELSIF p_action = 'dispute' THEN
    IF v_deal.status <> 'IN_ESCROW' OR length(trim(coalesce(p_reason, ''))) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only an escrowed deal can be disputed, and a reason is required');
    END IF;

    INSERT INTO public.disputes (deal_id, reason, opened_by, status)
    VALUES (p_deal_id, trim(p_reason), p_actor_id, 'OPEN');
    UPDATE public.deals SET status = 'DISPUTED', updated_at = NOW() WHERE id = p_deal_id;
    INSERT INTO public.audit_logs (deal_id, action, actor_id, details)
    VALUES (p_deal_id, 'DISPUTE_OPENED', p_actor_id, jsonb_build_object('reason', trim(p_reason)));
    RETURN jsonb_build_object('success', true, 'status', 'DISPUTED');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unsupported deal action');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_deal_action(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_deal_action(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_refund_deal(
  p_deal_id UUID,
  p_actor_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may refund a deal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only administrators may refund deals');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;
  IF v_deal.status NOT IN ('IN_ESCROW', 'DELIVERED', 'DISPUTED')
    OR v_deal.payout_status IN ('RESERVED', 'PROCESSING', 'SUCCESS', 'PENDING_VERIFICATION') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal is not eligible for refund');
  END IF;

  UPDATE public.deals SET status = 'REFUNDED', updated_at = NOW() WHERE id = p_deal_id;
  UPDATE public.disputes
  SET status = 'RESOLVED', admin_decision = 'Refunded to buyer'
  WHERE deal_id = p_deal_id AND status = 'OPEN';
  INSERT INTO public.audit_logs (deal_id, action, actor_id, details)
  VALUES (
    p_deal_id,
    'ADMIN_MANUAL_REFUND',
    p_actor_id,
    jsonb_build_object('note', coalesce(p_note, 'Admin confirmed manual refund sent'))
  );
  RETURN jsonb_build_object('success', true, 'status', 'REFUNDED');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_deal(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_deal(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_admin_payout(
  p_deal_id UUID,
  p_payout_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may reserve payouts';
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;
  IF v_deal.status NOT IN ('IN_ESCROW', 'DELIVERED', 'DISPUTED')
    OR v_deal.payout_status IN ('RESERVED', 'PROCESSING', 'SUCCESS', 'PENDING_VERIFICATION')
    OR v_deal.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal is not eligible for payout');
  END IF;

  UPDATE public.deals
  SET payout_reference = p_payout_reference,
      payout_status = 'PROCESSING',
      updated_at = NOW()
  WHERE id = p_deal_id;

  RETURN jsonb_build_object('success', true, 'reference', p_payout_reference);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_admin_payout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_admin_payout(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_payout(
  p_deal_id UUID,
  p_new_payout_status TEXT,
  p_new_deal_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_target_status TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may finalize payouts';
  END IF;
  IF p_new_payout_status NOT IN ('SUCCESS', 'FAILED', 'PROCESSING', 'PENDING_VERIFICATION') THEN
    RAISE EXCEPTION 'Invalid payout status';
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;
  IF v_deal.payout_status = 'SUCCESS' AND p_new_payout_status <> 'SUCCESS' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A successful payout cannot be downgraded');
  END IF;

  v_target_status := CASE
    WHEN p_new_payout_status = 'SUCCESS' THEN 'COMPLETED'
    WHEN p_new_deal_status IS NOT NULL THEN p_new_deal_status
    ELSE v_deal.status
  END;

  UPDATE public.deals
  SET payout_status = p_new_payout_status,
      status = v_target_status,
      updated_at = NOW()
  WHERE id = p_deal_id;

  RETURN jsonb_build_object('success', true, 'status', v_target_status, 'payout_status', p_new_payout_status);
END;
$$;

ALTER TABLE public.merchant_transactions
  ADD COLUMN IF NOT EXISTS payout_status TEXT
    CHECK (payout_status IS NULL OR payout_status IN (
      'RESERVED', 'PROCESSING', 'SUCCESS', 'FAILED', 'PENDING_VERIFICATION'
    )),
  ADD COLUMN IF NOT EXISTS payout_reference TEXT;

UPDATE public.merchant_api_keys
SET permissions = jsonb_build_object(
  'create_escrow', true,
  'verify_payment', true,
  'read_transactions', true,
  'confirm_shipment', true,
  'release_funds', true
) || CASE
  WHEN jsonb_typeof(permissions) = 'object' THEN permissions
  ELSE '{}'::JSONB
END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_transactions_payout_reference
  ON public.merchant_transactions(payout_reference)
  WHERE payout_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_merchant_payout(
  p_transaction_id UUID,
  p_payout_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.merchant_transactions%ROWTYPE;
  v_deal public.deals%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may reserve payouts';
  END IF;

  SELECT * INTO v_transaction
  FROM public.merchant_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_transaction.deal_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;

  SELECT * INTO v_deal
  FROM public.deals
  WHERE id = v_transaction.deal_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_transaction.status <> 'SHIPPED'
    OR v_deal.status <> 'DELIVERED'
    OR v_transaction.payout_status IN ('RESERVED', 'PROCESSING', 'SUCCESS', 'PENDING_VERIFICATION')
    OR v_deal.payout_status IN ('RESERVED', 'PROCESSING', 'SUCCESS', 'PENDING_VERIFICATION') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction is not eligible for payout');
  END IF;

  UPDATE public.merchant_transactions
  SET payout_status = 'RESERVED',
      payout_reference = p_payout_reference,
      updated_at = NOW()
  WHERE id = p_transaction_id;

  UPDATE public.deals
  SET payout_status = 'RESERVED',
      payout_reference = p_payout_reference,
      updated_at = NOW()
  WHERE id = v_deal.id;

  RETURN jsonb_build_object('success', true, 'reference', p_payout_reference);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_merchant_payout(
  p_transaction_id UUID,
  p_payout_reference TEXT,
  p_new_payout_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.merchant_transactions%ROWTYPE;
  v_deal public.deals%ROWTYPE;
  v_new_status TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Only trusted server workflows may finalize payouts';
  END IF;
  IF p_new_payout_status NOT IN ('PROCESSING', 'SUCCESS', 'FAILED', 'PENDING_VERIFICATION') THEN
    RAISE EXCEPTION 'Invalid payout status';
  END IF;

  SELECT * INTO v_transaction
  FROM public.merchant_transactions
  WHERE id = p_transaction_id AND payout_reference = p_payout_reference
  FOR UPDATE;
  IF NOT FOUND OR v_transaction.deal_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reserved merchant payout not found');
  END IF;
  IF v_transaction.payout_status = 'SUCCESS' AND p_new_payout_status <> 'SUCCESS' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A successful payout cannot be downgraded');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = v_transaction.deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  v_new_status := CASE
    WHEN p_new_payout_status = 'SUCCESS' THEN 'COMPLETED'
    ELSE 'SHIPPED'
  END;

  UPDATE public.merchant_transactions
  SET payout_status = p_new_payout_status,
      status = v_new_status,
      delivered_at = CASE WHEN p_new_payout_status = 'SUCCESS' THEN NOW() ELSE delivered_at END,
      updated_at = NOW()
  WHERE id = p_transaction_id;

  UPDATE public.deals
  SET payout_status = p_new_payout_status,
      status = CASE WHEN p_new_payout_status = 'SUCCESS' THEN 'COMPLETED' ELSE 'DELIVERED' END,
      updated_at = NOW()
  WHERE id = v_deal.id;

  RETURN jsonb_build_object('success', true, 'status', v_new_status, 'payout_status', p_new_payout_status);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_merchant_payout(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_merchant_payout(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_payout(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_merchant_payout(UUID, TEXT, TEXT) TO service_role;
