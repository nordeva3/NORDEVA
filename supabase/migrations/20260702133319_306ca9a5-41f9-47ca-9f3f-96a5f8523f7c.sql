
DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
CREATE POLICY "buyers create own or anon orders" ON public.orders
  FOR INSERT WITH CHECK (
    (buyer_id IS NULL AND auth.uid() IS NULL)
    OR (buyer_id = auth.uid())
  );
