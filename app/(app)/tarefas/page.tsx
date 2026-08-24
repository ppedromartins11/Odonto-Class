import { requireUser } from "@/lib/auth/session";
import { listTasks, listTaskAssignees } from "@/lib/operational/queries";
import { TaskPanel } from "./TaskPanel";
export default async function TasksPage(){const u=await requireUser();const [tasks,assignees]=await Promise.all([listTasks(),listTaskAssignees()]);return <div className="mx-auto max-w-6xl"><TaskPanel tasks={tasks} assignees={assignees} currentUserId={u.id} profile={u.perfil}/></div>}
