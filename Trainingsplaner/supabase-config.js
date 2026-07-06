// ============================================================
//  Trainingsplaner – Supabase-Konfiguration
//  Nutzt dasselbe Supabase-Projekt wie Formel++, eigene Tabellen.
// ============================================================

const SUPABASE_URL      = 'https://arkwbrcpysseaentrdeg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3dicmNweXNzZWFlbnRyZGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjk4OTAsImV4cCI6MjA5NTMwNTg5MH0.u-1omFy15krPw0h5dyai_dE3uH7FnSxa91guoTppVXQ';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
