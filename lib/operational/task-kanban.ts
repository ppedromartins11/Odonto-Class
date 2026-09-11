import type { OperationalTask, TaskStatus } from "./types";

export const KANBAN_STATUSES = ["pendente", "em_andamento", "aguardando", "concluida"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];
export type TaskKanbanColumns = Record<KanbanStatus, OperationalTask[]>;

export const KANBAN_STATUS_META: Record<KanbanStatus, { label: string; description: string }> = {
  pendente: { label: "A fazer", description: "Tarefas ainda não iniciadas" },
  em_andamento: { label: "Em andamento", description: "Tarefas em execução" },
  aguardando: { label: "Aguardando", description: "Tarefas que dependem de retorno ou condição externa" },
  concluida: { label: "Concluídas", description: "Últimas 50 tarefas concluídas" },
};

export function isKanbanStatus(value: TaskStatus): value is KanbanStatus {
  return KANBAN_STATUSES.includes(value as KanbanStatus);
}

/** Espelha as transições aprovadas pela RPC; o banco continua sendo a autoridade. */
export function canMoveTask(from: KanbanStatus, to: KanbanStatus) {
  if (from === to) return true;
  if (from === "pendente") return to === "em_andamento" || to === "aguardando" || to === "concluida";
  if (from === "em_andamento") return to === "aguardando" || to === "concluida";
  if (from === "aguardando") return to === "em_andamento" || to === "concluida";
  return false;
}

export function moveTaskInColumns(
  columns: TaskKanbanColumns,
  taskId: string,
  destination: KanbanStatus,
  index: number,
): TaskKanbanColumns | null {
  const origin = KANBAN_STATUSES.find((status) => columns[status].some((task) => task.id === taskId));
  if (!origin || !canMoveTask(origin, destination)) return null;
  const task = columns[origin].find((candidate) => candidate.id === taskId);
  if (!task) return null;

  const next: TaskKanbanColumns = {
    pendente: [...columns.pendente],
    em_andamento: [...columns.em_andamento],
    aguardando: [...columns.aguardando],
    concluida: [...columns.concluida],
  };
  next[origin] = next[origin].filter((candidate) => candidate.id !== taskId);
  const target = next[destination];
  const boundedIndex = Math.max(0, Math.min(index, target.length));
  target.splice(boundedIndex, 0, { ...task, status: destination });
  return next;
}

export function kanbanPosition(columns: TaskKanbanColumns, status: KanbanStatus, taskId: string) {
  const index = columns[status].findIndex((task) => task.id === taskId);
  return {
    index,
    beforeId: index > 0 ? columns[status][index - 1]?.id ?? null : null,
    afterId: index >= 0 ? columns[status][index + 1]?.id ?? null : null,
  };
}
