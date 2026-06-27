const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { run, get, all, initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads', 'manutencoes');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'rotina-ti-local-secret-change-later',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 10 }
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
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
    concluidoEm: row.concluido_em
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');

    if (!nome || !usuario || !senha) {
      return res.status(400).json({ error: 'Preencha nome, usuário e senha.' });
    }

    if (usuario.length < 3) {
      return res.status(400).json({ error: 'Usuário deve ter pelo menos 3 caracteres.' });
    }

    if (senha.length < 4) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres.' });
    }

    const existing = await get('SELECT id FROM usuarios WHERE usuario = ?', [usuario]);
    if (existing) {
      return res.status(409).json({ error: 'Este usuário já existe.' });
    }

    const total = await get('SELECT COUNT(*) AS total FROM usuarios');
    const perfil = total.total === 0 ? 'admin' : 'tecnico';
    const senhaHash = await bcrypt.hash(senha, 10);

    const result = await run(
      `INSERT INTO usuarios (nome, usuario, senha_hash, perfil) VALUES (?, ?, ?, ?)`,
      [nome, usuario, senhaHash, perfil]
    );

    req.session.user = { id: result.id, nome, usuario, perfil };
    await logAction(req.session.user, 'criou conta', 'usuarios', result.id, `Perfil: ${perfil}`);

    res.json({ user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/pendencias', requireAuth, async (req, res) => {
  try {
    const { descricao, setor, data, hora, prioridade, status } = req.body;
    if (!String(descricao || '').trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const result = await run(
      `INSERT INTO pendencias (usuario_id, descricao, setor, data_tarefa, hora_tarefa, prioridade, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.session.user.id, descricao, setor || '', data || '', hora || '', prioridade || 'Média', status || 'Aberta']
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

    const { descricao, setor, data, hora, prioridade, status } = req.body;
    await run(
      `UPDATE pendencias
       SET descricao = ?, setor = ?, data_tarefa = ?, hora_tarefa = ?, prioridade = ?, status = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND usuario_id = ?`,
      [descricao, setor || '', data || '', hora || '', prioridade || 'Média', status || 'Aberta', id, req.session.user.id]
    );

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
    const row = await get('SELECT * FROM pendencias WHERE id = ? AND usuario_id = ?', [id, req.session.user.id]);
    if (!row) return res.status(404).json({ error: 'Pendência não encontrada.' });

    await run(
      `UPDATE pendencias SET status = 'Concluída', concluido_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?`,
      [id, req.session.user.id]
    );

    await logAction(req.session.user, 'concluiu pendência', 'pendencias', id, row.descricao);
    res.json({ ok: true });
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
        `SELECT id, nome_original AS nomeOriginal, nome_arquivo AS nomeArquivo, caminho, anexado_por_nome AS anexadoPor, criado_em AS criadoEm
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

app.post('/api/manutencoes', requireAuth, async (req, res) => {
  try {
    const { tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs } = req.body;
    const result = await run(
      `INSERT INTO manutencoes (
        tipo, patrimonio, modelo, serial, responsavel, destino, data_envio, status, observacoes,
        criado_por_id, criado_por_nome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tipo || 'Outro', patrimonio || '', modelo || '', serial || '', responsavel || '', destino || '', dataEnvio || '', status || 'Enviado', obs || '',
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
    const row = await get('SELECT * FROM manutencoes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Manutenção não encontrada.' });

    const { tipo, patrimonio, modelo, serial, responsavel, destino, dataEnvio, status, obs } = req.body;
    await run(
      `UPDATE manutencoes
       SET tipo = ?, patrimonio = ?, modelo = ?, serial = ?, responsavel = ?, destino = ?, data_envio = ?, status = ?, observacoes = ?,
           atualizado_por_id = ?, atualizado_por_nome = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [tipo || 'Outro', patrimonio || '', modelo || '', serial || '', responsavel || '', destino || '', dataEnvio || '', status || 'Enviado', obs || '', req.session.user.id, req.session.user.nome, id]
    );

    await logAction(req.session.user, 'editou manutenção', 'manutencoes', id, `${tipo || 'Equipamento'} - ${modelo || ''}`);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao editar manutenção.' });
  }
});

app.post('/api/manutencoes/:id/retornar', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM manutencoes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Manutenção não encontrada.' });

    await run(
      `UPDATE manutencoes
       SET status = 'Retornou', retornado_por_id = ?, retornado_por_nome = ?, retornado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.session.user.id, req.session.user.nome, id]
    );

    await logAction(req.session.user, 'marcou manutenção como retornou', 'manutencoes', id, row.modelo || row.tipo || 'Equipamento');
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao marcar retorno.' });
  }
});

app.delete('/api/manutencoes/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM manutencoes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Manutenção não encontrada.' });

    await run('DELETE FROM anexos_manutencao WHERE manutencao_id = ?', [id]);
    await run('DELETE FROM manutencoes WHERE id = ?', [id]);
    await logAction(req.session.user, 'excluiu manutenção', 'manutencoes', id, row.modelo || row.tipo || 'Equipamento');
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir manutenção.' });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe.endsWith(ext) ? safe : safe + ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return cb(new Error('Apenas PDF é permitido.'));
    cb(null, true);
  }
});

app.post('/api/manutencoes/:id/anexos', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM manutencoes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Manutenção não encontrada.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum PDF enviado.' });

    const relPath = `/uploads/manutencoes/${req.file.filename}`;
    const result = await run(
      `INSERT INTO anexos_manutencao (manutencao_id, nome_original, nome_arquivo, caminho, anexado_por_id, anexado_por_nome)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.file.originalname, req.file.filename, relPath, req.session.user.id, req.session.user.nome]
    );

    await logAction(req.session.user, 'anexou PDF', 'manutencoes', id, req.file.originalname);
    res.json({ id: result.id, caminho: relPath });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erro ao anexar PDF.' });
  }
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const pendencias = await get(`SELECT COUNT(*) AS total FROM pendencias WHERE usuario_id = ? AND status != 'Concluída'`, [req.session.user.id]);
    const hoje = new Date().toISOString().slice(0, 10);
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

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const hostname = os.hostname();

    console.log('');
    console.log('==========================================');
    console.log('        Rotina TI iniciado com sucesso');
    console.log('==========================================');
    console.log(`Neste PC: http://localhost:${PORT}`);
    console.log(`Na rede:  http://${hostname}:${PORT}`);
    console.log('');
  });
}).catch((error) => {
  console.error('Erro ao iniciar banco:', error);
  process.exit(1);
});
