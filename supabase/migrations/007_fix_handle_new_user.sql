-- Harden profile creation on auth.users insert (fixes common Supabase
-- "Database error saving new user" when email is null/blank or search_path bites).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_email text;
BEGIN
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
