const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
const tempDir = fs.mkdtempSync(path.join(tempRoot, 'rotina-ti-test-'));
const tempDbPath = path.join(tempDir, 'database-test.db');
const tempUploadDir = path.join(tempDir, 'uploads', 'manutencoes');

assert.ok(
  tempDir.startsWith(`${tempRoot}${path.sep}`),
  'A raiz de teste precisa permanecer dentro do diretório temporário do sistema.'
);
assert.ok(
  !tempDir.startsWith(`${projectRoot}${path.sep}`),
  'A raiz de teste não pode ficar dentro do projeto real.'
);

process.env.DB_PATH = tempDbPath;
process.env.UPLOAD_DIR = tempUploadDir;
process.env.SESSION_SECRET = 'test-only-session-secret-with-more-than-32-characters';
process.env.NODE_ENV = 'development';
process.env.TZ = 'America/Sao_Paulo';

const { startServer, uploadDir } = require('../server');
const { db, run, get, all } = require('../database');

let server;
let baseUrl;
let adminCookie;
let technicianCookie;
let technicianId;
let weeklyTaskId;
let nextWeeklyTaskId;
let maintenanceId;
let attachmentIds = [];
let ipId;

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header, 'A resposta deveria criar um cookie de sessão.');
  return header.split(';', 1)[0];
}

