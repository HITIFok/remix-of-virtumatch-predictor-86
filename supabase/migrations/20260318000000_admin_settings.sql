-- Create admin_settings table for storing admin code
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the admin code
INSERT INTO admin_settings (setting_key, setting_value)
VALUES ('admin_code', 'REDACTED')
ON CONFLICT (setting_key) DO NOTHING;

-- Enable RLS
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access
CREATE POLICY "Allow read access" ON admin_settings
  FOR SELECT USING (true);

-- Create policy to allow write access (for updating admin code if needed)
CREATE POLICY "Allow write access" ON admin_settings
  FOR ALL USING (true);
