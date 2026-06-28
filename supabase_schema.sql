-- ============================================
-- DealGuider – Supabase Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. PROFILES TABLE (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
  wallet_balance DECIMAL(12,2) DEFAULT 0,
  phone TEXT,
  network TEXT CHECK (network IN ('mtn', 'vodafone', 'tigo')),
  recipient_code TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DEALS TABLE
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  creator_role TEXT NOT NULL CHECK (creator_role IN ('BUYER', 'SELLER')),
  buyer_id UUID REFERENCES public.profiles(id),
  seller_id UUID REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'AWAITING_COUNTERPARTY' CHECK (status IN (
    'AWAITING_COUNTERPARTY', 'AWAITING_PAYMENT', 'IN_ESCROW', 'DELIVERED', 'COMPLETED',
    'DISPUTED', 'REFUNDED', 'CANCELLED'
  )),
  share_token TEXT UNIQUE,
  net_amount DECIMAL(12,2) DEFAULT 0,
  platform_fee DECIMAL(12,2) DEFAULT 0,
  fee_breakdown JSONB,
  payment_reference TEXT,
  moolre_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id),
  moolre_reference TEXT,
  amount DECIMAL(12,2) NOT NULL,
  fee_breakdown JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. DISPUTES TABLE
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id),
  opened_by UUID REFERENCES public.profiles(id),
  reason TEXT NOT NULL,
  evidence TEXT[],
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'CLOSED')),
  admin_decision TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  deal_id UUID REFERENCES public.deals(id),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. AUDIT LOGS TABLE (immutable)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id),
  action TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'buyer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMP
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- PROFILES POLICIES ----
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE USING (public.get_user_role() = 'admin');

-- ---- DEALS POLICIES ----
CREATE POLICY "Users can view own deals" ON public.deals
  FOR SELECT USING (
    auth.uid() = buyer_id OR
    auth.uid() = seller_id OR
    public.get_user_role() = 'admin'
  );

CREATE POLICY "Authenticated users can create deals" ON public.deals
  FOR INSERT WITH CHECK (
    (auth.uid() = buyer_id OR auth.uid() = seller_id) AND
    public.get_user_role() IN ('buyer', 'seller', 'admin')
  );

CREATE POLICY "Authorized users can update deals" ON public.deals
  FOR UPDATE USING (
    auth.uid() = buyer_id OR
    auth.uid() = seller_id OR
    public.get_user_role() = 'admin'
  );

CREATE POLICY "Anyone can view shared deals" ON public.deals
  FOR SELECT USING (share_token IS NOT NULL);

CREATE POLICY "Admins can delete deals" ON public.deals
  FOR DELETE USING (public.get_user_role() = 'admin');

-- ⚠️ STATUS TRANSITIONS are enforced by Edge Functions (service role key).
-- The frontend can only update deals via edge functions for critical transitions:
--   AWAITING_COUNTERPARTY → AWAITING_PAYMENT (join-deal, counterparty joins)
--   AWAITING_PAYMENT → IN_ESCROW (moolre-webhook, system)
--   IN_ESCROW → DELIVERED (confirm-delivery, buyer confirms)
--   DELIVERED → COMPLETED (confirm-delivery, auto payout)
--   AWAITING_COUNTERPARTY / AWAITING_PAYMENT → CANCELLED (frontend via RLS)
--   IN_ESCROW → DISPUTED (frontend via RLS)
--   DISPUTED → REFUNDED (admin only via RLS)
-- The service role key bypasses RLS, so edge functions can perform any transition.

-- ---- PAYMENTS POLICIES ----
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = payments.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    ) OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Buyers can insert payments" ON public.payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_id AND deals.buyer_id = auth.uid()
    ) OR public.get_user_role() = 'admin'
  );

-- ---- DISPUTES POLICIES ----
CREATE POLICY "Users can view own disputes" ON public.disputes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = disputes.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    ) OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Users can create disputes" ON public.disputes
  FOR INSERT WITH CHECK (
    auth.uid() = opened_by
  );