async function request(url, options = {}, cookie = null) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (options.body != null && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${baseUrl}${url}`, { ...options, headers });
}

async function jsonRequest(url, method, body, cookie = null) {
  return request(
    url,
    {
      method,
      body: body == null ? undefined : JSON.stringify(body)
    },
    cookie
  );
}

async function responseJson(response, expectedStatus = 200) {
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.status,
    expectedStatus,
    `HTTP ${response.status}: ${payload.error || JSON.stringify(payload)}`
  );
  return payload;
}

async function uploadPdf(
  name,
  contents,
  cookie = technicianCookie,
  targetMaintenanceId = maintenanceId
) {
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([Buffer.from(contents)], { type: 'application/pdf' }),
    name
  );
  return responseJson(
    await request(
      `/api/manutencoes/${targetMaintenanceId}/anexos`,
      { method: 'POST', body: form },
      cookie
    )
  );
}

test.before(async () => {
  assert.equal(path.resolve(uploadDir), path.resolve(tempUploadDir));
  server = await startServer(0, '127.0.0.1');
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await new Promise((resolve) => db.close(resolve));

  const resolvedTempDir = path.resolve(tempDir);
  assert.ok(resolvedTempDir.startsWith(`${tempRoot}${path.sep}`));
  fs.rmSync(resolvedTempDir, { recursive: true, force: true });
});

test('inicializa banco e uploads somente na área temporária e responde ao health check', async () => {
  const health = await responseJson(await request('/api/health'));
  assert.equal(health.ok, true);
  assert.equal(fs.existsSync(tempDbPath), true);
  assert.equal(fs.existsSync(tempUploadDir), true);
  assert.equal(fs.existsSync(path.join(projectRoot, 'database-test.db')), false);

  const integrity = await get('PRAGMA integrity_check');
  assert.equal(integrity.integrity_check, 'ok');
});

test('recusa uma segunda instância na mesma porta com EADDRINUSE controlado', async () => {
  await assert.rejects(
    startServer(server.address().port, '127.0.0.1'),
    (error) => error?.code === 'EADDRINUSE'
  );

  const health = await responseJson(await request('/api/health'));
  assert.equal(health.ok, true);
});

test('preserva cadastro, login, perfis, hash, recuperação administrativa e logout', async () => {
  const initial = await responseJson(await request('/api/auth/me'));
  assert.equal(initial.setupRequired, true);
  assert.equal(initial.user, null);

  const firstResponse = await jsonRequest('/api/auth/register', 'POST', {
    nome: 'Admin Teste',
    usuario: 'admin',
    senha: 'senha-forte-123'
  });
  const first = await responseJson(firstResponse);
  adminCookie = cookieFrom(firstResponse);
  assert.equal(first.user.perfil, 'admin');

  const storedAdmin = await get(
    'SELECT usuario, senha_hash, perfil FROM usuarios WHERE usuario = ?',
    ['admin']
  );
  assert.equal(storedAdmin.perfil, 'admin');
  assert.notEqual(storedAdmin.senha_hash, 'senha-forte-123');
  assert.equal(await bcrypt.compare('senha-forte-123', storedAdmin.senha_hash), true);

  await responseJson(
    await jsonRequest('/api/auth/register', 'POST', {
      nome: 'Cadastro público indevido',
      usuario: 'intruso',
      senha: 'senha-forte-123'
    }),
    403
  );

  const technicianCreation = await responseJson(
    await jsonRequest(
      '/api/auth/register',
      'POST',
      {
        nome: 'Técnico Teste',
        usuario: 'tecnico',
        senha: 'senha-tecnica-123'
      },
      adminCookie
    )
  );
  technicianId = technicianCreation.id;

  const oldLoginResponse = await jsonRequest('/api/auth/login', 'POST', {
    usuario: 'tecnico',
    senha: 'senha-tecnica-123'
  });
  const oldLogin = await responseJson(oldLoginResponse);
  const oldTechnicianCookie = cookieFrom(oldLoginResponse);
  assert.equal(oldLogin.user.perfil, 'tecnico');

  await responseJson(
    await jsonRequest(
      '/api/auth/register',
      'POST',
      {
        nome: 'Sem permissão',
        usuario: 'sem-permissao',
        senha: 'senha-forte-123'
      },
      oldTechnicianCookie
    ),
    403
  );

  await responseJson(
    await jsonRequest(
      '/api/auth/reset-password-admin',
      'POST',
      { usuario: 'admin', novaSenha: 'tentativa-sem-permissao-123' },
      oldTechnicianCookie
    ),
    403
  );

  const unrelatedUserId = Number(`${technicianId}0`);
  await run(
    `INSERT INTO sessoes (sid, sessao, expira_em) VALUES (?, ?, ?)`,
    [
      'sessao-prefixo-nao-relacionada',
      JSON.stringify({ user: { id: unrelatedUserId } }),
      Date.now() + 60_000
    ]
  );

  await responseJson(
    await jsonRequest(
      '/api/auth/reset-password-admin',
      'POST',
      { usuario: 'tecnico', novaSenha: 'senha-nova-tecnica-456' },
      adminCookie
    )
  );

  const unrelatedSession = await get(
    'SELECT COUNT(*) AS total FROM sessoes WHERE sid = ?',
    ['sessao-prefixo-nao-relacionada']
  );
  assert.equal(unrelatedSession.total, 1);
  await run('DELETE FROM sessoes WHERE sid = ?', ['sessao-prefixo-nao-relacionada']);

  await responseJson(await request('/api/pendencias', {}, oldTechnicianCookie), 401);
  await responseJson(
    await jsonRequest('/api/auth/login', 'POST', {
      usuario: 'tecnico',
      senha: 'senha-tecnica-123'
    }),
    401
  );

  const newLoginResponse = await jsonRequest('/api/auth/login', 'POST', {
    usuario: 'tecnico',
    senha: 'senha-nova-tecnica-456'
  });
  const newLogin = await responseJson(newLoginResponse);
  technicianCookie = cookieFrom(newLoginResponse);
  assert.equal(newLogin.user.id, technicianId);

  const disposableLoginResponse = await jsonRequest('/api/auth/login', 'POST', {
    usuario: 'admin',
    senha: 'senha-forte-123'
  });
  await responseJson(disposableLoginResponse);
  const disposableAdminCookie = cookieFrom(disposableLoginResponse);
  await responseJson(
    await jsonRequest('/api/auth/logout', 'POST', {}, disposableAdminCookie)
  );
  await responseJson(await request('/api/pendencias', {}, disposableAdminCookie), 401);
});

test('isola pendências por usuário e mantém CRUD, histórico e repetição semanal sem duplicidade', async () => {
  await responseJson(
    await jsonRequest(
      '/api/pendencias',
      'POST',
      {
        descricao: 'Tarefa exclusiva do admin',
        setor: 'Administração',
        data: '2026-07-28',
        hora: '08:00',
        prioridade: 'Alta',
        status: 'Aberta',
        repeticao: 'Nenhuma'
      },
      adminCookie
    )
  );

  for (const invalidTask of [
    {
      descricao: 'Data impossível',
      setor: 'TI',
      data: '2025-02-29',
      hora: '08:00',
      prioridade: 'Alta',
      status: 'Aberta',
      repeticao: 'Nenhuma'
    },
    {
      descricao: 'Data truncada indevidamente',
      setor: 'TI',
      data: '2026-07-28-extra',
      hora: '08:00',
      prioridade: 'Alta',
      status: 'Aberta',
      repeticao: 'Nenhuma'
    },
    {
      descricao: 'Status inválido',
      setor: 'TI',
      data: '2026-07-28',
      hora: '08:00',
      prioridade: 'Alta',
      status: 'Estado inventado',
      repeticao: 'Nenhuma'
    }
  ]) {
    await responseJson(
      await jsonRequest('/api/pendencias', 'POST', invalidTask, technicianCookie),
      400
    );
  }

  const creation = await responseJson(
    await jsonRequest(
      '/api/pendencias',
      'POST',
      {
        descricao: 'Rotina semanal',
        setor: 'TI',
        data: '2026-07-24',
        hora: '10:00',
        prioridade: 'Média',
        status: 'Aberta',
        repeticao: 'Semanal'
      },
      technicianCookie
    )
  );
  weeklyTaskId = creation.id;

  const weeklyPayload = {
    descricao: 'Rotina semanal',
    setor: 'Infraestrutura',
    data: '2026-07-24',
    hora: '10:30',
    prioridade: 'Alta',
    status: 'Em andamento',
    repeticao: 'Semanal'
  };
  await responseJson(
    await jsonRequest(
      `/api/pendencias/${weeklyTaskId}`,
      'PUT',
      weeklyPayload,
      adminCookie
    ),
    404
  );
  await responseJson(
    await request(
      `/api/pendencias/${weeklyTaskId}`,
      { method: 'DELETE' },
      adminCookie
    ),
    404
  );

  await responseJson(
    await jsonRequest(
      `/api/pendencias/${weeklyTaskId}`,
      'PUT',
      weeklyPayload,
      technicianCookie
    )
  );

  const technicianItems = await responseJson(
    await request('/api/pendencias', {}, technicianCookie)
  );
  assert.equal(technicianItems.length, 1);
  assert.equal(technicianItems[0].setor, 'Infraestrutura');
  assert.equal(technicianItems[0].hora, '10:30');

  const adminItems = await responseJson(
    await request('/api/pendencias', {}, adminCookie)
  );
  assert.equal(adminItems.length, 1);
  assert.equal(adminItems[0].descricao, 'Tarefa exclusiva do admin');

  const firstCompletion = await responseJson(
    await jsonRequest(
      `/api/pendencias/${weeklyTaskId}/concluir`,
      'POST',
      {},
      technicianCookie
    )
  );
  assert.equal(firstCompletion.proximaCriada, true);

  const repeatedCompletion = await responseJson(
    await jsonRequest(
      `/api/pendencias/${weeklyTaskId}/concluir`,
      'POST',
      {},
      technicianCookie
    )
  );
  assert.equal(repeatedCompletion.proximaCriada, false);
  assert.equal(repeatedCompletion.jaConcluida, true);

  const pendingAfterCompletion = await responseJson(
    await request('/api/pendencias', {}, technicianCookie)
  );
  const nextOccurrences = pendingAfterCompletion.filter(
    (item) => item.descricao === 'Rotina semanal'
  );
  assert.equal(nextOccurrences.length, 1);
  assert.equal(nextOccurrences[0].data, '2026-07-31');
  assert.equal(nextOccurrences[0].repeticao, 'Semanal');
  nextWeeklyTaskId = nextOccurrences[0].id;

  const history = await responseJson(
    await request('/api/pendencias-historico', {}, technicianCookie)
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].id, weeklyTaskId);
  assert.equal(history[0].status, 'Concluída');

  await responseJson(
    await jsonRequest(
      `/api/pendencias/${weeklyTaskId}`,
      'PUT',
      {
        descricao: 'Não deve reabrir',
        setor: 'TI',
        data: '2026-07-24',
        hora: '10:30',
        prioridade: 'Alta',
        status: 'Aberta',
        repeticao: 'Semanal'
      },
      technicianCookie
    ),
    409
  );

  await responseJson(
    await request(
      `/api/pendencias/${nextWeeklyTaskId}`,
      { method: 'DELETE' },
      technicianCookie
    )
  );
  const afterDelete = await responseJson(
    await request('/api/pendencias', {}, technicianCookie)
  );
  assert.equal(afterDelete.length, 0);
});

test('mantém manutenção compartilhada e vários PDFs ao retornar e reabrir', async () => {
  const created = await responseJson(
    await jsonRequest(
      '/api/manutencoes',
      'POST',
      {
        tipo: 'Notebook',
        patrimonio: 'PAT-100',
        modelo: 'Dell Latitude',
        serial: 'SERIAL-100',
        responsavel: 'TI - Técnico',
        destino: 'Assistência',
        dataEnvio: '2026-07-20',
        status: 'Enviado',
        obs: 'Não liga.'
      },
      technicianCookie
    )
  );
  maintenanceId = created.id;

  await responseJson(
    await jsonRequest(
      `/api/manutencoes/${maintenanceId}`,
      'PUT',
      {
        tipo: 'Notebook',
        patrimonio: 'PAT-100',
        modelo: 'Dell Latitude 5550',
        serial: 'SERIAL-100',
        responsavel: 'Financeiro - Ana',
        destino: 'Assistência autorizada',
        dataEnvio: '2026-07-20',
        status: 'Em análise',
        obs: 'Não liga. Fonte testada.'
      },
      technicianCookie
    )
  );

  const firstAttachment = await uploadPdf(
    'ordem-servico-100.pdf',
    '%PDF-1.4\nPDF de teste 1\n%%EOF'
  );
  const secondAttachment = await uploadPdf(
    'nota-fiscal-100.pdf',
    '%PDF-1.4\nPDF de teste 2\n%%EOF'
  );
  attachmentIds = [firstAttachment.id, secondAttachment.id];

  const invalidForm = new FormData();
  invalidForm.append(
    'pdf',
    new Blob([Buffer.from('conteúdo que não é PDF')], {
      type: 'application/pdf'
    }),
    'arquivo-invalido.pdf'
  );
  await responseJson(
    await request(
      `/api/manutencoes/${maintenanceId}/anexos`,
      { method: 'POST', body: invalidForm },
      technicianCookie
    ),
    400
  );
  assert.equal(fs.readdirSync(tempUploadDir).length, 2);

  const sharedForAdmin = await responseJson(
    await request('/api/manutencoes', {}, adminCookie)
  );
  const activeItem = sharedForAdmin.find((item) => item.id === maintenanceId);
  assert.ok(activeItem);
  assert.equal(activeItem.modelo, 'Dell Latitude 5550');
  assert.equal(activeItem.anexos.length, 2);
  assert.ok(activeItem.anexos.every((item) => item.anexadoPor === 'Técnico Teste'));

  for (const attachment of activeItem.anexos) {
    const download = await request(attachment.caminho, {}, technicianCookie);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') || '', /application\/pdf/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  }

  await responseJson(await request(`/api/anexos/${attachmentIds[0]}`), 401);

  await responseJson(
    await jsonRequest(
      `/api/manutencoes/${maintenanceId}/retornar`,
      'POST',
      {},
      technicianCookie
    )
  );
  const repeatedReturn = await responseJson(
    await jsonRequest(
      `/api/manutencoes/${maintenanceId}/retornar`,
      'POST',
      {},
      technicianCookie
    )
  );
  assert.equal(repeatedReturn.jaRetornada, true);

  await responseJson(
    await jsonRequest(
      `/api/manutencoes/${maintenanceId}`,
      'PUT',
      {
        tipo: 'Notebook',
        patrimonio: 'PAT-100',
        modelo: 'Tentativa de edição sem reabrir',
        serial: 'SERIAL-100',
        responsavel: 'Financeiro - Ana',
        destino: 'Assistência autorizada',
        dataEnvio: '2026-07-20',
        status: 'Em análise',
        obs: 'Não deve ser gravado.'
      },
      technicianCookie
    ),
    409
  );

  const history = await responseJson(
    await request('/api/manutencoes-historico', {}, adminCookie)
  );
  const returned = history.find((item) => item.id === maintenanceId);
  assert.ok(returned);
  assert.equal(returned.status, 'Retornou');
  assert.equal(returned.modelo, 'Dell Latitude 5550');
  assert.equal(returned.anexos.length, 2);
  assert.equal(returned.retornadoPor, 'Técnico Teste');

  await responseJson(
    await jsonRequest(
      `/api/manutencoes/${maintenanceId}/reabrir`,
      'POST',
      {},
      adminCookie
    )
  );
  const reopenedItems = await responseJson(
    await request('/api/manutencoes', {}, technicianCookie)
  );
  const reopened = reopenedItems.find((item) => item.id === maintenanceId);
  assert.ok(reopened);
  assert.equal(reopened.status, 'Em análise');
  assert.equal(reopened.anexos.length, 2);

  const disposable = await responseJson(
    await jsonRequest(
      '/api/manutencoes',
      'POST',
      {
        tipo: 'Monitor',
        patrimonio: 'PAT-EXCLUIR',
        modelo: 'Monitor de teste',
        serial: '',
        responsavel: 'TI',
        destino: 'Teste',
        dataEnvio: '2026-07-28',
        status: 'Enviado',
        obs: 'Registro temporário.'
      },
      technicianCookie
    )
  );
  const disposableAttachment = await uploadPdf(
    'anexo-para-exclusao.pdf',
    '%PDF-1.4\nPDF que deve ser removido\n%%EOF',
    technicianCookie,
    disposable.id
  );
  const disposableAttachmentRow = await get(
    'SELECT nome_arquivo FROM anexos_manutencao WHERE id = ?',
    [disposableAttachment.id]
  );
  const disposableAttachmentPath = path.join(
    tempUploadDir,
    disposableAttachmentRow.nome_arquivo
  );
  assert.equal(fs.existsSync(disposableAttachmentPath), true);

  await responseJson(
    await request(
      `/api/manutencoes/${disposable.id}`,
      { method: 'DELETE' },
      technicianCookie
    ),
    403
  );
  await responseJson(
    await request(
      `/api/manutencoes/${disposable.id}`,
      { method: 'DELETE' },
      adminCookie
    )
  );
  assert.equal(fs.existsSync(disposableAttachmentPath), false);
  assert.equal(
    (
      await get(
        'SELECT COUNT(*) AS total FROM anexos_manutencao WHERE id = ?',
        [disposableAttachment.id]
      )
    ).total,
    0
  );

  const uploadedFiles = fs.readdirSync(tempUploadDir);
  assert.equal(uploadedFiles.length, 2);
});

test('preserva cadastro, edição, verificações e permissão de exclusão do monitor de IPs', async () => {
  const created = await responseJson(
    await jsonRequest(
      '/api/ips',
      'POST',
      {
        categoria: 'Servidor',
        nome: 'Loopback de teste',
        ip: '127.0.0.1',
        setor: 'TI',
        observacoes: 'Somente ambiente temporário.'
      },
      technicianCookie
    )
  );
  ipId = created.id;
  assert.ok(['Online', 'Offline'].includes(created.status));

  const edited = await responseJson(
    await jsonRequest(
      `/api/ips/${ipId}`,
      'PUT',
      {
        categoria: 'Outro',
        nome: 'Loopback editado',
        ip: '127.0.0.1',
        setor: 'Laboratório',
        observacoes: 'Editado no teste.'
      },
      technicianCookie
    )
  );
  assert.equal(edited.nome, 'Loopback editado');
  assert.equal(edited.categoria, 'Outro');

  const checked = await responseJson(
    await jsonRequest(`/api/ips/${ipId}/verificar`, 'POST', {}, technicianCookie)
  );
  assert.equal(checked.id, ipId);
  assert.ok(checked.verificadoEm);

  const allChecked = await responseJson(
    await jsonRequest('/api/ips/verificar-todos', 'POST', {}, adminCookie)
  );
  assert.equal(allChecked.length, 1);
  assert.equal(allChecked[0].id, ipId);

  await responseJson(
    await request(`/api/ips/${ipId}`, { method: 'DELETE' }, technicianCookie),
    403
  );
  await responseJson(
    await request(`/api/ips/${ipId}`, { method: 'DELETE' }, adminCookie)
  );
  assert.equal((await responseJson(await request('/api/ips', {}, adminCookie))).length, 0);
});

test('encerra com schema esperado, dados temporários coerentes e integridade SQLite', async () => {
  const tables = await all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  assert.deepEqual(
    tables.map((row) => row.name),
    [
      'anexos_manutencao',
      'historico',
      'ips_monitorados',
      'manutencoes',
      'pendencias',
      'sessoes',
      'usuarios'
    ]
  );

  const attachmentCount = await get(
    'SELECT COUNT(*) AS total FROM anexos_manutencao WHERE manutencao_id = ?',
    [maintenanceId]
  );
  assert.equal(attachmentCount.total, 2);

  const weeklyPendingCount = await get(
    "SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND descricao = 'Rotina semanal' AND status != 'Concluída'",
    [technicianId]
  );
  assert.equal(weeklyPendingCount.total, 0);

  const integrity = await get('PRAGMA integrity_check');
  assert.equal(integrity.integrity_check, 'ok');
});
