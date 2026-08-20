import postgres from 'postgres';
const sql = postgres(process.env.NEON_DATABASE_URL);
try {
  const [r] = await sql`SELECT COUNT(*)::int as total, COUNT(DISTINCT device_id) as unique_devices FROM premium_activations WHERE expires_at > NOW()`;
  console.log('=== Premium actifs (expires_at > NOW()) ===');
  console.log('Total activations:', r.total);
  console.log('Devices uniques:', r.unique_devices);

  const [all] = await sql`SELECT COUNT(*)::int as total_all, COUNT(DISTINCT device_id) as unique_devices_all FROM premium_activations`;
  console.log('\n=== Toutes les activations (historique) ===');
  console.log('Total activations:', all.total_all);
  console.log('Devices uniques:', all.unique_devices_all);

  const rows = await sql`SELECT device_id, activated_at, expires_at FROM premium_activations WHERE expires_at > NOW() ORDER BY expires_at ASC`;
  console.log('\n=== Detail activations actives ===');
  rows.forEach(row => console.log('  device:', row.device_id, ' activated:', row.activated_at, ' expires:', row.expires_at));

  const tables = await sql`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name IN ('premium_activations', 'access_codes', 'device_secrets') ORDER BY table_name, ordinal_position`;
  console.log('\n=== Schema ===');
  let cur = '';
  for (const t of tables) {
    if (t.table_name !== cur) { cur = t.table_name; console.log('\n---', t.table_name, '---'); }
    console.log('  ', t.column_name, t.data_type, t.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE');
  }
  await sql.end();
} catch(e) { console.error(e.message); process.exit(1); }