CREATE POLICY "Admins can update disputes" ON public.disputes
  FOR UPDATE USING (
    public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can delete disputes" ON public.disputes
  FOR DELETE USING (public.get_user_role() = 'admin');

-- ---- NOTIFICATIONS POLICIES ----
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications" ON public.notifications
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ---- AUDIT LOGS POLICIES ----
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT USING (
    public.get_user_role() = 'admin' OR
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = audit_logs.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert own audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (
    auth.uid() = actor_id OR public.get_user_role() = 'admin'
  );

-- Prevent updates/deletes on audit logs (immutable)
CREATE POLICY "No updates on audit logs" ON public.audit_logs
  FOR UPDATE USING (false);

CREATE POLICY "No deletes on audit logs" ON public.audit_logs
  FOR DELETE USING (false);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON public.deals(buyer_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON public.deals(seller_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_share_token ON public.deals(share_token);
CREATE INDEX IF NOT EXISTS idx_deals_creator_role ON public.deals(creator_role);
CREATE INDEX IF NOT EXISTS idx_payments_deal ON public.payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_disputes_deal ON public.disputes(deal_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_deal ON public.audit_logs(deal_id);

-- ============================================
-- MERCHANT INTEGRATION TABLES
-- Escrow-as-a-Service for e-commerce platforms
-- ============================================

-- 1. MERCHANTS TABLE
CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  platform_url TEXT,
  webhook_url TEXT,
  webhook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED')),
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MERCHANT API KEYS
CREATE TABLE IF NOT EXISTS public.merchant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  permissions JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MERCHANT TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.merchant_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id),
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  merchant_order_id TEXT NOT NULL,
  merchant_customer_id TEXT,
  customer_email TEXT,
  customer_name TEXT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT DEFAULT 'GHS',
  platform_fee DECIMAL(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'AWAITING_PAYMENT', 'IN_ESCROW', 'SHIPPED', 'DELIVERED',
    'COMPLETED', 'DISPUTED', 'REFUNDED', 'CANCELLED'
  )),
  idempotency_key TEXT UNIQUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  moolre_payment_url TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, merchant_order_id)
);

-- 4. WEBHOOK DELIVERY LOG
CREATE TABLE IF NOT EXISTS public.merchant_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id),
  transaction_id UUID REFERENCES public.merchant_transactions(id),
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  payload JSONB,
  response_status INT,
  response_body TEXT,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_merchant ON public.merchant_api_keys(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_api_keys_prefix ON public.merchant_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_merchant ON public.merchant_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_deal ON public.merchant_transactions(deal_id);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_order ON public.merchant_transactions(merchant_id, merchant_order_id);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_idempotency ON public.merchant_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_status ON public.merchant_transactions(status);
CREATE INDEX IF NOT EXISTS idx_merchant_webhook_logs_merchant ON public.merchant_webhook_logs(merchant_id);

-- RLS
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_webhook_logs ENABLE ROW LEVEL SECURITY;

-- Merchants: admins can view/manage; merchant owners can view their own
CREATE POLICY "Admins can view merchants" ON public.merchants
  FOR SELECT USING (public.get_user_role() = 'admin');

CREATE POLICY "Merchants can view own" ON public.merchants
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert merchants" ON public.merchants
  FOR INSERT WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update merchants" ON public.merchants
  FOR UPDATE USING (public.get_user_role() = 'admin');

CREATE POLICY "Merchants can update own" ON public.merchants
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete merchants" ON public.merchants
  FOR DELETE USING (public.get_user_role() = 'admin');

-- API Keys: admins can view/manage; merchants can view own
CREATE POLICY "Admins can view API keys" ON public.merchant_api_keys
  FOR SELECT USING (public.get_user_role() = 'admin');

CREATE POLICY "Merchants can view own API keys" ON public.merchant_api_keys
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.merchants
      WHERE merchants.id = merchant_api_keys.merchant_id
      AND merchants.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage API keys" ON public.merchant_api_keys
  FOR INSERT WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update API keys" ON public.merchant_api_keys
  FOR UPDATE USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete API keys" ON public.merchant_api_keys
  FOR DELETE USING (public.get_user_role() = 'admin');

-- Transactions: admins can view all; edge functions using service role bypass RLS
CREATE POLICY "Admins can view merchant transactions" ON public.merchant_transactions
  FOR SELECT USING (public.get_user_role() = 'admin');

-- Webhook logs: admins can view
CREATE POLICY "Admins can view webhook logs" ON public.merchant_webhook_logs
  FOR SELECT USING (public.get_user_role() = 'admin');

-- Auto-update updated_at
CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_merchant_transactions_updated_at BEFORE UPDATE ON public.merchant_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
