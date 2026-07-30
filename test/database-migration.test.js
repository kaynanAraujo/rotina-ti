const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = path.resolve(__dirname, '..');
const tempBase = path.resolve(os.tmpdir());
const tempDir = fs.mkdtempSync(path.join(tempBase, 'rotina-ti-migration-'));
const legacyDbPath = path.join(tempDir, 'legacy.db');

assert.ok(tempDir.startsWith(`${tempBase}${path.sep}`));
assert.ok(!tempDir.startsWith(`${projectRoot}${path.sep}`));

process.env.DB_PATH = legacyDbPath;

let database;

function createLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const legacyDb = new sqlite3.Database(legacyDbPath);
    legacyDb.exec(
      `
        PRAGMA foreign_keys = ON;

        CREATE TABLE usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          usuario TEXT NOT NULL UNIQUE,
          senha_hash TEXT NOT NULL,
          perfil TEXT NOT NULL DEFAULT 'tecnico',
          ativo INTEGER NOT NULL DEFAULT 1,
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE pendencias (
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
        );

        CREATE TABLE ips_monitorados (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        );

        CREATE TABLE manutencoes (
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
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE anexos_manutencao (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          manutencao_id INTEGER NOT NULL,
          nome_original TEXT NOT NULL,
          nome_arquivo TEXT NOT NULL,
          caminho TEXT NOT NULL,
          FOREIGN KEY (manutencao_id) REFERENCES manutencoes(id)
        );

        INSERT INTO usuarios (
          nome, usuario, senha_hash, perfil
        ) VALUES (
          'Usuário legado', 'legado', 'hash-legado', 'admin'
        );

        INSERT INTO pendencias (
          usuario_id, descricao, setor, data_tarefa, hora_tarefa, prioridade
        ) VALUES (
          1, 'Pendência preservada', 'TI', '2026-07-28', '09:30', 'Alta'
        );

        INSERT INTO manutencoes (
          tipo, patrimonio, modelo, serial, responsavel, destino,
          data_envio, status, observacoes
        ) VALUES (
          'Notebook', 'LEG-100', 'Modelo legado', 'SERIAL-LEGADO',
          'TI', 'Assistência', '2026-07-20', 'Enviado', 'Registro preservado'
        );

        INSERT INTO anexos_manutencao (
          manutencao_id, nome_original, nome_arquivo, caminho
        ) VALUES (
          1, 'legado.pdf', 'legado.pdf', '/uploads/manutencoes/legado.pdf'
        );

        INSERT INTO ips_monitorados (
          nome, ip, setor, observacoes, criado_por_id, criado_por_nome
        ) VALUES (
          'Servidor legado', '192.0.2.10', 'TI', 'Não apagar', 1, 'Usuário legado'
        );
      `,
      (error) => {
        legacyDb.close((closeError) => {
          if (error || closeError) reject(error || closeError);
          else resolve();
        });
      }
    );
  });
}

test.before(async () => {
  await createLegacyDatabase();
  database = require('../database');
  await database.initDB();
});

test.after(async () => {
  if (database?.db) {
    await new Promise((resolve) => database.db.close(resolve));
  }

  const resolvedTempDir = path.resolve(tempDir);
  assert.ok(resolvedTempDir.startsWith(`${tempBase}${path.sep}`));
  fs.rmSync(resolvedTempDir, { recursive: true, force: true });
});

test('migra colunas novas sem apagar registros de um banco legado', async () => {
  const pendingColumns = await database.all('PRAGMA table_info(pendencias)');
  const ipColumns = await database.all('PRAGMA table_info(ips_monitorados)');
  const maintenanceColumns = await database.all('PRAGMA table_info(manutencoes)');
  const attachmentColumns = await database.all('PRAGMA table_info(anexos_manutencao)');

  assert.ok(pendingColumns.some((column) => column.name === 'repeticao'));
  assert.ok(ipColumns.some((column) => column.name === 'categoria'));
  for (const columnName of [
    'criado_por_id',
    'criado_por_nome',
    'atualizado_por_id',
    'atualizado_por_nome',
    'atualizado_em',
    'retornado_por_id',
    'retornado_por_nome',
    'retornado_em'
  ]) {
    assert.ok(maintenanceColumns.some((column) => column.name === columnName));
  }
  for (const columnName of ['anexado_por_id', 'anexado_por_nome', 'criado_em']) {
    assert.ok(attachmentColumns.some((column) => column.name === columnName));
  }

  const pending = await database.get(
    'SELECT descricao, setor, repeticao FROM pendencias WHERE id = 1'
  );
  assert.deepEqual(pending, {
    descricao: 'Pendência preservada',
    setor: 'TI',
    repeticao: 'Nenhuma'
  });

  const monitoredIp = await database.get(
    'SELECT nome, ip, observacoes, categoria FROM ips_monitorados WHERE id = 1'
  );
  assert.deepEqual(monitoredIp, {
    nome: 'Servidor legado',
    ip: '192.0.2.10',
    observacoes: 'Não apagar',
    categoria: 'Outro'
  });

  const maintenance = await database.get(
    'SELECT tipo, patrimonio, modelo, observacoes FROM manutencoes WHERE id = 1'
  );
  assert.deepEqual(maintenance, {
    tipo: 'Notebook',
    patrimonio: 'LEG-100',
    modelo: 'Modelo legado',
    observacoes: 'Registro preservado'
  });

  const attachment = await database.get(
    'SELECT manutencao_id, nome_original, nome_arquivo FROM anexos_manutencao WHERE id = 1'
  );
  assert.deepEqual(attachment, {
    manutencao_id: 1,
    nome_original: 'legado.pdf',
    nome_arquivo: 'legado.pdf'
  });

  const user = await database.get(
    'SELECT nome, usuario, perfil FROM usuarios WHERE id = 1'
  );
  assert.deepEqual(user, {
    nome: 'Usuário legado',
    usuario: 'legado',
    perfil: 'admin'
  });

  const integrity = await database.get('PRAGMA integrity_check');
  assert.equal(integrity.integrity_check, 'ok');
});
