(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RotinaDashboardModel = factory();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function dashboardModelFactory() {
    "use strict";

    const DAY_MS = 24 * 60 * 60 * 1000;
    const STATUS_AGUARDANDO_RETORNO =
      "Aguardando retorno do equipamento";
    const PRIORIDADES = Object.freeze(["Baixa", "Média", "Alta", "Urgente"]);
    const STATUS_MANUTENCAO = Object.freeze([
      "Enviado",
      "Aguardando coleta",
      "Aguardando orçamento",
      "Em análise",
      "Consertado",
      STATUS_AGUARDANDO_RETORNO,
      "Aguardando Pedido",
    ]);
    const STATUS_IP = Object.freeze(["Online", "Offline", "Não verificado"]);
    const LIMITES = Object.freeze({
      proximasPendencias: 5,
      manutencoesMaisAntigas: 5,
      ipsOffline: 5,
      atividadesRecentes: 6,
    });

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function asText(value) {
      return value == null ? "" : String(value);
    }

    function asId(value) {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function twoDigits(value) {
      return String(value).padStart(2, "0");
    }

    function localDateKey(date) {
      return [
        date.getFullYear(),
        twoDigits(date.getMonth() + 1),
        twoDigits(date.getDate()),
      ].join("-");
    }

    function resolveNow(value) {
      const source = value === undefined ? new Date() : value;
      const date =
        source instanceof Date
          ? new Date(source.getTime())
          : new Date(source);

      if (Number.isNaN(date.getTime())) {
        throw new TypeError("options.now precisa representar uma data válida.");
      }

      const explicitDate =
        typeof source === "string"
          ? source.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/)
          : null;

      return {
        date,
        dateKey: explicitDate ? explicitDate[1] : localDateKey(date),
      };
    }

    function validDateKey(value) {
      const text = asText(value).trim().slice(0, 10);
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";

      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));

      if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
      ) {
        return "";
      }

      return text;
    }

    function timestampMs(value) {
      if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isNaN(milliseconds) ? null : milliseconds;
      }

      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      const text = asText(value).trim();
      if (!text) return null;

      let normalized = text.replace(" ", "T");
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        normalized += "T00:00:00Z";
      } else if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(
          normalized,
        )
      ) {
        normalized += "Z";
      }

      const milliseconds = new Date(normalized).getTime();
      return Number.isNaN(milliseconds) ? null : milliseconds;
    }

    function dateKeyToUtcMs(value) {
      const dateKey = validDateKey(value);
      if (!dateKey) return null;
      const [year, month, day] = dateKey.split("-").map(Number);
      return Date.UTC(year, month - 1, day);
    }

    function compareIds(left, right) {
      const leftId = asId(left.id);
      const rightId = asId(right.id);
      if (leftId == null && rightId == null) return 0;
      if (leftId == null) return 1;
      if (rightId == null) return -1;
      return leftId - rightId;
    }

    function pendingSort(left, right) {
      const leftDate = validDateKey(left.data);
      const rightDate = validDateKey(right.data);
      if (leftDate && rightDate && leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
      if (leftDate && !rightDate) return -1;
      if (!leftDate && rightDate) return 1;

      const leftTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(asText(left.hora))
        ? asText(left.hora)
        : "99:99";
      const rightTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(asText(right.hora))
        ? asText(right.hora)
        : "99:99";
      if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
      return compareIds(left, right);
    }

    function maintenanceSort(left, right) {
      const leftDate = validDateKey(left.dataEnvio);
      const rightDate = validDateKey(right.dataEnvio);
      if (leftDate && rightDate && leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
      if (leftDate && !rightDate) return -1;
      if (!leftDate && rightDate) return 1;
      return compareIds(left, right);
    }

    function clonePending(item) {
      return {
        id: asId(item.id),
        descricao: asText(item.descricao),
        setor: asText(item.setor),
        data: asText(item.data),
        hora: asText(item.hora),
        prioridade: asText(item.prioridade),
        status: asText(item.status),
      };
    }

    function elapsedCalendarDays(startDate, todayDate) {
      const start = dateKeyToUtcMs(startDate);
      const end = dateKeyToUtcMs(todayDate);
      if (start == null || end == null) return 0;
      return Math.max(0, Math.floor((end - start) / DAY_MS));
    }

    function cloneMaintenance(item, todayDate) {
      return {
        id: asId(item.id),
        tipo: asText(item.tipo),
        patrimonio: asText(item.patrimonio),
        modelo: asText(item.modelo),
        dataEnvio: asText(item.dataEnvio),
        status: asText(item.status),
        diasEmManutencao: elapsedCalendarDays(item.dataEnvio, todayDate),
      };
    }

    function cloneIp(item) {
      return {
        id: asId(item.id),
        ip: asText(item.ip),
        nome: asText(item.nome),
        categoria: asText(item.categoria) || "Outro",
        setor: asText(item.setor),
        status: asText(item.status) || "Não verificado",
        verificadoEm: asText(item.verificadoEm),
      };
    }

    function fixedDistribution(categories, items, categoryOf) {
      const totals = new Map(categories.map((category) => [category, 0]));
      for (const item of items) {
        const category = categoryOf(item);
        if (totals.has(category)) {
          totals.set(category, totals.get(category) + 1);
        }
      }
      return categories.map((categoria) => ({
        categoria,
        total: totals.get(categoria),
      }));
    }

    function normalizedIpStatus(item) {
      const status = asText(item.status);
      return STATUS_IP.includes(status) ? status : "Não verificado";
    }

    function maintenanceIdentity(item, fallback) {
      const id = asId(item.id);
      return id == null ? `sem-id:${fallback}` : `id:${id}`;
    }

    function mergedMaintenanceItems(activeItems, returnedItems) {
      const merged = new Map();
      let fallback = 0;

      for (const item of [...activeItems, ...returnedItems]) {
        if (!item || typeof item !== "object") continue;
        const key = maintenanceIdentity(item, fallback++);
        merged.set(key, { ...(merged.get(key) || {}), ...item });
      }

      return [...merged.values()];
    }

    function activityEquipment(item) {
      return {
        id: asId(item.id),
        tipo: asText(item.tipo),
        patrimonio: asText(item.patrimonio),
        modelo: asText(item.modelo),
        status: asText(item.status),
      };
    }

    function maintenanceActivities(activeItems, returnedItems) {
      const activities = [];
      let sequence = 0;

      function addActivity(item, tipo, data, usuario) {
        const milliseconds = timestampMs(data);
        if (milliseconds == null) return;
        activities.push({
          tipo,
          acao:
            tipo === "criacao"
              ? "Manutenção cadastrada"
              : tipo === "edicao"
                ? "Manutenção editada"
                : "Equipamento retornado",
          data: asText(data),
          usuario: asText(usuario),
          equipamento: activityEquipment(item),
          _milliseconds: milliseconds,
          _sequence: sequence++,
        });
      }

      for (const item of mergedMaintenanceItems(activeItems, returnedItems)) {
        addActivity(item, "criacao", item.criadoEm, item.criadoPor);

        const returnDate =
          item.retornadoEm ||
          (item.status === "Retornou" ? item.atualizadoEm : "");
        const updateMilliseconds = timestampMs(item.atualizadoEm);
        const returnMilliseconds = timestampMs(returnDate);

        if (
          updateMilliseconds != null &&
          updateMilliseconds !== returnMilliseconds
        ) {
          addActivity(item, "edicao", item.atualizadoEm, item.atualizadoPor);
        }

        if (returnMilliseconds != null) {
          addActivity(
            item,
            "retorno",
            returnDate,
            item.retornadoPor || item.atualizadoPor,
          );
        }
      }

      return activities
        .sort(
          (left, right) =>
            right._milliseconds - left._milliseconds ||
            left._sequence - right._sequence,
        )
        .slice(0, LIMITES.atividadesRecentes)
        .map(({ _milliseconds, _sequence, ...activity }) => activity);
    }

    function buildDashboardModel(input = {}, options = {}) {
      const { date: now, dateKey: today } = resolveNow(options.now);
      const currentUser =
        input.currentUser && typeof input.currentUser === "object"
          ? input.currentUser
          : {};
      const pendingItems = asArray(input.pendencias).filter(
        (item) => item && item.status !== "Concluída",
      );
      const completedItems = asArray(input.historicoTarefas).filter(Boolean);
      const activeMaintenance = asArray(input.manutencoes).filter(
        (item) => item && item.status !== "Retornou",
      );
      const returnedMaintenance = asArray(
        input.historicoManutencoes,
      ).filter(Boolean);
      const monitoredIps = asArray(input.ipsMonitorados).filter(Boolean);

      const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
      const completedLastSevenDays = completedItems.filter((item) => {
        const completedAt = timestampMs(
          item.concluidoEm || item.atualizadoEm || item.criadoEm,
        );
        return (
          completedAt != null &&
          completedAt >= sevenDaysAgo &&
          completedAt <= now.getTime()
        );
      });

      const overdueItems = pendingItems.filter((item) => {
        const date = validDateKey(item.data);
        return Boolean(date && date < today);
      });
      const todayItems = pendingItems.filter(
        (item) => validDateKey(item.data) === today,
      );
      const waitingForReturn = activeMaintenance.filter(
        (item) => item.status === STATUS_AGUARDANDO_RETORNO,
      );
      const offlineIps = monitoredIps.filter(
        (item) => item.status === "Offline",
      );

      return {
        currentUser: {
          id: asId(currentUser.id),
          nome: asText(currentUser.nome),
          perfil: asText(currentUser.perfil),
        },
        contagens: {
          pendenciasAbertas: pendingItems.length,
          pendenciasAtrasadas: overdueItems.length,
          pendenciasHoje: todayItems.length,
          pendenciasConcluidasUltimos7Dias: completedLastSevenDays.length,
          manutencoesAtivas: activeMaintenance.length,
          manutencoesAguardandoRetorno: waitingForReturn.length,
          ipsMonitorados: monitoredIps.length,
          ipsOffline: offlineIps.length,
        },
        distribuicoes: {
          pendenciasPorPrioridade: fixedDistribution(
            PRIORIDADES,
            pendingItems,
            (item) => item.prioridade,
          ),
          manutencoesPorStatus: fixedDistribution(
            STATUS_MANUTENCAO,
            activeMaintenance,
            (item) => item.status,
          ),
          ipsPorStatus: fixedDistribution(
            STATUS_IP,
            monitoredIps,
            normalizedIpStatus,
          ),
        },
        proximasPendencias: [...pendingItems]
          .sort(pendingSort)
          .slice(0, LIMITES.proximasPendencias)
          .map(clonePending),
        manutencoesMaisAntigas: [...activeMaintenance]
          .sort(maintenanceSort)
          .slice(0, LIMITES.manutencoesMaisAntigas)
          .map((item) => cloneMaintenance(item, today)),
        ipsOffline: offlineIps
          .slice(0, LIMITES.ipsOffline)
          .map(cloneIp),
        atividadesRecentes: maintenanceActivities(
          activeMaintenance,
          returnedMaintenance,
        ),
      };
    }

    return Object.freeze({
      DAY_MS,
      PRIORIDADES,
      STATUS_MANUTENCAO,
      STATUS_IP,
      STATUS_AGUARDANDO_RETORNO,
      LIMITES,
      buildDashboardModel,
    });
  },
);
