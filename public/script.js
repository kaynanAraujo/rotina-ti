let currentUser = null;
let pendencias = [];
let manutencoes = [];
let editingPendenciaId = null;
let editingManutencaoId = null;

const $ = (id) => document.getElementById(id);
const norm = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro na requisição.');
  return data;
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function formatDate(date) {
  if (!date) return '-';
  if (String(date).includes('T')) date = String(date).slice(0, 10);
  const [y, m, d] = String(date).split('-');
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[c]));
}

function badge(text) {
  const cls = norm(text).replace(/ /g, '-');
  return `<span class="badge ${cls}">${escapeHtml(text || '-')}</span>`;
}

function empty() {
  return $('emptyTemplate').content.cloneNode(true);
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setupDate() {
  const now = new Date();
  if ($('todayWeek')) $('todayWeek').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long' });
  if ($('todayDate')) $('todayDate').textContent = now.toLocaleDateString('pt-BR');
  if ($('pendenciaData')) $('pendenciaData').valueAsDate = now;
  if ($('manutencaoData')) $('manutencaoData').valueAsDate = now;
}

function setupAuthTabs() {
  $('showLogin').addEventListener('click', () => switchAuth('login'));
  $('showRegister').addEventListener('click', () => switchAuth('register'));
}

function switchAuth(type) {
  $('showLogin').classList.toggle('active', type === 'login');
  $('showRegister').classList.toggle('active', type === 'register');
  $('loginForm').classList.toggle('active', type === 'login');
  $('registerForm').classList.toggle('active', type === 'register');
  $('authMessage').textContent = '';
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = $(tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });
}

async function checkAuth() {
  const data = await api('/api/auth/me');
  if (data.user) {
    currentUser = data.user;
    showApp();
    await loadAll();
  } else {
    showAuth();
  }
}

function showApp() {
  $('authScreen').classList.add('app-hidden');
  $('appContent').classList.remove('app-hidden');
  $('userInfo').textContent = `${currentUser.nome} • ${currentUser.perfil}`;
}

function showAuth() {
  $('authScreen').classList.remove('app-hidden');
  $('appContent').classList.add('app-hidden');
}

function setupForms() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          usuario: $('loginUsuario').value.trim(),
          senha: $('loginSenha').value
        })
      });
      currentUser = data.user;
      showToast('Login realizado com sucesso');
      showApp();
      await loadAll();
    } catch (error) {
      $('authMessage').textContent = error.message;
      $('loginSenha').value = '';
    }
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const senha = $('registerSenha').value;
    const confirmar = $('registerConfirmar').value;
    if (senha !== confirmar) {
      $('authMessage').textContent = 'As senhas não conferem.';
      return;
    }
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          nome: $('registerNome').value.trim(),
          usuario: $('registerUsuario').value.trim(),
          senha
        })
      });
      currentUser = data.user;
      showToast('Conta criada com sucesso');
      showApp();
      await loadAll();
    } catch (error) {
      $('authMessage').textContent = error.message;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
    location.reload();
  });

  $('pendenciaForm').addEventListener('submit', savePendencia);
  $('manutencaoForm').addEventListener('submit', saveManutencao);
}

async function loadAll() {
  await Promise.all([loadPendencias(), loadManutencoes(), loadStats()]);
}

async function loadPendencias() {
  pendencias = await api('/api/pendencias');
  renderPendencias();
}

async function loadManutencoes() {
  manutencoes = await api('/api/manutencoes');
  renderManutencoes();
}

async function loadStats() {
  const stats = await api('/api/stats');
  $('statPendencias').textContent = stats.pendencias;
  $('statManutencao').textContent = stats.manutencoes;
  renderResumoRotina(stats);
}

function renderResumoRotina(stats) {
  const resumo = $('resumoRotina');
  if (!resumo) return;
  resumo.innerHTML = `
    <article class="mini-card ${stats.atrasadas ? 'danger-glow' : ''}">
      <span>Atrasadas</span>
      <strong>${stats.atrasadas}</strong>
      <small>minhas tarefas vencidas</small>
    </article>
    <article class="mini-card">
      <span>Hoje</span>
      <strong>${stats.hoje}</strong>
      <small>minhas tarefas de hoje</small>
    </article>
    <article class="mini-card">
      <span>Próximas</span>
      <strong>${stats.proximas}</strong>
      <small>minhas tarefas agendadas</small>
    </article>
    <article class="mini-card next-task">
      <span>Próxima tarefa</span>
      <strong>${stats.proximaTarefa ? escapeHtml(stats.proximaTarefa.descricao) : 'Tudo em ordem'}</strong>
      <small>${stats.proximaTarefa ? `${formatDate(stats.proximaTarefa.data)} ${stats.proximaTarefa.hora ? 'às ' + escapeHtml(stats.proximaTarefa.hora) : ''}` : 'nenhuma pendência aberta'}</small>
    </article>
  `;
}

