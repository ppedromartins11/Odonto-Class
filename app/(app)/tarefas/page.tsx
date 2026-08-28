import { todayInClinic } from "@/lib/agenda/dates";
import { requireUser } from "@/lib/auth/session";
import { getTaskSummary, listTaskAssignees, listTasksPage } from "@/lib/operational/queries";
import { redirect } from "next/navigation";
import { TaskPanel } from "./TaskPanel";

type SearchParams = Promise<{ filtro?: string | string[]; page?: string | string[] }>;
export type TaskFilter = "todas" | "pendente" | "em_andamento" | "concluida" | "atrasadas" | "minhas";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isFilter(value: string | undefined): value is TaskFilter {
  return value === "todas" || value === "pendente" || value === "em_andamento" || value === "concluida" || value === "atrasadas" || value === "minhas";
}

function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function tasksHref(filter: TaskFilter, page = 1) {
  const params = new URLSearchParams();
  if (filter !== "todas") params.set("filtro", filter);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/tarefas?${search}` : "/tarefas";
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const candidateFilter = first(params.filtro);
  const filter = isFilter(candidateFilter) ? candidateFilter : "todas";
  const requestedPage = pageNumber(first(params.page));
  const today = todayInClinic();
  const [result, summary, assignees] = await Promise.all([
    listTasksPage({
      status: filter === "pendente" || filter === "em_andamento" || filter === "concluida" ? filter : undefined,
      overdue: filter === "atrasadas",
      assigneeId: filter === "minhas" ? user.id : undefined,
      page: requestedPage,
      today,
    }),
    getTaskSummary(today),
    listTaskAssignees(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (requestedPage > totalPages) redirect(tasksHref(filter, totalPages));

  return (
    <div className="mx-auto max-w-7xl">
      <TaskPanel
        tasks={result.tasks}
        total={result.total}
        page={requestedPage}
        pageSize={result.pageSize}
        filter={filter}
        summary={summary}
        assignees={assignees}
        currentUserId={user.id}
        profile={user.perfil}
      />
    </div>
  );
}
