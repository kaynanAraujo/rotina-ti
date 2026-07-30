const test = require("node:test");
const assert = require("node:assert/strict");
const DashboardModel = require("../public/dashboard-model");

const NOW = "2026-07-28T15:00:00Z";
const PENDING_MARKER = "SEGREDO-EXCLUSIVO-DE-PENDENCIA";

function totals(distribution) {
  return Object.fromEntries(
    distribution.map((item) => [item.categoria, item.total]),
  );
}

function normalFixture() {
  return {
    currentUser: {
      id: 17,
      nome: "Técnica Teste",
      perfil: "tecnico",
      usuario: "nao-precisa-sair-no-modelo",
    },
    pendencias: [
      {
        id: 10,
        descricao: PENDING_MARKER,
        setor: "TI",
        data: "2026-07-27",
        hora: "10:00",
        prioridade: "Urgente",
        status: "Aberta",
      },
      {
        id: 11,
        descricao: "Tarefa de hoje mais cedo",
        setor: "Infraestrutura",
        data: "2026-07-28",
        hora: "08:30",
        prioridade: "Alta",
        status: "Em andamento",
      },
      {
        id: 12,
        descricao: "Tarefa de hoje mais tarde",
        setor: "Suporte",
        data: "2026-07-28",
        hora: "16:00",
        prioridade: "Média",
        status: "Aberta",
      },
      {
        id: 13,
        descricao: "Tarefa futura baixa",
        setor: "TI",
        data: "2026-07-29",
        hora: "09:00",
        prioridade: "Baixa",
        status: "Aberta",
      },
      {
        id: 14,
        descricao: "Tarefa futura urgente",
        setor: "TI",
        data: "2026-07-30",
        hora: "11:00",
        prioridade: "Urgente",
        status: "Aberta",
      },
      {
        id: 15,
        descricao: "Tarefa sem data",
        setor: "TI",
        data: "",
        hora: "",
        prioridade: "Média",
        status: "Aberta",
      },
      {
        id: 16,
        descricao: "Concluída não pertence às abertas",
        data: "2026-07-20",
        hora: "12:00",
        prioridade: "Alta",
        status: "Concluída",
      },
    ],
    historicoTarefas: [
      {
        id: 30,
        descricao: `${PENDING_MARKER}-NO-HISTORICO`,
        status: "Concluída",
        concluidoEm: "2026-07-21T15:00:00Z",
      },
      {
        id: 31,
        descricao: "Concluída dentro da janela",
        status: "Concluída",
        concluidoEm: "2026-07-22 10:00:00",
      },
      {
        id: 32,
        descricao: "Concluída um segundo antes da janela",
        status: "Concluída",
        concluidoEm: "2026-07-21T14:59:59Z",
      },
      {
        id: 33,
        descricao: "Data futura não deve contar",
        status: "Concluída",
        concluidoEm: "2026-07-29T10:00:00Z",
      },
    ],
    manutencoes: [
      {
        id: 1,
        tipo: "Notebook",
        patrimonio: "PAT-001",
        modelo: "Modelo 1",
        dataEnvio: "2026-07-25",
        status: "Enviado",
        criadoPor: "Ana",
        criadoEm: "2026-07-25 10:00:00",
      },
      {
        id: 2,
        tipo: "Monitor",
        patrimonio: "PAT-002",
        modelo: "Modelo 2",
        dataEnvio: "2026-07-10",
        status: "Aguardando retorno do equipamento",
        criadoPor: "Bia",
        criadoEm: "2026-07-10 10:00:00",
        atualizadoPor: "Caio",
        atualizadoEm: "2026-07-27 11:00:00",
      },
      {
        id: 3,
        tipo: "CPU",
        patrimonio: "PAT-003",
        modelo: "Modelo 3",
        dataEnvio: "2026-07-20",
        status: "Em análise",
        criadoPor: "Dani",
        criadoEm: "2026-07-20 10:00:00",
      },
      {
        id: 4,
        tipo: "Impressora",
        patrimonio: "PAT-004",
        modelo: "Modelo 4",
        dataEnvio: "2026-07-01",
        status: "Consertado",
        criadoPor: "Eva",
        criadoEm: "2026-07-01 10:00:00",
      },
      {
        id: 5,
        tipo: "Servidor",
        patrimonio: "PAT-005",
        modelo: "Modelo 5",
        dataEnvio: "2026-06-01",
        status: "Aguardando coleta",
        criadoPor: "Fábio",
        criadoEm: "2026-06-01 10:00:00",
      },
      {
        id: 6,
        tipo: "Switch",
        patrimonio: "PAT-006",
        modelo: "Modelo 6",
        dataEnvio: "2026-07-26",
        status: "Aguardando retorno do equipamento",
        criadoPor: "Gabi",
        criadoEm: "2026-07-26 10:00:00",
      },
      {
        id: 7,
        tipo: "Outro",
        patrimonio: "PAT-007",
        modelo: "Modelo 7",
        dataEnvio: "",
        status: "Aguardando Pedido",
        criadoPor: "Hugo",
        criadoEm: "2026-07-28 09:00:00",
      },
      {
        id: 8,
        tipo: "Tablet",
        patrimonio: "PAT-008",
        modelo: "Não deve ser ativo",
        dataEnvio: "2026-07-02",
        status: "Retornou",
        retornadoEm: "2026-07-28 08:00:00",
      },
    ],
    historicoManutencoes: [
      {
        id: 20,
        tipo: "Notebook",
        patrimonio: "PAT-020",
        modelo: "Equipamento retornado",
        dataEnvio: "2026-07-05",
        status: "Retornou",
        criadoPor: "Iara",
        criadoEm: "2026-07-05 09:00:00",
        atualizadoPor: "João",
        atualizadoEm: "2026-07-28 12:00:00",
        retornadoPor: "João",
        retornadoEm: "2026-07-28 12:00:00",
      },
    ],
    ipsMonitorados: [
      {
        id: 1,
        ip: "192.0.2.1",
        nome: "Offline 1",
        categoria: "Servidor",
        setor: "TI",
        status: "Offline",
        verificadoEm: "2026-07-28 10:00:00",
      },
      {
        id: 2,
        ip: "192.0.2.2",
        nome: "Offline 2",
        categoria: "Switch",
        setor: "TI",
        status: "Offline",
      },
      {
        id: 3,
        ip: "192.0.2.3",
        nome: "Offline 3",
        status: "Offline",
      },
      {
        id: 4,
        ip: "192.0.2.4",
        nome: "Offline 4",
        status: "Offline",
      },
      {
        id: 5,
        ip: "192.0.2.5",
        nome: "Offline 5",
        status: "Offline",
      },
      {
        id: 6,
        ip: "192.0.2.6",
        nome: "Offline 6",
        status: "Offline",
      },
      {
        id: 7,
        ip: "192.0.2.7",
        nome: "Online",
        status: "Online",
      },
      {
        id: 8,
        ip: "192.0.2.8",
        nome: "Ainda não verificado",
        status: "",
      },
    ],
  };
}