function renderPendencias() {
  const list = $('pendenciasList');
  list.innerHTML = '';
  if (!pendencias.length) return list.appendChild(empty());

  pendencias.forEach((item) => {
    const atrasada = item.data && item.data < todayISO();
    const hoje = item.data === todayISO();
    const card = document.createElement('article');
    card.className = `item-card pendencia-card ${norm(item.prioridade)} ${atrasada ? 'is-late' : ''} ${hoje ? 'is-today' : ''}`;
    card.innerHTML = `
      <div>
        <div class="item-title">
          <strong>${escapeHtml(item.descricao)}</strong>
          ${badge(item.prioridade)}
          ${badge(item.status)}
          ${atrasada ? badge('Atrasada') : ''}
          ${hoje ? badge('Hoje') : ''}
        </div>
        <div class="meta">
          <span>Setor: ${escapeHtml(item.setor || '-')}</span>
          <span>Data: ${formatDate(item.data)}</span>
          <span>Hora: ${escapeHtml(item.hora || '-')}</span>
          <span>Criado: ${formatDateTime(item.criadoEm)}</span>
        </div>
      </div>
      <div class="actions">
        <button class="success" onclick="concluirPendencia(${item.id})">Concluir</button>
        <button class="secondary" onclick="editPendencia(${item.id})">Editar</button>
        <button class="danger" onclick="deletePendencia(${item.id})">Excluir</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function renderManutencoes() {
  const list = $('manutencoesList');
  list.innerHTML = '';
  if (!manutencoes.length) return list.appendChild(empty());

  manutencoes.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'item-card maintenance-card';
    const anexosHtml = item.anexos && item.anexos.length
      ? `<div class="attachments"><strong>PDFs anexados:</strong>${item.anexos.map((a) => `
          <div class="attachment-row">
            <span>📎</span>
            <a href="${escapeHtml(a.caminho)}" target="_blank">${escapeHtml(a.nomeOriginal)}</a>
            <small>Anexado por: ${escapeHtml(a.anexadoPor || '-')} • ${formatDateTime(a.criadoEm)}</small>
          </div>`).join('')}</div>`
      : `<div class="attachments"><small>Nenhum PDF anexado.</small></div>`;

    card.innerHTML = `
      <div>
        <div class="item-title">
          <strong>${escapeHtml(item.tipo || 'Equipamento')} - ${escapeHtml(item.modelo || 'Sem modelo')}</strong>
          ${badge(item.status)}
        </div>
        <div class="meta">
          <span>Patrimônio: ${escapeHtml(item.patrimonio || '-')}</span>
          <span>Serial: ${escapeHtml(item.serial || '-')}</span>
          <span>Responsável: ${escapeHtml(item.responsavel || '-')}</span>
          <span>Destino: ${escapeHtml(item.destino || '-')}</span>
          <span>Envio: ${formatDate(item.dataEnvio)}</span>
          <span>Criado por: ${escapeHtml(item.criadoPor || '-')}</span>
          <span>Criado em: ${formatDateTime(item.criadoEm)}</span>
          ${item.atualizadoPor ? `<span>Editado por: ${escapeHtml(item.atualizadoPor)}</span>` : ''}
          ${item.retornadoPor ? `<span>Retornou por: ${escapeHtml(item.retornadoPor)}</span>` : ''}
        </div>
        ${item.obs ? `<p>${escapeHtml(item.obs)}</p>` : ''}
        ${anexosHtml}
        <div class="upload-inline">
          <input id="pdf-${item.id}" type="file" accept="application/pdf" />
          <button class="secondary" type="button" onclick="uploadPdf(${item.id})">Anexar PDF</button>
        </div>
      </div>
      <div class="actions">
        <button class="success" onclick="retornarManutencao(${item.id})">Retornou</button>
        <button class="secondary" onclick="editManutencao(${item.id})">Editar</button>
        <button class="danger" onclick="deleteManutencao(${item.id})">Excluir</button>
      </div>
    `;
    list.appendChild(card);
  });
}

async function savePendencia(e) {
  e.preventDefault();
  const payload = {
    descricao: $('pendenciaDescricao').value.trim(),
    setor: $('pendenciaSetor').value.trim(),
    data: $('pendenciaData').value,
    hora: $('pendenciaHora').value,
    prioridade: $('pendenciaPrioridade').value,
    status: $('pendenciaStatus').value
  };

  try {
    if (editingPendenciaId) {
      await api(`/api/pendencias/${editingPendenciaId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Pendência editada');
    } else {
      await api('/api/pendencias', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Pendência salva');
    }
    editingPendenciaId = null;
    $('pendenciaForm').reset();
    $('pendenciaPrioridade').value = 'Média';
    $('pendenciaStatus').value = 'Aberta';
    $('pendenciaData').valueAsDate = new Date();
    await loadAll();
  } catch (error) {
    showToast(error.message);
  }
}

function editPendencia(id) {
  const item = pendencias.find((i) => i.id === id);
  if (!item) return;
  editingPendenciaId = id;
  $('pendenciaDescricao').value = item.descricao || '';
  $('pendenciaSetor').value = item.setor || '';
  $('pendenciaData').value = item.data || '';
  $('pendenciaHora').value = item.hora || '';
  $('pendenciaPrioridade').value = item.prioridade || 'Média';
  $('pendenciaStatus').value = item.status || 'Aberta';
  window.scrollTo({ top: $('pendencias').offsetTop - 20, behavior: 'smooth' });
}

async function concluirPendencia(id) {
  await api(`/api/pendencias/${id}/concluir`, { method: 'POST', body: JSON.stringify({}) });
  showToast('Pendência concluída');
  await loadAll();
}

async function deletePendencia(id) {
  if (!confirm('Deseja excluir esta pendência?')) return;
  await api(`/api/pendencias/${id}`, { method: 'DELETE' });
  showToast('Pendência excluída');
  await loadAll();
}

async function saveManutencao(e) {
  e.preventDefault();
  const payload = {
    tipo: $('manutencaoTipo').value,
    patrimonio: $('manutencaoPatrimonio').value.trim(),
    modelo: $('manutencaoModelo').value.trim(),
    serial: $('manutencaoSerial').value.trim(),
    responsavel: $('manutencaoResponsavel').value.trim(),
    destino: $('manutencaoDestino').value.trim(),
    dataEnvio: $('manutencaoData').value,
    status: $('manutencaoStatus').value,
    obs: $('manutencaoObs').value.trim()
  };

  try {
    let manutencaoId = editingManutencaoId;

    if (editingManutencaoId) {
      await api(`/api/manutencoes/${editingManutencaoId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Manutenção editada');
    } else {
      const created = await api('/api/manutencoes', { method: 'POST', body: JSON.stringify(payload) });
      manutencaoId = created.id;
      showToast('Manutenção salva');
    }

    await uploadPdfFromForm(manutencaoId);

    editingManutencaoId = null;
    $('manutencaoForm').reset();
    $('manutencaoData').valueAsDate = new Date();
    await loadAll();
  } catch (error) {
    showToast(error.message);
  }
}

function editManutencao(id) {
  const item = manutencoes.find((i) => i.id === id);
  if (!item) return;
  editingManutencaoId = id;
  $('manutencaoTipo').value = item.tipo || 'CPU';
  $('manutencaoPatrimonio').value = item.patrimonio || '';
  $('manutencaoModelo').value = item.modelo || '';
  $('manutencaoSerial').value = item.serial || '';
  $('manutencaoResponsavel').value = item.responsavel || '';
  $('manutencaoDestino').value = item.destino || '';
  $('manutencaoData').value = item.dataEnvio || '';
  $('manutencaoStatus').value = item.status || 'Enviado';
  $('manutencaoObs').value = item.obs || '';
  window.scrollTo({ top: $('manutencao').offsetTop - 20, behavior: 'smooth' });
}

async function retornarManutencao(id) {
  await api(`/api/manutencoes/${id}/retornar`, { method: 'POST', body: JSON.stringify({}) });
  showToast('Equipamento marcado como retornado');
  await loadAll();
}

async function deleteManutencao(id) {
  if (!confirm('Deseja excluir esta manutenção?')) return;
  await api(`/api/manutencoes/${id}`, { method: 'DELETE' });
  showToast('Manutenção excluída');
  await loadAll();
}

async function uploadPdfFile(id, file) {
  if (!id || !file) return;
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Apenas PDF é permitido');
  }

  const form = new FormData();
  form.append('pdf', file);
  await api(`/api/manutencoes/${id}/anexos`, { method: 'POST', body: form });
}

async function uploadPdfFromForm(id) {
  const input = $('manutencaoPdf');
  if (!input || !input.files.length) return;

  await uploadPdfFile(id, input.files[0]);
  showToast('Manutenção salva e PDF anexado');
}

async function uploadPdf(id) {
  const input = $(`pdf-${id}`);
  if (!input || !input.files.length) {
    showToast('Selecione um PDF primeiro');
    return;
  }

  try {
    await uploadPdfFile(id, input.files[0]);
    input.value = '';
    showToast('PDF anexado');
    await loadManutencoes();
  } catch (error) {
    showToast(error.message);
  }
}

function setupMotivation() {
  const frases = [
    'Resolva uma coisa por vez. TI boa é TI organizada.',
    'Comece pelas urgências, depois vá para as melhorias.',
    'Documente hoje para não sofrer amanhã.',
    'Todo problema resolvido vira experiência.',
    'Calma, analisa, testa e resolve.',
    'Não confie só na memória. Registre tudo.',
    'Menos correria, mais controle.',
    'O suporte bom começa com organização.'
  ];
  const icones = ['⚡', '💻', '🧠', '🛠️', '🚀', '📌', '✅', '🔧'];
  const card = document.querySelector('.motivation-card');
  if (!card) return;
  card.addEventListener('click', () => {
    $('motivacaoTexto').textContent = frases[Math.floor(Math.random() * frases.length)];
    $('motivacaoIcon').textContent = icones[Math.floor(Math.random() * icones.length)];
  });
}

setupDate();
setupAuthTabs();
setupTabs();
setupForms();
setupMotivation();
checkAuth().catch((error) => showToast(error.message));
