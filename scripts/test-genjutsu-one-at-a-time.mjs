// Emit a self-contained Postgres test that uses temporary tables and a fake worker wake.
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/operations/genjutsu-one-at-a-time.sql', import.meta.url), 'utf8')
  .replace(/\bpublic\./g, 'pg_temp.')
  .replaceAll('net.http_post', 'pg_temp.http_post')
  .replace(/(?<!\.)\b(production_jobs|face_swap_jobs|app_settings|integrations)\b/g, 'pg_temp.$1')
  .replace(/^(revoke|grant).*\n/gm, '');
const fixture = readFileSync(new URL('../supabase/tests/genjutsu_one_at_a_time.sql', import.meta.url), 'utf8');
process.stdout.write(fixture.replace('-- QUEUE_FUNCTIONS', () => sql));
