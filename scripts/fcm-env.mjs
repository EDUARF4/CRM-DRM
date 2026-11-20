// Run on the credential owner's computer; never upload its output to Git/chat.
import { readFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) { console.error('Uso: node scripts/fcm-env.mjs ruta/credencial-firebase.json'); process.exit(1); }
try {
  const account = JSON.parse(readFileSync(path, 'utf8'));
  if (!account.project_id || !account.client_email || !account.private_key) throw new Error('invalid');
  process.stdout.write(JSON.stringify(account) + '\n');
} catch { console.error('No se pudo leer una credencial de servidor Firebase válida.'); process.exit(1); }
