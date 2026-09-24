const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(projectRoot, 'public', 'script.js'), 'utf8');
const dashboardModel = fs.readFileSync(
  path.join(projectRoot, 'public', 'dashboard-model.js'),
  'utf8'
);

function htmlIds(source) {
  return [...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Marcador inicial ausente: ${startMarker}`);
  assert.ok(end > start, `Marcador final ausente: ${endMarker}`);
  return source.slice(start, end);
}

test('mantém IDs únicos e todas as referências estáticas do JavaScript', () => {
  const ids = htmlIds(html);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, 'O HTML não pode conter IDs duplicados.');

  const referencedIds = [
    ...script.matchAll(
      /\$\(["']([^"']+)["']\)|getElementById\(["']([^"']+)["']\)/g
    )
  ].map((match) => match[1] || match[2]);

  for (const id of new Set(referencedIds)) {
    assert.ok(uniqueIds.has(id), `O JavaScript referencia o ID HTML ausente: ${id}`);
  }

  for (const requiredId of [
    'authScreen',
    'appContent',
    'logoutBtn',
    'pendenciaForm',
    'manutencaoForm',
    'manutencaoPdf',
    'manutencoesList',
    'historicoManutencoesList',
    'ipForm',
    'ipsList',
    'dashboard',
    'dashboardGreeting',
    'dashboardFullDate',
    'dashboardRefresh',
    'dashboardStatus',
    'dashboardPendenciasAbertas',
    'dashboardPendenciasAtrasadas',
    'dashboardTarefasHoje',
    'dashboardConcluidas7Dias',
    'dashboardManutencoesAtivas',
    'dashboardAguardandoRetorno',
    'dashboardIpsTotal',
    'dashboardIpsOffline',
    'dashboardPrioridadeChart',
    'dashboardManutencaoChart',
    'dashboardIpChart',
    'dashboardProximasList',
    'dashboardManutencoesList',
    'dashboardOfflineList',
    'dashboardActivitiesList'
  ]) {
    assert.ok(uniqueIds.has(requiredId), `ID obrigatório ausente: ${requiredId}`);
  }
});

test('Dashboard é a primeira tela, usa cards acessíveis e mantém todas as abas existentes', () => {
  const tabSection = html.match(
    /<section class="tabs"[\s\S]*?<\/section>/
  );
  assert.ok(tabSection);

  const tabTargets = [
    ...tabSection[0].matchAll(
      /class="[^"]*\btab\b[^"]*"\s+data-tab="([^"]+)"/g
    )
  ].map((match) => match[1]);
  assert.deepEqual(tabTargets, [
    'dashboard',
    'pendencias',
    'manutencao',
    'historicoTarefas',
    'historicoManutencoes',
    'monitorIps',
    'administracao'
  ]);
  assert.match(
    tabSection[0],
    /class="tab active"\s+data-tab="dashboard"/
  );
  assert.match(html, /id="dashboard"\s+class="panel dashboard-panel active"/);
  assert.doesNotMatch(html, /id="pendencias"\s+class="panel active"/);

  const dashboardPanel = html.match(
    /<section\s+id="dashboard"[\s\S]*?<section id="pendencias"/
  );
  assert.ok(dashboardPanel);
  const metricCards = [
    ...dashboardPanel[0].matchAll(
      /<button\s+class="dashboard-metric-card[^"]*"[\s\S]*?data-dashboard-target="([^"]+)"[\s\S]*?>/g
    )
  ];
  assert.equal(metricCards.length, 8);
  assert.ok(
    metricCards.every((match) => /type="button"/.test(match[0])),
    'Todos os indicadores precisam ser botões sem submissão de formulário.'
  );
  assert.match(
    dashboardPanel[0],
    /data-dashboard-target="monitorIps"\s+data-dashboard-filter="offline"/
  );
  assert.match(script, /function activatePanel\s*\(/);
  assert.match(script, /function setupDashboard\s*\(/);
  assert.match(script, /ipBusca[\s\S]*filter === "offline"/);
});

test('Dashboard é local, deduplica carregamentos e não cria polling', () => {
  assert.match(dashboardModel, /function buildDashboardModel\s*\(/);
  assert.match(dashboardModel, /root\.RotinaDashboardModel\s*=\s*factory\(\)/);
  assert.doesNotMatch(dashboardModel, /\b(fetch|XMLHttpRequest|setInterval)\s*\(/);
  assert.match(script, /if\s*\(loadAllPromise\)\s*return loadAllPromise/);
  assert.match(script, /Promise\.allSettled\s*\(/);
  assert.doesNotMatch(script, /\bsetInterval\s*\(/);

  const externalAssets = [
    ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)
  ].map((match) => match[1]);
  assert.ok(
    externalAssets.every(
      (asset) =>
        !/^https?:\/\//i.test(asset) && !/^\/\//.test(asset)
    ),
    'O Dashboard não pode depender de CDN ou recurso externo.'
  );
});

test('Monitor de IPs verifica automaticamente sem sobrepor execuções ou alterar o fluxo manual', () => {
  assert.match(script, /const IP_AUTO_CHECK_INTERVAL_MS\s*=\s*3000;/);
  assert.match(script, /let autoIpCheckTimer\s*=\s*null;/);
  assert.match(script, /let autoIpCheckRunning\s*=\s*false;/);
  assert.match(script, /let ipCheckPromise\s*=\s*null;/);

  const automaticCheck = sourceSection(
    script,
    'async function executarAutoVerificacaoIps()',
    'function agendarAutoVerificacaoIps()'
  );
  assert.match(automaticCheck, /if\s*\(autoIpCheckRunning\)\s*return;/);
  assert.match(
    automaticCheck,
    /document\.getElementById\(["']appContent["']\)/
  );
  assert.match(
    automaticCheck,
    /await verificarTodosIps\(\{\s*silent:\s*true\s*\}\);/
  );
  assert.doesNotMatch(automaticCheck, /\.(?:click|dispatchEvent)\s*\(/);
  assert.match(
    automaticCheck,
    /finally\s*\{[\s\S]*?autoIpCheckRunning\s*=\s*false;[\s\S]*?agendarAutoVerificacaoIps\(\);/
  );

  const scheduler = sourceSection(
    script,
    'function agendarAutoVerificacaoIps()',
    'function iniciarAutoVerificacaoIps()'
  );
  const clearPosition = scheduler.indexOf('clearTimeout(autoIpCheckTimer)');
  const setPosition = scheduler.indexOf('autoIpCheckTimer = setTimeout(');
  assert.ok(clearPosition >= 0);
  assert.ok(setPosition > clearPosition);
  assert.match(
    scheduler,
    /setTimeout\(\s*executarAutoVerificacaoIps,\s*IP_AUTO_CHECK_INTERVAL_MS/
  );

  const start = sourceSection(
    script,
    'function iniciarAutoVerificacaoIps()',
    'function pararAutoVerificacaoIps()'
  );
  assert.match(start, /autoIpCheckEnabled\s*=\s*true;/);
  assert.match(start, /agendarAutoVerificacaoIps\(\);/);

  const stop = sourceSection(
    script,
    'function pararAutoVerificacaoIps()',
    'async function verificarTodosIps('
  );
  assert.match(stop, /autoIpCheckEnabled\s*=\s*false;/);
  assert.match(stop, /clearTimeout\(autoIpCheckTimer\);/);
  assert.match(stop, /autoIpCheckTimer\s*=\s*null;/);

  const verification = sourceSection(
    script,
    'async function verificarTodosIps(',
    'async function deleteIp('
  );
  assert.match(
    verification,
    /async function verificarTodosIps\(\{\s*silent\s*=\s*false\s*\}\s*=\s*\{\}\)/
  );
  assert.match(verification, /\/api\/ips\/verificar-todos/);
  assert.match(verification, /trackBusy:\s*false/);
  assert.match(verification, /let operation\s*=\s*ipCheckPromise;/);
  assert.match(verification, /if\s*\(!operation\)\s*\{/);
  assert.match(verification, /ipCheckPromise\s*=\s*operation;/);
  assert.match(verification, /await operation;/);
  assert.match(verification, /renderIps\(\);\s*renderDashboard\(\);/);
  assert.match(
    verification,
    /if\s*\(!silent\s*&&\s*button\)\s*\{[\s\S]*?Verificando\.\.\./
  );
  assert.match(
    verification,
    /if\s*\(!silent\)\s*\{[\s\S]*?const online[\s\S]*?IPs responderam/
  );
  assert.match(verification, /if\s*\(silent\)\s*throw error;/);
  assert.match(
    verification,
    /if\s*\(ipCheckPromise\s*===\s*operation\)\s*\{[\s\S]*?ipCheckPromise\s*=\s*null;/
  );

  const startsAfterInitialLoad =
    script.match(
      /await loadAll\(\);\s*iniciarAutoVerificacaoIps\(\);/g
    ) || [];
  assert.equal(startsAfterInitialLoad.length, 3);
  assert.doesNotMatch(
    sourceSection(script, 'function showApp()', 'function showAuth()'),
    /iniciarAutoVerificacaoIps/
  );
  assert.doesNotMatch(
    sourceSection(script, 'async function loadAll()', 'async function loadPendencias()'),
    /iniciarAutoVerificacaoIps/
  );
  assert.match(
    script,
    /api\(["']\/api\/auth\/logout["'][\s\S]*?pararAutoVerificacaoIps\(\);[\s\S]*?location\.reload\(\);/
  );
  assert.match(
    script,
    /verificarTodosIps["']\)\.addEventListener\(["']click["'],\s*\(\)\s*=>\s*verificarTodosIps\(\)/
  );
});

test('seleciona vários PDFs e preserva um envio por requisição', () => {
  const formInput = html.match(/<input[\s\S]*?id="manutencaoPdf"[\s\S]*?>/);
  assert.ok(formInput);
  assert.match(formInput[0], /\bmultiple\b/);
  assert.match(formInput[0], /accept="application\/pdf"/);

  assert.match(script, /id="pdf-\$\{maintenanceId\}"[\s\S]*?\bmultiple\b/);
  assert.match(script, /for\s*\(const file of files\)/);
  assert.match(script, /form\.append\("pdf", file\)/);
  assert.match(script, /\/api\/manutencoes\/\$\{maintenanceId\}\/anexos/);
  assert.doesNotMatch(script, /files\s*\[\s*0\s*\]/);
});

test('cards premium e breakpoints evitam overflow em 390, 768 e desktop', () => {
  for (const className of [
    'manut-card',
    'manut-grid',
    'info-box',
    'manut-desc',
    'pdf-section',
    'pdf-item',
    'btn-return',
    'btn-edit',
    'btn-delete'
  ]) {
    assert.match(
      script + css,
      new RegExp(`\\b${className.replace('-', '\\-')}\\b`),
      `Classe do card ausente: ${className}`
    );
  }

  assert.match(css, /@media\s*\(max-width:\s*390px\)/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
  assert.match(css, /@media\s*\(max-width:\s*1200px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /#dashboard\.dashboard-panel/);
  assert.match(css, /\.dashboard-metrics-grid/);
  assert.match(css, /\.dashboard-charts-grid/);
  assert.match(css, /\.dashboard-operations-grid/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /select option[\s\S]*background-color:\s*#(?:07090d|070b12|080c12)/);
});

test('HTML e CSS permanecem estruturalmente balanceados', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let braceDepth = 0;
  for (const character of withoutComments) {
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth -= 1;
    assert.ok(braceDepth >= 0, 'Há uma chave CSS de fechamento sem abertura.');
  }
  assert.equal(braceDepth, 0, 'As chaves do CSS precisam estar balanceadas.');

  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]);
  const stack = [];
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    if (voidTags.has(tag) || raw.endsWith('/>')) continue;
    if (raw.startsWith('</')) {
      assert.equal(stack.pop(), tag, `Fechamento HTML inesperado: ${raw}`);
    } else {
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, [], `Tags HTML sem fechamento: ${stack.join(', ')}`);
});
