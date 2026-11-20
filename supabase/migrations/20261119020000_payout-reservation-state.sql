-- ============================================================================
-- Migration: 20261119020000_payout-reservation-state.sql
-- Purpose: Add atomic payout reservation state, persistent transfer references,
--          and concurrency protection to prevent double payouts.
--
-- Problem:
--   The previous confirm-delivery implementation checked audit logs for existing
--   payouts, but a race condition existed between checking the log and executing
--   the Paystack transfer call. Two simultaneous requests could both pass the
--   check and both initiate real-money transfers.
--
-- Solution:
--   1. Add `payout_status` on `deals`: tracks durable state machine transitions:
--      (RESERVED, PROCESSING, SUCCESS, FAILED, PENDING_VERIFICATION).
--   2. Add `payout_reference` on `deals`: persists the unique Paystack transfer
--      reference BEFORE initiating any HTTP call, enabling deterministic recovery.
--   3. Add `reserve_payout()` stored procedure: uses PostgreSQL `SELECT ... FOR UPDATE`
--      row-level locking to guarantee that exactly ONE concurrent request can claim
--      the payout reservation.
--   4. Add `finalize_payout()` stored procedure: atomically updates final deal
--      and payout statuses.
-- ============================================================================

-- 1. Add payout_status column with CHECK constraint
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS payout_status TEXT DEFAULT NULL
  CHECK (payout_status IS NULL OR payout_status IN (
    'RESERVED',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'PENDING_VERIFICATION'
  ));

-- 2. Add payout_reference column to persist the unique Paystack transfer reference
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS payout_reference TEXT;

-- 3. Indexes for fast lookups and idempotency queries
CREATE INDEX IF NOT EXISTS idx_deals_payout_status
  ON public.deals(payout_status);

CREATE INDEX IF NOT EXISTS idx_deals_payout_reference
  ON public.deals(payout_reference);

-- 4. Atomic payout reservation function with row-level locking
CREATE OR REPLACE FUNCTION public.reserve_payout(
  p_deal_id UUID,
  p_payout_reference TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_deal RECORD;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.reserve_payout(UUID, TEXT) IS
  'Atomically reserves a payout on a deal using SELECT FOR UPDATE row locking, preventing concurrent double payouts.';

-- 5. Atomic payout finalization function
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.finalize_payout(UUID, TEXT, TEXT) IS
  'Atomically updates the deal status and payout_status after a Paystack transfer result is determined.';
