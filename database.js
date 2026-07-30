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
      ip TEXT NOT NULL UNIQUE,
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
}

module.exports = { db, run, get, all, transaction, initDB, dbPath };
