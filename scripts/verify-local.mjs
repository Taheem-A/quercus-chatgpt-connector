// Simple local smoke test. Run while server.mjs is running.
const base = process.argv[2] || 'http://127.0.0.1:3210';
for (const endpoint of ['/api/health', '/api/settings', '/api/status']) {
  const res = await fetch(`${base}${endpoint}`);
  console.log(endpoint, res.status, res.ok ? 'OK' : 'FAIL');
  if (!res.ok) console.log(await res.text());
}
