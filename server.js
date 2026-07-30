const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { run, get, all, transaction, initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 10;
const PENDENCIA_STATUS = new Set(['Aberta', 'Em andamento', 'Concluída']);
const PRIORIDADES = new Set(['Baixa', 'Média', 'Alta', 'Urgente']);
const REPETICOES = new Set(['Nenhuma', 'Semanal']);
const MANUTENCAO_STATUS = new Set([
  'Enviado', 'Aguardando coleta', 'Aguardando orçamento', 'Em análise',
  'Consertado', 'Aguardando retorno do equipamento', 'Retornou', 'Aguardando Pedido'
]);

const IP_CATEGORIES = new Set([
  'Relógio',
  'Switch',
  'Impressora',
  'Access Point',
  'Câmera',
  'Servidor',
  'Outro'
]);

function normalizeIpCategory(value) {
  const categoria = String(value || '').trim();
  return IP_CATEGORIES.has(categoria) ? categoria : 'Outro';
}

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads', 'manutencoes');
fs.mkdirSync(uploadDir, { recursive: true });

function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return process.env.SESSION_SECRET;
  }
  const secretPath = path.join(__dirname, 'session-secret.txt');
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return generated;
}

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    get('SELECT sessao, expira_em FROM sessoes WHERE sid = ?', [sid])
      .then(async (row) => {
        if (!row || row.expira_em <= Date.now()) {
          if (row) await run('DELETE FROM sessoes WHERE sid = ?', [sid]);
          return callback(null, null);
        }
        callback(null, JSON.parse(row.sessao));
      })
      .catch(callback);
  }

  set(sid, value, callback = () => {}) {
    const expires = value.cookie?.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + SESSION_MAX_AGE;
    run(
      `INSERT INTO sessoes (sid, sessao, expira_em) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sessao = excluded.sessao, expira_em = excluded.expira_em`,
      [sid, JSON.stringify(value), expires]
    ).then(() => callback()).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    run('DELETE FROM sessoes WHERE sid = ?', [sid]).then(() => callback()).catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    const expires = value.cookie?.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + SESSION_MAX_AGE;
    run('UPDATE sessoes SET expira_em = ? WHERE sid = ?', [expires, sid])
      .then(() => callback()).catch(callback);
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(session({
  name: 'rotina.sid',
  secret: sessionSecret(),
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'strict',
    secure: SESSION_COOKIE_SECURE
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  try {
    const user = await get(
      'SELECT id, nome, usuario, perfil FROM usuarios WHERE id = ? AND ativo = 1',
      [req.session.user.id]
    );
    if (!user) {
      return req.session.destroy(() => res.status(401).json({ error: 'Sessão inválida.' }));
    }
    req.session.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.session.user?.perfil !== 'admin') {
    return res.status(403).json({ error: 'Ação permitida somente para administradores.' });
  }
  next();
}

const attempts = new Map();
function limitAttempts(keyPrefix, maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}:${String(req.body?.usuario || req.body?.adminUsuario || '').toLowerCase()}`;
    const now = Date.now();
    let entry = attempts.get(key);
    if (entry?.resetAt <= now) {
      attempts.delete(key);
      entry = null;
    }

    if (entry?.count >= maxAttempts) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    }

    res.once('finish', () => {
      if (res.statusCode < 400) {
        attempts.delete(key);
        return;
      }
      if (res.statusCode === 429) return;
      const current = attempts.get(key);
      if (!current || current.resetAt <= Date.now()) {
        attempts.set(key, { count: 1, resetAt: Date.now() + windowMs });
      } else {
        current.count += 1;
      }
    });
    next();
  };
}

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysByMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31
  ];
  return day <= daysByMonth[month - 1];
}

function validTime(value) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localDateISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function pendenciaInput(body) {
  const data = String(body.data || '').trim();
  const hora = String(body.hora || '').trim();
  const prioridade = String(body.prioridade || '').trim();
  const status = String(body.status || '').trim();
  const repeticao = String(body.repeticao || '').trim();
  if (data.length > 10 || hora.length > 5) {
    return { error: 'Data ou hora inválida.' };
  }
  if (prioridade && !PRIORIDADES.has(prioridade)) {
    return { error: 'Prioridade inválida.' };
  }
  if (status && !PENDENCIA_STATUS.has(status)) {
    return { error: 'Status inválido.' };
  }
  if (repeticao && !REPETICOES.has(repeticao)) {
    return { error: 'Repetição inválida.' };
  }
  const value = {
    descricao: text(body.descricao, 500),
    setor: text(body.setor, 100),
    data,
    hora,
    prioridade: prioridade || 'Média',
    status: status || 'Aberta',
    repeticao: repeticao || 'Nenhuma'
  };
  if (!value.descricao) return { error: 'Descrição é obrigatória.' };
  if (!validDate(data) || !validTime(hora)) return { error: 'Data ou hora inválida.' };
  return { value };
}

function manutencaoInput(body) {
  const dataEnvio = String(body.dataEnvio || '').trim();
  const status = String(body.status || '').trim();
  if (dataEnvio.length > 10) return { error: 'Data de envio inválida.' };
  if (!validDate(dataEnvio)) return { error: 'Data de envio inválida.' };
  if (status && !MANUTENCAO_STATUS.has(status)) {
    return { error: 'Status de manutenção inválido.' };
  }
  return {
    value: {
      tipo: text(body.tipo, 50) || 'Outro',
      patrimonio: text(body.patrimonio, 100),
      modelo: text(body.modelo, 150),
      serial: text(body.serial, 150),
      responsavel: text(body.responsavel, 150),
      destino: text(body.destino, 150),
      dataEnvio,
      status: status || 'Enviado',
      obs: text(body.obs, 2000)
    }
  };
}

async function logAction(user, acao, entidade, entidadeId, detalhes = '') {
  await run(
    `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user?.id || null, user?.nome || null, acao, entidade, entidadeId || null, detalhes]
  );
}

