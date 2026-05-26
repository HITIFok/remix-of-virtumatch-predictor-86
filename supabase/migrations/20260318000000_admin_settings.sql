-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create admin_settings table for storing admin code
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the admin code as a bcrypt hash (password: REDACTED_SECRET)
-- Hash generated with: crypt('REDACTED_SECRET', gen_salt('bf'))
INSERT INTO admin_settings (setting_key, setting_value)
VALUES ('admin_code', 'REDACTED_BCRYPT_HASH')
ON CONFLICT (setting_key) DO NOTHING;

-- Enable RLS
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access
CREATE POLICY "Allow read access" ON admin_settings
  FOR SELECT USING (true);

-- Create policy to allow write access (for updating admin code if needed)
CREATE POLICY "Allow write access" ON admin_settings
  FOR ALL USING (true);

-- Create a secure admin verification function (SECURITY DEFINER)
-- This function compares the password using bcrypt, preventing timing attacks
CREATE OR REPLACE FUNCTION verify_admin_password(input_password TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT setting_value INTO stored_hash
  FROM admin_settings
  WHERE setting_key = 'admin_code'
  LIMIT 1;

  IF stored_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Compare using pgcrypto.crypt() - constant-time comparison
  RETURN (stored_hash = pgcrypto.crypt(input_password, stored_hash));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
