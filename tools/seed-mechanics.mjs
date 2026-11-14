// Writes the SQL that puts the core mechanics (runtime/mechanics/) and their manifests in the database, so
// publish_studio_game knows them. Run it after a mechanic's manifest or version changes, as a new migration:
//   node tools/seed-mechanics.mjs > supabase/migrations/<timestamp>_core_mechanics.sql
// Running the same seed twice changes nothing; a new version is added and becomes the latest.
import { MECHANICS } from '../runtime/mechanics/index.js';

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const out = ['-- The core mechanics and their manifests, written by tools/seed-mechanics.mjs from runtime/mechanics/.',
    '-- Don\'t edit by hand: change the mechanic, then make a new seed.', ''];

const only = process.argv.slice(2);   // keys to write, for a migration that adds mechanics (default: all of them)
for (const [key, load] of Object.entries(MECHANICS)) {
    if (only.length && !only.includes(key)) continue;
    const { manifest: m } = await load();
    if (m.key !== key) throw new Error(`${key}: its manifest says ${m.key}`);
    const tag = `$m_${key.replace(/-/g, '_')}$`;
    out.push(
        `insert into public.mechanics (key, name, family, summary, is_core)`,
        `values (${q(key)}, ${q(m.name)}, ${q(m.family)}, ${q(m.summary)}, true)`,
        `on conflict (key) do update set name = excluded.name, family = excluded.family, summary = excluded.summary, is_core = true;`,
        `insert into public.mechanic_versions (mechanic_id, semver, status, manifest, published_at)`,
        `select id, ${q(m.version)}, 'published', ${tag}${JSON.stringify(m)}${tag}::jsonb, now() from public.mechanics where key = ${q(key)}`,
        `on conflict (mechanic_id, semver) do update set manifest = excluded.manifest;`,
        `update public.mechanics m set latest_version_id = v.id from public.mechanic_versions v`,
        ` where m.key = ${q(key)} and v.mechanic_id = m.id and v.semver = ${q(m.version)};`,
        '');
}
process.stdout.write(out.join('\n'));
