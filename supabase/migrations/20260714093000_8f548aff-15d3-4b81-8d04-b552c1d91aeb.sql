
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  meta_username TEXT;
  meta_display TEXT;
BEGIN
  meta_username := NULLIF(NEW.raw_user_meta_data->>'username', '');
  meta_display := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    meta_username,
    split_part(NEW.email, '@', 1)
  );

  -- Only accept a username that matches the format rule; ignore silently otherwise
  IF meta_username IS NOT NULL AND meta_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    meta_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (NEW.id, NEW.email, meta_display, meta_username)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  -- Username taken: create the profile without it so the account still works
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, meta_display)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Ensure the trigger exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
