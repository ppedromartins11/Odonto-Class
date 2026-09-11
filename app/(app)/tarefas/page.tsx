import { todayInClinic } from "@/lib/agenda/dates";
import { requireUser } from "@/lib/auth/session";
import {
  getTaskFilterPatient,
  getTaskSummary,
  listTaskAssignees,
  listTasksKanban,
  type TaskKanbanFilters,
} from "@/lib/operational/queries";
import type { TaskPriority } from "@/lib/operational/types";
import { TaskPanel } from "./TaskPanel";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function optionalId(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : undefined;
}

function priority(value: string | undefined): TaskPriority | undefined {
  return value === "alta" || value === "media" || value === "baixa" || value === "urgente" ? value : undefined;
}

function due(value: string | undefined): TaskKanbanFilters["due"] {
  return value === "atrasadas" || value === "hoje" || value === "sem_prazo" ? value : undefined;
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInClinic();
  const filters: TaskKanbanFilters = {
    query: first(params.q)?.slice(0, 100),
    assigneeId: optionalId(first(params.responsavel)),
    priority: priority(first(params.prioridade)),
    due: due(first(params.prazo)),
    patientId: optionalId(first(params.paciente)),
    mine: first(params.minhas) === "1",
    includeCancelled: first(params.canceladas) === "1",
    currentUserId: user.id,
    today,
  };

  const [kanban, summary, assignees, selectedPatient] = await Promise.all([
    listTasksKanban(filters),
    getTaskSummary(today),
    listTaskAssignees(),
    getTaskFilterPatient(filters.patientId),
  ]);

  return (
    <div className="mx-auto max-w-[100rem]">
      <TaskPanel
        key={Object.values(kanban.columns).flat().map((task) => `${task.id}:${task.status}:${task.ordem_kanban}`).join("|")}
        columns={kanban.columns}
        counts={kanban.counts}
        summary={summary}
        assignees={assignees}
        currentUserId={user.id}
        profile={user.perfil}
        filters={filters}
        selectedPatient={selectedPatient}
      />
    </div>
  );
}
