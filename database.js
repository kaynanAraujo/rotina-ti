const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);
let operationQueue = Promise.resolve();

function rawRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function rawGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function rawAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function withLock(operation) {
  const previous = operationQueue;
  let release;
  operationQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function run(sql, params = []) {
  return withLock(() => rawRun(sql, params));
}

function get(sql, params = []) {
  return withLock(() => rawGet(sql, params));
}

function all(sql, params = []) {
  return withLock(() => rawAll(sql, params));
}

function transaction(work) {
  return withLock(async () => {
    await rawRun('BEGIN IMMEDIATE');
    const tx = { run: rawRun, get: rawGet, all: rawAll };
    try {
      const result = await work(tx);
      await rawRun('COMMIT');
      return result;
    } catch (error) {
      await rawRun('ROLLBACK').catch(() => null);
      throw error;
    }
  });
}

async function ensureColumns(table, definitions) {
  const columns = await all(`PRAGMA table_info("${table}")`);
  const existing = new Set(columns.map((column) => column.name));

  for (const [name, definition] of Object.entries(definitions)) {
    if (existing.has(name)) continue;
    await run(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`);
    existing.add(name);
  }
}

async function initDB() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA busy_timeout = 5000');
  await run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL DEFAULT 'tecnico',
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pendencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      setor TEXT,
      data_tarefa TEXT,
      hora_tarefa TEXT,
      prioridade TEXT,
      status TEXT NOT NULL DEFAULT 'Aberta',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT,
      concluido_em TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  await ensureColumns('pendencias', {
    repeticao: "TEXT NOT NULL DEFAULT 'Nenhuma'"
  });

  await run(`
    CREATE TABLE IF NOT EXISTS manutencoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT,
      patrimonio TEXT,
      modelo TEXT,
      serial TEXT,
      responsavel TEXT,
      destino TEXT,
      data_envio TEXT,
      status TEXT NOT NULL DEFAULT 'Enviado',
      observacoes TEXT,
      criado_por_id INTEGER,
      criado_por_nome TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_por_id INTEGER,
      atualizado_por_nome TEXT,
      atualizado_em TEXT,
      retornado_por_id INTEGER,
      retornado_por_nome TEXT,
      retornado_em TEXT,
      FOREIGN KEY (criado_por_id) REFERENCES usuarios(id)
    )
  `);
  await ensureColumns('manutencoes', {
    criado_por_id: 'INTEGER',
    criado_por_nome: 'TEXT',
    atualizado_por_id: 'INTEGER',
    atualizado_por_nome: 'TEXT',
    atualizado_em: 'TEXT',
    retornado_por_id: 'INTEGER',
    retornado_por_nome: 'TEXT',
    retornado_em: 'TEXT'
  });

  await run(`
    CREATE TABLE IF NOT EXISTS anexos_manutencao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manutencao_id INTEGER NOT NULL,
      nome_original TEXT NOT NULL,
      nome_arquivo TEXT NOT NULL,
      caminho TEXT NOT NULL,
      anexado_por_id INTEGER,
      anexado_por_nome TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manutencao_id) REFERENCES manutencoes(id)
    )
  `);
  await ensureColumns('anexos_manutencao', {
    anexado_por_id: 'INTEGER',
    anexado_por_nome: 'TEXT',
    criado_em: 'TEXT'
  });

  await run(`
    CREATE TABLE IF NOT EXISTS historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      acao TEXT NOT NULL,
      entidade TEXT,
      entidade_id INTEGER,
      detalhes TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS ips_monitorados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria TEXT NOT NULL DEFAULT 'Outro',
      nome TEXT NOT NULL,
      ip TEXT NOT NULL,
      setor TEXT,
      observacoes TEXT,
      status TEXT NOT NULL DEFAULT 'Não verificado',
      tempo_ms INTEGER,
      verificado_em TEXT,
      criado_por_id INTEGER,
      criado_por_nome TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT,
      FOREIGN KEY (criado_por_id) REFERENCES usuarios(id)
    )
  `);

  await ensureColumns('ips_monitorados', {
    categoria: "TEXT NOT NULL DEFAULT 'Outro'"
  });
  await run(`UPDATE ips_monitorados SET categoria = 'Outro' WHERE categoria IS NULL OR TRIM(categoria) = ''`);

  // Migra o UNIQUE(ip) legado para a unicidade por usuário, preservando ids e dados.
  const ipSchema = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ips_monitorados'");
  if (ipSchema?.sql && /ip\s+TEXT[^,]*UNIQUE/i.test(ipSchema.sql)) {
    const legacyColumns = new Set((await all('PRAGMA table_info(ips_monitorados)')).map((column) => column.name));
    const legacyValue = (column, fallback) => legacyColumns.has(column) ? `"${column}"` : fallback;
    await transaction(async (tx) => {
      await tx.run('ALTER TABLE ips_monitorados RENAME TO ips_monitorados_legado');
      await tx.run(`
        CREATE TABLE ips_monitorados (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          categoria TEXT NOT NULL DEFAULT 'Outro',
          nome TEXT NOT NULL,
          ip TEXT NOT NULL,
          setor TEXT,
          observacoes TEXT,
          status TEXT NOT NULL DEFAULT 'NÃ£o verificado',
          tempo_ms INTEGER,
          verificado_em TEXT,
          criado_por_id INTEGER,
          criado_por_nome TEXT,
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          atualizado_em TEXT,
          FOREIGN KEY (criado_por_id) REFERENCES usuarios(id)
        )
      `);
      await tx.run(`
        INSERT INTO ips_monitorados (
          id, categoria, nome, ip, setor, observacoes, status, tempo_ms,
          verificado_em, criado_por_id, criado_por_nome, criado_em, atualizado_em
        ) SELECT
          ${legacyValue('id', 'NULL')},
          ${legacyValue('categoria', "'Outro'")},
          ${legacyValue('nome', "''")},
          ${legacyValue('ip', "''")},
          ${legacyValue('setor', 'NULL')},
          ${legacyValue('observacoes', 'NULL')},
          ${legacyValue('status', "'NÃ£o verificado'")},
          ${legacyValue('tempo_ms', 'NULL')},
          ${legacyValue('verificado_em', 'NULL')},
          ${legacyValue('criado_por_id', 'NULL')},
          ${legacyValue('criado_por_nome', 'NULL')},
          ${legacyValue('criado_em', 'CURRENT_TIMESTAMP')},
          ${legacyValue('atualizado_em', 'NULL')}
        FROM ips_monitorados_legado
      `);
      await tx.run('DROP TABLE ips_monitorados_legado');
      await tx.run('CREATE UNIQUE INDEX IF NOT EXISTS uq_ips_monitorados_usuario_ip ON ips_monitorados(criado_por_id, ip)');
    });
  } else {
    await run('CREATE UNIQUE INDEX IF NOT EXISTS uq_ips_monitorados_usuario_ip ON ips_monitorados(criado_por_id, ip)');
  }

  await run(`
    CREATE TABLE IF NOT EXISTS monitoramentos_ip (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_monitorado_id INTEGER NOT NULL,
      iniciado_por_id INTEGER,
      iniciado_por_nome TEXT,
      iniciado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      encerrado_em TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      duracao_minutos INTEGER,
      total_verificacoes INTEGER NOT NULL DEFAULT 0,
      falhas_ping INTEGER NOT NULL DEFAULT 0,
      quedas INTEGER NOT NULL DEFAULT 0,
      tempo_offline_ms INTEGER NOT NULL DEFAULT 0,
      maior_queda_ms INTEGER NOT NULL DEFAULT 0,
      status_atual TEXT NOT NULL DEFAULT 'Iniciando',
      offline_desde TEXT,
      FOREIGN KEY (ip_monitorado_id) REFERENCES ips_monitorados(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS monitoramento_ip_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitoramento_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      status TEXT,
      tempo_ms INTEGER,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (monitoramento_id) REFERENCES monitoramentos_ip(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sessoes (
      sid TEXT PRIMARY KEY,
      sessao TEXT NOT NULL,
      expira_em INTEGER NOT NULL
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_pendencias_usuario_status_data
             ON pendencias(usuario_id, status, data_tarefa)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_anexos_manutencao_id
             ON anexos_manutencao(manutencao_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_manutencoes_status
             ON manutencoes(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_historico_entidade
             ON historico(entidade, entidade_id, criado_em)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_sessoes_expiracao
             ON sessoes(expira_em)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_monitoramentos_ip_ativos
             ON monitoramentos_ip(ip_monitorado_id, ativo)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_monitoramento_ip_eventos
             ON monitoramento_ip_eventos(monitoramento_id, criado_em)`);
}

module.exports = { db, run, get, all, transaction, initDB, dbPath };
