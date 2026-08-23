import { requireUser } from "@/lib/auth/session";
import { listTasks, listTaskAssignees } from "@/lib/operational/queries";
import { TaskPanel } from "./TaskPanel";
export default async function TasksPage(){const u=await requireUser();const [tasks,assignees]=await Promise.all([listTasks(),listTaskAssignees()]);return <div className="mx-auto max-w-4xl space-y-4"><h2 className="text-2xl font-medium">Tarefas</h2><TaskPanel tasks={tasks} assignees={assignees} currentUserId={u.id} profile={u.perfil}/></div>}
