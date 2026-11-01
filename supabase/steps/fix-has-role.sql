-- ============================================================
-- NORDEVA chhoti FIX — Step 8 ke baad, Step 9 se pehle chalao
-- Sirf 1 line hai. Iske bina bina-login wale visitors ko
-- Categories dikhne me error aata hai.
-- ============================================================
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon;
