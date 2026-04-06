-- Fix "Database error saving new user": profile INSERT from auth.users trigger
-- must bypass RLS and have schema/table access for supabase_auth_admin.

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT ALL ON TABLE public.profiles TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_email text;
BEGIN
  -- RLS on public.profiles can still block inserts from the auth transaction;
  -- this runs as the function owner (postgres) and disables RLS for this statement chain.
  SET LOCAL row_security = off;

  user_email := COALESCE(
    NULLIF(trim(NEW.email), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'email'), '')
  );
  IF user_email IS NULL OR user_email = '' THEN
    user_email := replace(NEW.id::text, '-', '') || '@noemail.accountengine.internal';
  END IF;

  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, user_email)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