function mapPendencia(row) {
  return {
    id: row.id,
    descricao: row.descricao,
    setor: row.setor,
    data: row.data_tarefa,
    hora: row.hora_tarefa,
    prioridade: row.prioridade,
    status: row.status,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    concluidoEm: row.concluido_em,
    repeticao: row.repeticao || 'Nenhuma'
  };
}

function mapManutencao(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    patrimonio: row.patrimonio,
    modelo: row.modelo,
    serial: row.serial,
    responsavel: row.responsavel,
    destino: row.destino,
    dataEnvio: row.data_envio,
    status: row.status,
    obs: row.observacoes,
    criadoPor: row.criado_por_nome,
    criadoEm: row.criado_em,
    atualizadoPor: row.atualizado_por_nome,
    atualizadoEm: row.atualizado_em,
    retornadoPor: row.retornado_por_nome,
    retornadoEm: row.retornado_em,
    anexos: []
  };
}

function mapIpMonitorado(row) {
  return {
    id: row.id,
    categoria: row.categoria || 'Outro',
    nome: row.nome,
    ip: row.ip,
    setor: row.setor,
    observacoes: row.observacoes,
    status: row.status || 'Não verificado',
    tempoMs: row.tempo_ms,
    verificadoEm: row.verificado_em,
    criadoPor: row.criado_por_nome,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em
  };
}

function pingIp(ip) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const args = isWindows
      ? ['-n', '1', '-w', '1800', ip]
      : ['-c', '1', '-W', '2', ip];

    const inicio = Date.now();
    execFile('ping', args, { timeout: 4000, windowsHide: true, encoding: 'utf8' }, (error, stdout = '') => {
      if (error) {
        return resolve({ status: 'Offline', tempoMs: null });
      }

      const semResposta = /(destination host unreachable|request timed out|inacessível|esgotado)/i.test(stdout);
      const respondeu = /(?:ttl=|bytes=|tempo[=<]|time[=<])/i.test(stdout) && !semResposta;
      if (!respondeu) {
        return resolve({ status: 'Offline', tempoMs: null });
      }

      const match = stdout.match(/(?:time|tempo)[=<]\s*(\d+)\s*ms/i);
      const tempoMs = match ? Number(match[1]) : Math.max(1, Date.now() - inicio);
      resolve({ status: 'Online', tempoMs });
    });
  });
}

