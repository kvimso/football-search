const CHECKS = [
  { name: "NEXT_PUBLIC_SUPABASE_URL",     required: true,  label: "Supabase URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true,  label: "Supabase Anon Key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY",     required: true,  label: "Supabase Service Key" },
  { name: "GEMINI_API_KEY",               required: false, label: "Gemini AI (primary)", fallback: "heuristic analysis" },
  { name: "ANTHROPIC_API_KEY",            required: false, label: "Claude AI (fallback)", fallback: "heuristic analysis" },
  { name: "API_FOOTBALL_KEY",             required: false, label: "API-Football",         fallback: "sample data" },
];

let logged = false;

export function logEnvStatus() {
  if (logged) return;
  logged = true;

  try {
    console.log("\n=== FFA Scout Board — Environment ===");
    for (const check of CHECKS) {
      const value = process.env[check.name];
      const isPlaceholder = value && (value.includes("your_") || value.includes("your-") || value.includes("_here"));
      const isSet = value && !isPlaceholder;

      if (isSet) {
        console.log(`  ✓ ${check.label}`);
      } else if (check.required) {
        console.log(`  ✗ ${check.label} — MISSING (required)`);
      } else {
        console.log(`  - ${check.label} — not set → ${check.fallback}`);
      }
    }
    console.log("=====================================\n");
  } catch {
    // Never break the app due to env logging
  }
}
