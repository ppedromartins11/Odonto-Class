"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import type {
  DomainActionState,
  TaskPriority,
  TaskStatus,
} from "@/lib/operational/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const result = (error: string | null): DomainActionState => ({
  success: !error,
  error,
});

function readPriority(form: FormData): TaskPriority | null {
  const priority = String(form.get("priority") ?? "");
  return priority === "alta" || priority === "media" || priority === "baixa" || priority === "urgente"
    ? priority
    : null;
}

export async function createTask(
  _: DomainActionState,
  form: FormData,
): Promise<DomainActionState> {
  await requireUser();
  const priority = readPriority(form);
  if (!priority) return result("Selecione uma prioridade válida.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_task", {
    p_titulo: String(form.get("title") ?? ""),
    p_descricao: String(form.get("description") ?? "") || null,
    p_prazo: String(form.get("dueDate") ?? "") || null,
    p_responsavel_id: String(form.get("assigneeId") ?? ""),
    p_prioridade: priority,
    p_paciente_id: String(form.get("patientId") ?? "") || null,
    p_agendamento_id: null,
  });

  if (error) return result("Não foi possível criar a tarefa.");
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return result(null);
}

export async function setTaskStatus(
  _: DomainActionState,
  form: FormData,
): Promise<DomainActionState> {
  await requireUser();
  const status = String(form.get("status") ?? "") as TaskStatus;
  if (
    status !== "em_andamento" &&
    status !== "concluida" &&
    status !== "cancelada"
  ) {
    return result("Status inválido.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_task_status", {
    p_tarefa_id: String(form.get("taskId") ?? ""),
    p_status: status,
  });

  if (error) return result("Não foi possível atualizar a tarefa.");
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return result(null);
}

export async function updateTask(
  _: DomainActionState,
  form: FormData,
): Promise<DomainActionState> {
  await requireUser();
  const priority = readPriority(form);
  if (!priority) return result("Selecione uma prioridade válida.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_task", {
    p_tarefa_id: String(form.get("taskId") ?? ""),
    p_titulo: String(form.get("title") ?? ""),
    p_descricao: String(form.get("description") ?? "") || null,
    p_prazo: String(form.get("dueDate") ?? "") || null,
    p_responsavel_id: String(form.get("assigneeId") ?? ""),
    p_prioridade: priority,
    p_paciente_id: String(form.get("patientId") ?? "") || null,
    p_agendamento_id: String(form.get("appointmentId") ?? "") || null,
  });

  if (error) return result("Não foi possível editar a tarefa.");
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return result(null);
}

export async function removeTask(
  _: DomainActionState,
  form: FormData,
): Promise<DomainActionState> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("soft_delete_task", {
    p_tarefa_id: String(form.get("taskId") ?? ""),
  });

  if (error) return result("Não foi possível remover a tarefa.");
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return result(null);
}