test("calcula as oito contagens e distribuições fixas sem alterar a entrada", () => {
  const input = normalFixture();
  const original = structuredClone(input);
  const model = DashboardModel.buildDashboardModel(input, { now: NOW });

  assert.deepEqual(model.currentUser, {
    id: 17,
    nome: "Técnica Teste",
    perfil: "tecnico",
  });
  assert.deepEqual(model.contagens, {
    pendenciasAbertas: 6,
    pendenciasAtrasadas: 1,
    pendenciasHoje: 2,
    pendenciasConcluidasUltimos7Dias: 2,
    manutencoesAtivas: 7,
    manutencoesAguardandoRetorno: 2,
    ipsMonitorados: 8,
    ipsOffline: 6,
  });
  assert.deepEqual(totals(model.distribuicoes.pendenciasPorPrioridade), {
    Baixa: 1,
    Média: 2,
    Alta: 1,
    Urgente: 2,
  });
  assert.deepEqual(totals(model.distribuicoes.manutencoesPorStatus), {
    Enviado: 1,
    "Aguardando coleta": 1,
    "Aguardando orçamento": 0,
    "Em análise": 1,
    Consertado: 1,
    "Aguardando retorno do equipamento": 2,
    "Aguardando Pedido": 1,
  });
  assert.deepEqual(totals(model.distribuicoes.ipsPorStatus), {
    Online: 1,
    Offline: 6,
    "Não verificado": 1,
  });
  assert.deepEqual(input, original);
  assert.deepEqual(
    DashboardModel.buildDashboardModel(input, { now: NOW }),
    model,
  );
});

