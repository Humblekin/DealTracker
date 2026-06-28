-- ============================================
-- DealGuider – Merchant Integration Tables
-- Escrow-as-a-Service for e-commerce platforms
-- ============================================

-- 1. MERCHANTS TABLE
CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  platform_url TEXT,
  webhook_url TEXT,
  webhook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MERCHANT API KEYS
CREATE TABLE IF NOT EXISTS public.merchant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
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

-- RLS (safe to re-run)
DO $$ BEGIN
  ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.merchant_api_keys ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.merchant_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.merchant_webhook_logs ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Policies (idempotent – skipped if already exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can view merchants') THEN
    CREATE POLICY "Admins can view merchants" ON public.merchants FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can insert merchants') THEN
    CREATE POLICY "Admins can insert merchants" ON public.merchants FOR INSERT WITH CHECK (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can update merchants') THEN
    CREATE POLICY "Admins can update merchants" ON public.merchants FOR UPDATE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can delete merchants') THEN
    CREATE POLICY "Admins can delete merchants" ON public.merchants FOR DELETE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can view API keys') THEN
    CREATE POLICY "Admins can view API keys" ON public.merchant_api_keys FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can manage API keys') THEN
    CREATE POLICY "Admins can manage API keys" ON public.merchant_api_keys FOR INSERT WITH CHECK (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can update API keys') THEN
    CREATE POLICY "Admins can update API keys" ON public.merchant_api_keys FOR UPDATE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can delete API keys') THEN
    CREATE POLICY "Admins can delete API keys" ON public.merchant_api_keys FOR DELETE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_transactions' AND policyname = 'Admins can view merchant transactions') THEN
    CREATE POLICY "Admins can view merchant transactions" ON public.merchant_transactions FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_webhook_logs' AND policyname = 'Admins can view webhook logs') THEN
    CREATE POLICY "Admins can view webhook logs" ON public.merchant_webhook_logs FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

-- Triggers (idempotent)
DROP TRIGGER IF EXISTS update_merchants_updated_at ON public.merchants;
CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_merchant_transactions_updated_at ON public.merchant_transactions;
CREATE TRIGGER update_merchant_transactions_updated_at BEFORE UPDATE ON public.merchant_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
