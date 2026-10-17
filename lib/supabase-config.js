export function supabaseConfig() {
  const ref = String(process.env.SUPABASE_PROJECT_REF || "").trim();
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!/^[a-z]{20}$/.test(ref) || url !== `https://${ref}.supabase.co` || !key.startsWith("sb_publishable_")) {
    throw new Error("auth_configuration_missing_or_invalid");
  }
  return { url, key, ref };
}
