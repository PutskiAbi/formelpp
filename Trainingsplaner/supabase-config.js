// ============================================================
//  Trainingsplaner – Supabase-Konfiguration
//  Eigenes, von Formel++ komplett getrenntes Supabase-Projekt ("Trainingplanner").
// ============================================================

const SUPABASE_URL      = 'https://dgalzlecfxgmvzvetmyt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4XZhQgZevYQUOdTSTEoN3A_QDrhgSg8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