async function verificarIpSalvo(row) {
  const resultado = await pingIp(row.ip);
  await run(
    `UPDATE ips_monitorados
     SET status = ?, tempo_ms = ?, verificado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [resultado.status, resultado.tempoMs, row.id]
  );

  const atualizado = await get('SELECT * FROM ips_monitorados WHERE id = ?', [row.id]);
  return mapIpMonitorado(atualizado);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const count = await get('SELECT COUNT(*) AS total FROM usuarios');
    res.json({ user: req.session.user || null, setupRequired: count.total === 0 });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', limitAttempts('register', 8, 15 * 60 * 1000), async (req, res) => {
  try {
    const nome = text(req.body.nome, 100);
    const usuario = text(req.body.usuario, 50).toLowerCase();
    const senha = String(req.body.senha || '');

    if (!nome || !usuario || !senha) {
      return res.status(400).json({ error: 'Preencha nome, usuário e senha.' });
    }

    if (usuario.length < 3) {
      return res.status(400).json({ error: 'Usuário deve ter pelo menos 3 caracteres.' });
    }

    if (senha.length < 8 || senha.length > 128) {
      return res.status(400).json({ error: 'Senha deve ter entre 8 e 128 caracteres.' });
    }

    const total = await get('SELECT COUNT(*) AS total FROM usuarios');
    const isFirstUser = total.total === 0;
    if (!isFirstUser) {
      if (!req.session.user) {
        return res.status(403).json({ error: 'Novas contas devem ser criadas por um administrador.' });
      }
      const admin = await get('SELECT perfil, ativo FROM usuarios WHERE id = ?', [req.session.user.id]);
      if (!admin || !admin.ativo || admin.perfil !== 'admin') {
        return res.status(403).json({ error: 'Ação permitida somente para administradores.' });
      }
    }

    const perfil = isFirstUser ? 'admin' : 'tecnico';
    const senhaHash = await bcrypt.hash(senha, 10);
    const actor = req.session.user || null;
    const result = await transaction(async (tx) => {
      const count = await tx.get('SELECT COUNT(*) AS total FROM usuarios');
      if (!actor && count.total !== 0) {
        const error = new Error('Cadastro público encerrado.');
        error.status = 403;
        throw error;
      }
      const created = await tx.run(
        `INSERT INTO usuarios (nome, usuario, senha_hash, perfil) VALUES (?, ?, ?, ?)`,
        [nome, usuario, senhaHash, count.total === 0 ? 'admin' : 'tecnico']
      );
      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, ?, 'usuarios', ?, ?)`,
        [actor?.id || created.id, actor?.nome || nome, 'criou conta', created.id, `Perfil: ${perfil}`]
      );
      return created;
    });

    if (isFirstUser) {
      await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
      req.session.user = { id: result.id, nome, usuario, perfil };
      return res.json({ user: req.session.user });
    }
    res.json({ ok: true, id: result.id });
  } catch (error) {
    console.error(error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'Este usuário já existe.' });
    }
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

app.post('/api/auth/login', limitAttempts('login', 8, 15 * 60 * 1000), async (req, res) => {
  try {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    const user = await get('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1', [usuario]);
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.user = {
      id: user.id,
      nome: user.nome,
      usuario: user.usuario,
      perfil: user.perfil
    };

    await logAction(req.session.user, 'entrou no sistema', 'usuarios', user.id);
    res.json({ user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao entrar.' });
  }
});


app.post('/api/auth/reset-password-admin', requireAuth, requireAdmin, limitAttempts('reset', 6, 15 * 60 * 1000), async (req, res) => {
  try {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const novaSenha = String(req.body.novaSenha || '');

    if (!usuario || !novaSenha) {
      return res.status(400).json({ error: 'Preencha usuário e nova senha.' });
    }

    if (novaSenha.length < 8 || novaSenha.length > 128) {
      return res.status(400).json({ error: 'A nova senha deve ter entre 8 e 128 caracteres.' });
    }

    const target = await get('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1', [usuario]);
    if (!target) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await transaction(async (tx) => {
      await tx.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, target.id]);
      await tx.run(
        `DELETE FROM sessoes
         WHERE sid != ?
           AND json_valid(sessao) = 1
           AND CAST(json_extract(sessao, '$.user.id') AS INTEGER) = ?`,
        [
          req.sessionID, target.id
        ]
      );
      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'recuperou senha', 'usuarios', ?, ?)`,
        [req.session.user.id, req.session.user.nome, target.id, `Senha alterada para o usuário ${target.usuario}`]
      );
    });

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao recuperar senha.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const user = req.session.user;
  await logAction(user, 'saiu do sistema', 'usuarios', user.id);
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/pendencias', requireAuth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM pendencias WHERE usuario_id = ? AND status != 'Concluída' ORDER BY COALESCE(data_tarefa, '9999-12-31'), COALESCE(hora_tarefa, '99:99'), id DESC`,
      [req.session.user.id]
    );
    res.json(rows.map(mapPendencia));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao listar pendências.' });
  }
});


