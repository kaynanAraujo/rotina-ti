const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const tempBase = path.resolve(os.tmpdir());
const tempDir = fs.mkdtempSync(path.join(tempBase, 'rotina-ti-cookie-'));

assert.ok(tempDir.startsWith(`${tempBase}${path.sep}`));
assert.ok(!tempDir.startsWith(`${projectRoot}${path.sep}`));

process.env.DB_PATH = path.join(tempDir, 'cookie.db');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads', 'manutencoes');
process.env.SESSION_SECRET = 'cookie-test-secret-with-more-than-32-characters';
process.env.NODE_ENV = 'production';
delete process.env.SESSION_COOKIE_SECURE;

const { startServer } = require('../server');
const { db } = require('../database');

let server;
let baseUrl;

test.before(async () => {
  server = await startServer(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await new Promise((resolve) => db.close(resolve));

  const resolvedTempDir = path.resolve(tempDir);
  assert.ok(resolvedTempDir.startsWith(`${tempBase}${path.sep}`));
  fs.rmSync(resolvedTempDir, { recursive: true, force: true });
});

test('mantém o login por HTTP mesmo com NODE_ENV=production', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Administrador HTTP',
      usuario: 'admin-http',
      senha: 'senha-http-segura-123'
    })
  });

  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.doesNotMatch(cookie, /;\s*Secure(?:;|$)/i);
});
