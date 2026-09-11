import { describe, expect, it } from "vitest";
import {
  canMoveTask,
  kanbanPosition,
  moveTaskInColumns,
  type TaskKanbanColumns,
} from "../lib/operational/task-kanban";
import type { OperationalTask } from "../lib/operational/types";

function task(id: string, status: OperationalTask["status"], ordem_kanban: number): OperationalTask {
  return {
    id,
    titulo: `QA task ${id}`,
    descricao: null,
    status,
    prioridade: "media",
    prazo: null,
    responsavel_id: "responsavel",
    paciente_id: null,
    agendamento_id: null,
    created_by: "criador",
    created_at: "2026-01-01T00:00:00.000Z",
    ordem_kanban,
    responsavel_nome: "Responsável QA",
    paciente_nome: null,
  };
}

function board(): TaskKanbanColumns {
  return {
    pendente: [task("a", "pendente", 1024), task("b", "pendente", 2048)],
    em_andamento: [task("c", "em_andamento", 1024)],
    aguardando: [],
    concluida: [],
  };
}

describe("kanban de tarefas", () => {
  it("distribui e reordena tarefas sem mutar o quadro anterior", () => {
    const previous = board();
    const next = moveTaskInColumns(previous, "b", "pendente", 0);
    expect(next?.pendente.map((item) => item.id)).toEqual(["b", "a"]);
    expect(previous.pendente.map((item) => item.id)).toEqual(["a", "b"]);
    expect(kanbanPosition(next!, "pendente", "b")).toEqual({ index: 0, beforeId: null, afterId: "a" });
  });

  it("move somente nas transições operacionais permitidas", () => {
    expect(canMoveTask("pendente", "em_andamento")).toBe(true);
    expect(canMoveTask("em_andamento", "aguardando")).toBe(true);
    expect(canMoveTask("aguardando", "concluida")).toBe(true);
    expect(canMoveTask("concluida", "em_andamento")).toBe(false);
    expect(moveTaskInColumns(board(), "c", "pendente", 0)).toBeNull();
  });

  it("mantém o estado anterior disponível para rollback otimista", () => {
    const previous = board();
    const optimistic = moveTaskInColumns(previous, "a", "em_andamento", 1);
    expect(optimistic?.em_andamento.map((item) => item.id)).toEqual(["c", "a"]);
    expect(previous.pendente.map((item) => item.id)).toEqual(["a", "b"]);
    expect(previous.em_andamento.map((item) => item.id)).toEqual(["c"]);
  });
});
