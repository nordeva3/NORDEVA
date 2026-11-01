DROP VIEW IF EXISTS public.listing_stats;
DROP VIEW IF EXISTS public.creator_stats;

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.listings l
SET sales_count = (SELECT count(*) FROM public.orders o WHERE o.listing_id = l.id AND o.status = 'completed');

CREATE OR REPLACE FUNCTION public.bump_listing_sales_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE public.listings SET sales_count = sales_count + 1 WHERE id = NEW.listing_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_listing_sales_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bump_listing_sales_count ON public.orders;
CREATE TRIGGER trg_bump_listing_sales_count
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.bump_listing_sales_count();