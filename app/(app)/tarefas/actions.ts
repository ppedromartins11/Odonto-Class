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
  const initialStatus = String(form.get("initialStatus") ?? "pendente") as TaskStatus;
  if (initialStatus !== "pendente" && initialStatus !== "em_andamento" && initialStatus !== "aguardando" && initialStatus !== "concluida") {
    return result("Status inicial inválido.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase.rpc("create_task", {
    p_titulo: String(form.get("title") ?? ""),
    p_descricao: String(form.get("description") ?? "") || null,
    p_prazo: String(form.get("dueDate") ?? "") || null,
    p_responsavel_id: String(form.get("assigneeId") ?? ""),
    p_prioridade: priority,
    p_paciente_id: String(form.get("patientId") ?? "") || null,
    p_agendamento_id: null,
  });

  if (error) return result("Não foi possível criar a tarefa.");
  if (initialStatus !== "pendente") {
    const { error: moveError } = await supabase.rpc("move_task_kanban", {
      p_tarefa_id: (created as { id?: string } | null)?.id ?? "",
      p_status: initialStatus,
      p_before_id: null,
      p_after_id: null,
    });
    if (moveError) {
      revalidatePath("/tarefas");
      revalidatePath("/dashboard");
      return result("A tarefa foi criada, mas não pôde ser movida para a coluna selecionada.");
    }
  }
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
    status !== "aguardando" &&
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

/**
 * Mutation enxuta do Kanban: o cliente informa somente a tarefa, a coluna de
 * destino e seus vizinhos. A RPC calcula a posicao, valida a transicao e aplica
 * RBAC/RLS no banco antes de registrar auditoria.
 */
export async function moveTaskKanban({
  taskId,
  status,
  beforeId,
  afterId,
}: {
  taskId: string;
  status: Extract<TaskStatus, "pendente" | "em_andamento" | "aguardando" | "concluida">;
  beforeId?: string | null;
  afterId?: string | null;
}): Promise<DomainActionState> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("move_task_kanban", {
    p_tarefa_id: taskId,
    p_status: status,
    p_before_id: beforeId ?? null,
    p_after_id: afterId ?? null,
  });

  if (error) return result("Não foi possível mover a tarefa. Tente novamente.");
  // Mantem o Dashboard consistente sem forcar uma nova arvore RSC em cada drop.
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