// Histórico individual: cada usuário vê somente as próprias tarefas concluídas.
app.get('/api/pendencias-historico', requireAuth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM pendencias
       WHERE usuario_id = ? AND status = 'Concluída'
       ORDER BY COALESCE(concluido_em, atualizado_em, criado_em) DESC, id DESC`,
      [req.session.user.id]
    );
    res.json(rows.map(mapPendencia));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar histórico de tarefas.' });
  }
});

app.post('/api/pendencias', requireAuth, async (req, res) => {
  try {
    const parsed = pendenciaInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { descricao, setor, data, hora, prioridade, status, repeticao } = parsed.value;
    if (status === 'Concluída') {
      return res.status(400).json({ error: 'Salve a tarefa aberta e use a ação Concluir.' });
    }

    const result = await run(
      `INSERT INTO pendencias (
         usuario_id, descricao, setor, data_tarefa, hora_tarefa, prioridade, status, repeticao, concluido_em
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'Concluída' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [
        req.session.user.id, descricao, setor, data, hora, prioridade,
        status, repeticao, status
      ]
    );

    await logAction(req.session.user, 'criou pendência', 'pendencias', result.id, descricao);
    res.json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar pendência.' });
  }
});

app.put('/api/pendencias/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM pendencias WHERE id = ? AND usuario_id = ?', [id, req.session.user.id]);
    if (!row) return res.status(404).json({ error: 'Pendência não encontrada.' });
    if (row.status === 'Concluída') {
      return res.status(409).json({ error: 'Uma tarefa concluída não pode ser reaberta ou editada.' });
    }

    const parsed = pendenciaInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { descricao, setor, data, hora, prioridade, status, repeticao } = parsed.value;
    if (status === 'Concluída') {
      return res.status(400).json({ error: 'Use a ação Concluir para finalizar a tarefa.' });
    }
    const updateResult = await run(
      `UPDATE pendencias
       SET descricao = ?, setor = ?, data_tarefa = ?, hora_tarefa = ?, prioridade = ?, status = ?, repeticao = ?,
           atualizado_em = CURRENT_TIMESTAMP,
           concluido_em = CASE
             WHEN ? = 'Concluída' THEN COALESCE(concluido_em, CURRENT_TIMESTAMP)
             ELSE NULL
           END
       WHERE id = ? AND usuario_id = ? AND status != 'Concluída'`,
      [
        descricao, setor, data, hora, prioridade, status,
        repeticao, status, id, req.session.user.id
      ]
    );
    if (updateResult.changes === 0) {
      return res.status(409).json({ error: 'A tarefa foi concluída e não pode mais ser editada.' });
    }

    await logAction(req.session.user, 'editou pendência', 'pendencias', id, descricao);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao editar pendência.' });
  }
});

app.post('/api/pendencias/:id/concluir', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await transaction(async (tx) => {
      const row = await tx.get(
        'SELECT * FROM pendencias WHERE id = ? AND usuario_id = ?',
        [id, req.session.user.id]
      );
      if (!row) return { missing: true };
      if (row.status === 'Concluída') return { alreadyCompleted: true, proximaCriada: false };

      await tx.run(
        `UPDATE pendencias SET status = 'Concluída', concluido_em = CURRENT_TIMESTAMP,
         atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ? AND status != 'Concluída'`,
        [id, req.session.user.id]
      );

      let proximaCriada = false;
      if (row.repeticao === 'Semanal') {
        const base = row.data_tarefa ? new Date(`${row.data_tarefa}T12:00:00`) : new Date();
        base.setDate(base.getDate() + 7);
        const proximaData = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
        const next = await tx.run(
          `INSERT INTO pendencias (usuario_id, descricao, setor, data_tarefa, hora_tarefa, prioridade, status, repeticao)
           VALUES (?, ?, ?, ?, ?, ?, 'Aberta', 'Semanal')`,
          [row.usuario_id, row.descricao, row.setor || '', proximaData, row.hora_tarefa || '', row.prioridade || 'Média']
        );
        await tx.run(
          `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
           VALUES (?, ?, 'gerou próxima pendência semanal', 'pendencias', ?, ?)`,
          [req.session.user.id, req.session.user.nome, next.id, `${row.descricao} - ${proximaData}`]
        );
        proximaCriada = true;
      }
      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'concluiu pendência', 'pendencias', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, row.descricao]
      );
      return { proximaCriada };
    });
    if (result.missing) return res.status(404).json({ error: 'Pendência não encontrada.' });
    if (result.alreadyCompleted) return res.json({ ok: true, proximaCriada: false, jaConcluida: true });
    const { proximaCriada } = result;
    res.json({ ok: true, proximaCriada });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao concluir pendência.' });
  }
});

