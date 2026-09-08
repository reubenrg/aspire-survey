const requiredVariables = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());

if (missingVariables.length > 0) {
  console.error(`Missing required environment variables: ${missingVariables.join(', ')}`);
  console.error('Add them in Vercel Project Settings → Environment Variables, then redeploy.');
  process.exit(1);
}

let supabaseUrl;
try {
  supabaseUrl = new URL(process.env.VITE_SUPABASE_URL);
} catch {
  console.error('VITE_SUPABASE_URL must be a valid URL.');
  process.exit(1);
}

if (supabaseUrl.protocol !== 'https:') {
  console.error('VITE_SUPABASE_URL must use HTTPS.');
  process.exit(1);
}

if (process.env.VITE_SUPABASE_ANON_KEY.trim().length < 20) {
  console.error('VITE_SUPABASE_ANON_KEY does not look like a valid Supabase publishable/anon key.');
  process.exit(1);
}

console.log(`Supabase environment validated for ${supabaseUrl.hostname}.`);
