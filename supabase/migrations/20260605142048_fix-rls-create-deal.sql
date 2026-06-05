DROP POLICY IF EXISTS "Buyers can create deals" ON public.deals;
CREATE POLICY "Authenticated users can create deals" ON public.deals
  FOR INSERT WITH CHECK (
    auth.uid() = buyer_id AND
    public.get_user_role() IN ('buyer', 'seller', 'admin')
  );
