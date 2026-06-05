ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS creator_role TEXT CHECK (creator_role IN ('BUYER', 'SELLER'));

ALTER TABLE public.deals ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE public.deals ALTER COLUMN seller_id DROP NOT NULL;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_status_check CHECK (status IN (
  'AWAITING_COUNTERPARTY', 'AWAITING_PAYMENT', 'IN_ESCROW', 'DELIVERED', 'COMPLETED',
  'DISPUTED', 'REFUNDED', 'CANCELLED'
));

ALTER TABLE public.deals ALTER COLUMN status SET DEFAULT 'AWAITING_COUNTERPARTY';

DROP POLICY IF EXISTS "Authenticated users can create deals" ON public.deals;
CREATE POLICY "Authenticated users can create deals" ON public.deals
  FOR INSERT WITH CHECK (
    (auth.uid() = buyer_id OR auth.uid() = seller_id) AND
    public.get_user_role() IN ('buyer', 'seller', 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_deals_share_token ON public.deals(share_token);
CREATE INDEX IF NOT EXISTS idx_deals_creator_role ON public.deals(creator_role);