app.delete('/api/pendencias/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM pendencias WHERE id = ? AND usuario_id = ?', [id, req.session.user.id]);
    if (!row) return res.status(404).json({ error: 'Pendência não encontrada.' });

    await run('DELETE FROM pendencias WHERE id = ? AND usuario_id = ?', [id, req.session.user.id]);
    await logAction(req.session.user, 'excluiu pendência', 'pendencias', id, row.descricao);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir pendência.' });
  }
});

app.get('/api/manutencoes', requireAuth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM manutencoes WHERE status != 'Retornou' ORDER BY id DESC`
    );
    const items = rows.map(mapManutencao);

    for (const item of items) {
      item.anexos = await all(
        `SELECT id, nome_original AS nomeOriginal, nome_arquivo AS nomeArquivo,
         '/api/anexos/' || id AS caminho, anexado_por_nome AS anexadoPor, criado_em AS criadoEm
         FROM anexos_manutencao WHERE manutencao_id = ? ORDER BY id DESC`,
        [item.id]
      );
    }

    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao listar manutenções.' });
  }
});


app.get('/api/manutencoes-historico', requireAuth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM manutencoes
       WHERE status = 'Retornou'
       ORDER BY COALESCE(retornado_em, atualizado_em, criado_em) DESC, id DESC`
    );
    const items = rows.map(mapManutencao);

    for (const item of items) {
      item.anexos = await all(
        `SELECT id, nome_original AS nomeOriginal, nome_arquivo AS nomeArquivo,
         '/api/anexos/' || id AS caminho, anexado_por_nome AS anexadoPor, criado_em AS criadoEm
         FROM anexos_manutencao WHERE manutencao_id = ? ORDER BY id DESC`,
        [item.id]
      );
    }

    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao listar histórico de manutenções.' });
  }
});