test("limita e ordena listas, calcula dias corridos e respeita a janela inclusiva de sete dias", () => {
  const model = DashboardModel.buildDashboardModel(normalFixture(), {
    now: NOW,
  });

  assert.deepEqual(
    model.proximasPendencias.map((item) => item.id),
    [10, 11, 12, 13, 14],
  );
  assert.equal(model.proximasPendencias.length, 5);

  assert.deepEqual(
    model.manutencoesMaisAntigas.map((item) => item.id),
    [5, 4, 2, 3, 1],
  );
  assert.equal(model.manutencoesMaisAntigas.length, 5);
  assert.equal(model.manutencoesMaisAntigas[0].diasEmManutencao, 57);

  assert.deepEqual(
    model.ipsOffline.map((item) => item.id),
    [1, 2, 3, 4, 5],
  );
  assert.equal(model.ipsOffline.length, 5);
  assert.equal(model.contagens.pendenciasConcluidasUltimos7Dias, 2);
});

test("deriva no máximo seis atividades somente de manutenção e nunca de pendências", () => {
  const model = DashboardModel.buildDashboardModel(normalFixture(), {
    now: NOW,
  });
  const serializedActivities = JSON.stringify(model.atividadesRecentes);

  assert.equal(model.atividadesRecentes.length, 6);
  assert.equal(model.atividadesRecentes[0].tipo, "retorno");
  assert.equal(model.atividadesRecentes[0].equipamento.id, 20);
  assert.ok(
    model.atividadesRecentes.every((item) =>
      ["criacao", "edicao", "retorno"].includes(item.tipo),
    ),
  );
  assert.doesNotMatch(serializedActivities, /SEGREDO-EXCLUSIVO-DE-PENDENCIA/);

  const activityTimes = model.atividadesRecentes.map((item) =>
    Date.parse(item.data.replace(" ", "T") + (item.data.includes("Z") ? "" : "Z")),
  );
  assert.deepEqual(activityTimes, [...activityTimes].sort((a, b) => b - a));
});

test("mantém categorias e estados vazios explícitos quando todos os valores são zero", () => {
  const model = DashboardModel.buildDashboardModel(
    { currentUser: { nome: "Sem registros" } },
    { now: NOW },
  );

  assert.deepEqual(model.contagens, {
    pendenciasAbertas: 0,
    pendenciasAtrasadas: 0,
    pendenciasHoje: 0,
    pendenciasConcluidasUltimos7Dias: 0,
    manutencoesAtivas: 0,
    manutencoesAguardandoRetorno: 0,
    ipsMonitorados: 0,
    ipsOffline: 0,
  });
  assert.deepEqual(
    model.distribuicoes.pendenciasPorPrioridade.map((item) => item.total),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    model.distribuicoes.manutencoesPorStatus.map((item) => item.total),
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    model.distribuicoes.ipsPorStatus.map((item) => item.total),
    [0, 0, 0],
  );
  assert.deepEqual(model.proximasPendencias, []);
  assert.deepEqual(model.manutencoesMaisAntigas, []);
  assert.deepEqual(model.ipsOffline, []);
  assert.deepEqual(model.atividadesRecentes, []);
});