app.post('/api/manutencoes', requireAuth, async (req, res) => {
  try {
    const parsed = manutencaoInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs } = parsed.value;
    if (status === 'Retornou') {
      return res.status(400).json({ error: 'Salve a manutenção e use a ação Retornou.' });
    }
    const result = await run(
      `INSERT INTO manutencoes (
        tipo, patrimonio, modelo, serial, responsavel, destino, data_envio, status, observacoes,
        criado_por_id, criado_por_nome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs,
        req.session.user.id, req.session.user.nome
      ]
    );

    await logAction(req.session.user, 'criou manutenção', 'manutencoes', result.id, `${tipo || 'Equipamento'} - ${modelo || ''}`);
    res.json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar manutenção.' });
  }
});

app.put('/api/manutencoes/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = manutencaoInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs } = parsed.value;
    if (status === 'Retornou') {
      return res.status(400).json({ error: 'Use a ação Retornou para finalizar a manutenção.' });
    }

    const result = await transaction(async (tx) => {
      const row = await tx.get('SELECT status FROM manutencoes WHERE id = ?', [id]);
      if (!row) return { missing: true };
      if (row.status === 'Retornou') return { returned: true };

      const updated = await tx.run(
        `UPDATE manutencoes
         SET tipo = ?, patrimonio = ?, modelo = ?, serial = ?, responsavel = ?, destino = ?, data_envio = ?, status = ?, observacoes = ?,
             atualizado_por_id = ?, atualizado_por_nome = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'Retornou'`,
        [tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs, req.session.user.id, req.session.user.nome, id]
      );
      if (updated.changes === 0) return { returned: true };

      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'editou manutenção', 'manutencoes', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, `${tipo || 'Equipamento'} - ${modelo || ''}`]
      );
      return { updated: true };
    });
    if (result.missing) return res.status(404).json({ error: 'Manutenção não encontrada.' });
    if (result.returned) {
      return res.status(409).json({
        error: 'Uma manutenção retornada deve ser reaberta antes de ser editada.'
      });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao editar manutenção.' });
  }
});

app.post('/api/manutencoes/:id/retornar', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM manutencoes WHERE id = ?', [id]);
      if (!row) return { missing: true };
      if (row.status === 'Retornou') return { alreadyReturned: true };

      const updated = await tx.run(
        `UPDATE manutencoes
         SET status = 'Retornou', retornado_por_id = ?, retornado_por_nome = ?,
             retornado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'Retornou'`,
        [req.session.user.id, req.session.user.nome, id]
      );
      if (updated.changes === 0) return { alreadyReturned: true };

      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'marcou manutenção como retornou', 'manutencoes', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, row.modelo || row.tipo || 'Equipamento']
      );
      return { returned: true };
    });
    if (result.missing) return res.status(404).json({ error: 'Manutenção não encontrada.' });
    if (result.alreadyReturned) return res.json({ ok: true, jaRetornada: true });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao marcar retorno.' });
  }
});


app.post('/api/manutencoes/:id/reabrir', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM manutencoes WHERE id = ?', [id]);
      if (!row) return { missing: true };
      if (row.status !== 'Retornou') return { active: true };

      const updated = await tx.run(
        `UPDATE manutencoes
         SET status = 'Em análise',
             retornado_por_id = NULL, retornado_por_nome = NULL, retornado_em = NULL,
             atualizado_por_id = ?, atualizado_por_nome = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'Retornou'`,
        [req.session.user.id, req.session.user.nome, id]
      );
      if (updated.changes === 0) return { active: true };

      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'reabriu manutenção', 'manutencoes', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, row.modelo || row.tipo || 'Equipamento']
      );
      return { reopened: true };
    });
    if (result.missing) return res.status(404).json({ error: 'Manutenção não encontrada.' });
    if (result.active) {
      return res.status(409).json({ error: 'Esta manutenção já está ativa.' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao reabrir manutenção.' });
  }
});

app.delete('/api/manutencoes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM manutencoes WHERE id = ?', [id]);
      if (!row) return null;
      const files = await tx.all('SELECT nome_arquivo FROM anexos_manutencao WHERE manutencao_id = ?', [id]);
      await tx.run('DELETE FROM anexos_manutencao WHERE manutencao_id = ?', [id]);
      await tx.run('DELETE FROM manutencoes WHERE id = ?', [id]);
      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'excluiu manutenção', 'manutencoes', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, row.modelo || row.tipo || 'Equipamento']
      );
      return files;
    });
    if (!deleted) return res.status(404).json({ error: 'Manutenção não encontrada.' });
    for (const file of deleted) {
      const target = path.join(uploadDir, path.basename(file.nome_arquivo));
      await fs.promises.unlink(target).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Falha ao remover anexo:', error);
      });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir manutenção.' });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const id = Number(req.params.id);
    get('SELECT id FROM manutencoes WHERE id = ?', [id])
      .then((row) => {
        if (!row) return cb(Object.assign(new Error('Manutenção não encontrada.'), { status: 404 }));
        req.manutencao = row;
        cb(null, uploadDir);
      })
      .catch(cb);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe.endsWith(ext) ? safe : safe + ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return cb(new Error('Apenas PDF é permitido.'));
    cb(null, true);
  }
});

app.post('/api/manutencoes/:id/anexos', requireAuth, upload.single('pdf'), async (req, res) => {
  let removeUploadedFileOnFailure = false;
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'Nenhum PDF enviado.' });
    removeUploadedFileOnFailure = true;
    const signature = Buffer.alloc(5);
    let handle;
    try {
      handle = await fs.promises.open(req.file.path, 'r');
      await handle.read(signature, 0, 5, 0);
    } finally {
      await handle?.close();
    }
    if (signature.toString('ascii') !== '%PDF-') {
      await fs.promises.unlink(req.file.path);
      removeUploadedFileOnFailure = false;
      return res.status(400).json({ error: 'O arquivo enviado não é um PDF válido.' });
    }

    const relPath = `/uploads/manutencoes/${req.file.filename}`;
    const result = await transaction(async (tx) => {
      const attachment = await tx.run(
        `INSERT INTO anexos_manutencao (
           manutencao_id, nome_original, nome_arquivo, caminho,
           anexado_por_id, anexado_por_nome, criado_em
         ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, text(req.file.originalname, 255), req.file.filename, relPath, req.session.user.id, req.session.user.nome]
      );
      await tx.run(
        `INSERT INTO historico (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
         VALUES (?, ?, 'anexou PDF', 'manutencoes', ?, ?)`,
        [req.session.user.id, req.session.user.nome, id, req.file.originalname]
      );
      return attachment;
    });
    removeUploadedFileOnFailure = false;
    res.json({ id: result.id, caminho: `/api/anexos/${result.id}` });
  } catch (error) {
    console.error(error);
    if (removeUploadedFileOnFailure && req.file?.path) {
      await fs.promises.unlink(req.file.path).catch(() => null);
    }
    res.status(500).json({ error: 'Erro ao anexar PDF.' });
  }
});

app.get('/api/anexos/:id', requireAuth, async (req, res, next) => {
  try {
    const attachment = await get(
      'SELECT nome_original, nome_arquivo FROM anexos_manutencao WHERE id = ?',
      [Number(req.params.id)]
    );
    if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado.' });
    const target = path.join(uploadDir, path.basename(attachment.nome_arquivo));
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(attachment.nome_original).replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(target);
  } catch (error) {
    next(error);
  }
});

// IPs cadastrados manualmente e compartilhados com a equipe.
app.get('/api/ips', requireAuth, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM ips_monitorados ORDER BY nome COLLATE NOCASE, ip`);
    res.json(rows.map(mapIpMonitorado));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao listar IPs.' });
  }
});

app.post('/api/ips', requireAuth, async (req, res) => {
  try {
    const categoria = normalizeIpCategory(req.body.categoria);
    const nome = text(req.body.nome, 150);
    const ip = text(req.body.ip, 15);
    const setor = text(req.body.setor, 100);
    const observacoes = text(req.body.observacoes, 1000);

    if (!nome) return res.status(400).json({ error: 'Informe o nome do equipamento.' });
    if (!net.isIPv4(ip)) return res.status(400).json({ error: 'Informe um endereço IPv4 válido.' });

    const existente = await get('SELECT id FROM ips_monitorados WHERE ip = ?', [ip]);
    if (existente) return res.status(409).json({ error: 'Este IP já está cadastrado.' });

    const result = await run(
      `INSERT INTO ips_monitorados (categoria, nome, ip, setor, observacoes, criado_por_id, criado_por_nome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [categoria, nome, ip, setor, observacoes, req.session.user.id, req.session.user.nome]
    );

    const row = await get('SELECT * FROM ips_monitorados WHERE id = ?', [result.id]);
    const item = await verificarIpSalvo(row);
    await logAction(req.session.user, 'cadastrou IP', 'ips_monitorados', result.id, `${nome} - ${ip}`);
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao cadastrar IP.' });
  }
});

app.put('/api/ips/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const atual = await get('SELECT * FROM ips_monitorados WHERE id = ?', [id]);
    if (!atual) return res.status(404).json({ error: 'IP não encontrado.' });

    const categoria = normalizeIpCategory(req.body.categoria);
    const nome = text(req.body.nome, 150);
    const ip = text(req.body.ip, 15);
    const setor = text(req.body.setor, 100);
    const observacoes = text(req.body.observacoes, 1000);

    if (!nome) return res.status(400).json({ error: 'Informe o nome do equipamento.' });
    if (!net.isIPv4(ip)) return res.status(400).json({ error: 'Informe um endereço IPv4 válido.' });

    const duplicado = await get('SELECT id FROM ips_monitorados WHERE ip = ? AND id != ?', [ip, id]);
    if (duplicado) return res.status(409).json({ error: 'Este IP já está cadastrado.' });

    await run(
      `UPDATE ips_monitorados
       SET categoria = ?, nome = ?, ip = ?, setor = ?, observacoes = ?, status = 'Não verificado',
           tempo_ms = NULL, verificado_em = NULL, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [categoria, nome, ip, setor, observacoes, id]
    );

    const row = await get('SELECT * FROM ips_monitorados WHERE id = ?', [id]);
    const item = await verificarIpSalvo(row);
    await logAction(req.session.user, 'editou IP', 'ips_monitorados', id, `${nome} - ${ip}`);
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao editar IP.' });
  }
});

app.delete('/api/ips/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM ips_monitorados WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'IP não encontrado.' });

    await run('DELETE FROM ips_monitorados WHERE id = ?', [id]);
    await logAction(req.session.user, 'excluiu IP', 'ips_monitorados', id, `${row.nome} - ${row.ip}`);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir IP.' });
  }
});

app.post('/api/ips/:id/verificar', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM ips_monitorados WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'IP não encontrado.' });

    const item = await verificarIpSalvo(row);
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao verificar IP.' });
  }
});

app.post('/api/ips/verificar-todos', requireAuth, async (req, res) => {
  try {
    const rows = await all('SELECT * FROM ips_monitorados ORDER BY id');
    const resultados = [];
    const limite = 8;

    for (let i = 0; i < rows.length; i += limite) {
      const lote = rows.slice(i, i + limite);
      const itens = await Promise.all(lote.map(verificarIpSalvo));
      resultados.push(...itens);
    }

    resultados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json(resultados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao verificar os IPs.' });
  }
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const pendencias = await get(`SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND status != 'Concluída'`, [req.session.user.id]);
    const hoje = localDateISO();
    const atrasadas = await get(`SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND status != 'Concluída' AND data_tarefa != '' AND data_tarefa < ?`, [req.session.user.id, hoje]);
    const hojeCount = await get(`SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND status != 'Concluída' AND data_tarefa = ?`, [req.session.user.id, hoje]);
    const proximas = await get(`SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND status != 'Concluída' AND data_tarefa != '' AND data_tarefa > ?`, [req.session.user.id, hoje]);
    const manutencoes = await get(`SELECT COUNT(*) AS total FROM manutencoes WHERE status != 'Retornou'`);
    const next = await get(`SELECT * FROM pendencias WHERE usuario_id = ? AND status != 'Concluída' ORDER BY COALESCE(data_tarefa, '9999-12-31'), COALESCE(hora_tarefa, '99:99'), id DESC LIMIT 1`, [req.session.user.id]);

    res.json({
      pendencias: pendencias.total,
      atrasadas: atrasadas.total,
      hoje: hojeCount.total,
      proximas: proximas.total,
      manutencoes: manutencoes.total,
      proximaTarefa: next ? mapPendencia(next) : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar resumo.' });
  }
});

app.use((error, req, res, next) => {
  console.error("Erro no servidor:", error);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "O PDF ultrapassa o limite de 50 MB."
      });
    }

    return res.status(400).json({
      error: `Erro no envio do arquivo: ${error.message}`
    });
  }

  if (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      error: status < 500 ? error.message : "Erro interno no servidor."
    });
  }

  next();
});

async function startServer(port = PORT, host = '0.0.0.0') {
  await initDB();
  await run('DELETE FROM sessoes WHERE expira_em <= ?', [Date.now()]);
  const sessionCleanup = setInterval(() => {
    run('DELETE FROM sessoes WHERE expira_em <= ?', [Date.now()]).catch(console.error);
  }, 60 * 60 * 1000);
  sessionCleanup.unref();

  const server = app.listen(port, host);
  try {
    await new Promise((resolve, reject) => {
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      server.once('listening', onListening);
      server.once('error', onError);
    });
  } catch (error) {
    clearInterval(sessionCleanup);
    throw error;
  }
  server.once('close', () => clearInterval(sessionCleanup));

  console.log('');
  console.log('==========================================');
  console.log('        Rotina TI iniciado com sucesso');
  console.log('==========================================');
  const actualPort = server.address().port;
  const hostname = os.hostname();
  console.log(`http://localhost:${actualPort}`);
  console.log(`http://${hostname}:${actualPort}`);
  console.log('');
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`ERRO: a porta ${PORT} já está ocupada por outro programa.`);
    } else {
      console.error('Erro ao iniciar o Rotina TI:', error);
    }
    process.exit(1);
  });
}

module.exports = { app, startServer, uploadDir };
