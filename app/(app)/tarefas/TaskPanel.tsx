"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Circle,
  Ellipsis,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import type {
  OperationalTask,
  TaskPriority,
  TaskStatus,
} from "@/lib/operational/types";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { createTask, removeTask, setTaskStatus, updateTask } from "./actions";

type Assignee = { id: string; nome: string; perfil: string };

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  pendente: {
    label: "Pendente",
    className: "bg-amber-50 text-amber-700 ring-amber-600/10",
  },
  em_andamento: {
    label: "Em andamento",
    className: "bg-blue-50 text-blue-700 ring-blue-600/10",
  },
  concluida: {
    label: "Concluída",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
  },
  cancelada: {
    label: "Cancelada",
    className: "bg-rose-50 text-rose-700 ring-rose-600/10",
  },
};

const PRIORITY: Record<TaskPriority, { label: string; className: string }> = {
  urgente: {
    label: "Urgente",
    className: "bg-red-100 text-red-800 ring-red-600/20",
  },
  alta: {
    label: "Alta",
    className: "bg-rose-50 text-rose-700 ring-rose-600/10",
  },
  media: {
    label: "Média",
    className: "bg-amber-50 text-amber-700 ring-amber-600/10",
  },
  baixa: {
    label: "Baixa",
    className: "bg-slate-100 text-slate-600 ring-slate-500/10",
  },
};

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none text-foreground">{value}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const current = STATUS[status];
  return (
    <span
      className={`inline-flex rounded px-2 py-1 text-[11px] font-medium leading-none ring-1 ring-inset ${current.className}`}
    >
      {current.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const current = PRIORITY[priority];
  return (
    <span
      className={`inline-flex rounded px-2 py-1 text-[11px] font-medium leading-none ring-1 ring-inset ${current.className}`}
    >
      {current.label}
    </span>
  );
}

function TaskCreationForm({
  assignees,
  currentUserId,
  onSuccess,
}: {
  assignees: Assignee[];
  currentUserId: string;
  onSuccess: () => void;
}) {
  const [state, setState] = useState(initialDomainActionState);
  const [pending, startTransition] = useTransition();

  function submitAction(formData: FormData) {
    startTransition(async () => {
      const nextState = await createTask(initialDomainActionState, formData);
      setState(nextState);
      if (nextState.success) onSuccess();
    });
  }

  return (
    <form action={submitAction} className="px-5 py-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-foreground">
            Título
          </span>
          <input
            name="title"
            required
            minLength={2}
            maxLength={200}
            placeholder="Ex.: Confirmar retorno"
            className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-foreground">
            Prazo
          </span>
          <input
            name="dueDate"
            type="date"
            className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-foreground">
            Prioridade
          </span>
          <select
            name="priority"
            defaultValue="media"
            required
            className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
            <option value="urgente">Urgente</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-foreground">
            Responsável
          </span>
          <select
            name="assigneeId"
            defaultValue={currentUserId}
            className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-2">
          <PatientPicker
            inputName="patientId"
            searchLabel="Buscar paciente para tarefa"
          />
        </div>
        <label className="sm:col-span-2 lg:col-span-5">
          <span className="mb-1 block text-xs font-medium text-foreground">
            Descrição
          </span>
          <textarea
            name="description"
            maxLength={2000}
            rows={2}
            placeholder="Informação operacional opcional"
            className="w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {pending ? "Salvando..." : "Criar tarefa"}
        </button>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

function TaskCreationDialog({
  assignees,
  currentUserId,
  open,
  onClose,
  onCreated,
}: {
  assignees: Assignee[];
  currentUserId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar criação de tarefa"
        className="fixed inset-0 z-[60] cursor-default bg-black/30"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-creation-title"
        className="fixed left-1/2 top-1/2 z-[70] w-[min(44rem,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card text-foreground shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="task-creation-title" className="text-base font-semibold">Nova tarefa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Registre uma pendência operacional e defina o responsável.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Fechar criação de tarefa"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <TaskCreationForm assignees={assignees} currentUserId={currentUserId} onSuccess={onCreated} />
      </section>
    </>,
    document.body,
  );
}

function TaskActions({
  task,
  assignees,
  canEdit,
}: {
  task: OperationalTask;
  assignees: Assignee[];
  canEdit: boolean;
}) {
  const [statusState, statusAction, changingStatus] = useActionState(
    setTaskStatus,
    initialDomainActionState,
  );
  const [editState, editAction, editing] = useActionState(
    updateTask,
    initialDomainActionState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeTask,
    initialDomainActionState,
  );
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canChangeStatus =
    task.status === "pendente" || task.status === "em_andamento";

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const gutter = 12;
      const left = Math.max(gutter, Math.min(triggerRect.right - width, window.innerWidth - width - gutter));
      const below = triggerRect.bottom + 8;
      const above = triggerRect.top - height - 8;
      const top = below + height <= window.innerHeight - gutter || above < gutter
        ? Math.min(below, window.innerHeight - height - gutter)
        : above;

      setMenuPosition((current) => current.top === top && current.left === left ? current : { top, left });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      menuRef.current?.focus();
    });
    const observer = new ResizeObserver(updatePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  if (!canChangeStatus && !canEdit) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Ações da tarefa"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`Ações para ${task.titulo}`}
          tabIndex={-1}
          style={{ top: menuPosition.top, left: menuPosition.left }}
          className="fixed z-30 w-[min(21rem,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-lg border border-border bg-card p-3 text-left shadow-xl outline-none"
        >
        {task.status === "pendente" && (
          <form action={statusAction} className="grid grid-cols-3 gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <button
              name="status"
              value="em_andamento"
              disabled={changingStatus}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              Iniciar
            </button>
            <button
              name="status"
              value="concluida"
              disabled={changingStatus}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Concluir
            </button>
            <button
              name="status"
              value="cancelada"
              disabled={changingStatus}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              Cancelar
            </button>
          </form>
        )}

        {task.status === "em_andamento" && (
          <form action={statusAction} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <button
              name="status"
              value="concluida"
              disabled={changingStatus}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Concluir
            </button>
            <button
              name="status"
              value="cancelada"
              disabled={changingStatus}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              Cancelar
            </button>
          </form>
        )}

        {canEdit && task.status === "pendente" && (
          <details className="mt-2 border-t border-border pt-2">
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-accent [&::-webkit-details-marker]:hidden">
              <Pencil className="h-3.5 w-3.5" />
              Editar tarefa
            </summary>
            <form action={editAction} className="mt-2 grid gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="appointmentId" value={task.agendamento_id ?? ""} />
              <input
                name="title"
                defaultValue={task.titulo}
                required
                minLength={2}
                maxLength={200}
                aria-label="Título da tarefa"
                className="h-9 rounded-md border border-border px-2 text-sm"
              />
              <input
                name="dueDate"
                type="date"
                defaultValue={task.prazo ?? ""}
                aria-label="Prazo"
                className="h-9 rounded-md border border-border px-2 text-sm"
              />
              <select
                name="assigneeId"
                defaultValue={task.responsavel_id}
                aria-label="Responsável"
                className="h-9 rounded-md border border-border px-2 text-sm"
              >
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.nome}
                  </option>
                ))}
              </select>
              <select
                name="priority"
                defaultValue={task.prioridade}
                aria-label="Prioridade"
                className="h-9 rounded-md border border-border px-2 text-sm"
              >
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
                <option value="urgente">Urgente</option>
              </select>
              <PatientPicker
                inputName="patientId"
                initialPatient={task.paciente_id && task.paciente_nome ? {
                  id: task.paciente_id,
                  nome: task.paciente_nome,
                  telefone_contato: null,
                } : null}
                searchLabel="Buscar paciente para tarefa"
              />
              <textarea
                name="description"
                defaultValue={task.descricao ?? ""}
                maxLength={2000}
                aria-label="Descrição"
                rows={2}
                className="rounded-md border border-border px-2 py-1.5 text-sm"
              />
              <button
                disabled={editing}
                className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {editing ? "Salvando..." : "Salvar edição"}
              </button>
              {editState.error && (
                <p role="alert" className="text-xs text-destructive">
                  {editState.error}
                </p>
              )}
            </form>
          </details>
        )}

        {canEdit && (
          <form action={removeAction} className="mt-2 border-t border-border pt-2">
            <input type="hidden" name="taskId" value={task.id} />
            <button
              disabled={removing}
              onClick={(event) => {
                if (!window.confirm("Tem certeza que deseja remover esta tarefa?")) {
                  event.preventDefault();
                }
              }}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {removing ? "Removendo..." : "Remover tarefa"}
            </button>
          </form>
        )}

        {statusState.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {statusState.error}
          </p>
        )}
        {removeState.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {removeState.error}
          </p>
        )}
        </div>,
        document.body,
      )}
    </>
  );
}

function TaskStateControl({ task }: { task: OperationalTask }) {
  const [state, action, pending] = useActionState(
    setTaskStatus,
    initialDomainActionState,
  );
  const [optimisticallyCompleted, setOptimisticallyCompleted] = useState(false);

  if (
    task.status === "concluida" ||
    (optimisticallyCompleted && !state.error)
  ) {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (task.status === "cancelada") {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />;
  }

  return (
    <form action={action} className="relative shrink-0">
      <input type="hidden" name="taskId" value={task.id} />
      <button
        name="status"
        value="concluida"
        disabled={pending}
        onClick={() => setOptimisticallyCompleted(true)}
        title="Marcar como concluída"
        aria-label={`Marcar ${task.titulo} como concluída`}
        className="rounded-full text-slate-500 transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <Circle className="mt-0.5 h-4 w-4" />
      </button>
      {state.error && (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

function TaskTitle({ task }: { task: OperationalTask }) {
  const completed = task.status === "concluida";
  const cancelled = task.status === "cancelada";

  return (
    <div className="flex min-w-0 items-start gap-3">
      <TaskStateControl task={task} />
      <div className="min-w-0">
        <p
          className={`text-sm font-medium text-foreground ${
            completed || cancelled ? "text-muted-foreground line-through" : ""
          }`}
        >
          {task.titulo}
        </p>
        {task.descricao && (
          <p
            className={`mt-0.5 line-clamp-1 text-xs text-muted-foreground ${
              completed || cancelled ? "line-through" : ""
            }`}
          >
            {task.descricao}
          </p>
        )}
      </div>
    </div>
  );
}

function canEditTask(
  task: OperationalTask,
  currentUserId: string,
  profile: string,
) {
  return (
    profile === "administrador" ||
    profile === "recepcao" ||
    task.created_by === currentUserId
  );
}

function DueDate({ task, short = false }: { task: OperationalTask; short?: boolean }) {
  if (!task.prazo) return <span className="text-muted-foreground">Sem prazo</span>;
  const overdue = (task.status === "pendente" || task.status === "em_andamento") && task.prazo < todayInClinic();

  return (
    <span className={overdue ? "font-medium text-red-600" : "text-foreground"}>
      {formatClinicDate(task.prazo, {
        day: "2-digit",
        month: short ? "short" : "2-digit",
        ...(short ? {} : { year: "numeric" as const }),
      })}
    </span>
  );
}

function PatientLink({ task }: { task: OperationalTask }) {
  if (!task.paciente_id || !task.paciente_nome) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <Link
      href={`/pacientes/${task.paciente_id}`}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <UserRound className="h-3.5 w-3.5" />
      {task.paciente_nome}
    </Link>
  );
}

function DesktopTaskRow({
  task,
  assignees,
  currentUserId,
  profile,
}: {
  task: OperationalTask;
  assignees: Assignee[];
  currentUserId: string;
  profile: string;
}) {
  const inactive = task.status !== "pendente";

  return (
    <tr
      className={`border-b border-border last:border-b-0 ${
        inactive ? "bg-slate-50/55" : "bg-card hover:bg-slate-50/70"
      }`}
    >
      <td className="px-4 py-3 align-middle">
        <TaskTitle task={task} />
      </td>
      <td className="px-4 py-3 align-middle text-sm text-muted-foreground">
        {task.responsavel_nome}
      </td>
      <td className="px-4 py-3 align-middle text-sm">
        <DueDate task={task} />
      </td>
      <td className="px-4 py-3 align-middle text-sm">
        <PatientLink task={task} />
      </td>
      <td className="px-4 py-3 align-middle text-sm text-muted-foreground">
        <PriorityBadge priority={task.prioridade} />
      </td>
      <td className="px-4 py-3 align-middle">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-4 py-3 text-right align-middle">
        <TaskActions
          task={task}
          assignees={assignees}
          canEdit={canEditTask(task, currentUserId, profile)}
        />
      </td>
    </tr>
  );
}

function MobileTaskCard({
  task,
  assignees,
  currentUserId,
  profile,
}: {
  task: OperationalTask;
  assignees: Assignee[];
  currentUserId: string;
  profile: string;
}) {
  const canEdit = canEditTask(task, currentUserId, profile);

  return (
    <article className="border-b border-border p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <TaskTitle task={task} />
        <StatusBadge status={task.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Responsável</dt>
          <dd className="mt-1 text-foreground">{task.responsavel_nome}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prazo</dt>
          <dd className="mt-1">
            <DueDate task={task} short />
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Paciente</dt>
          <dd className="mt-1">
            <PatientLink task={task} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prioridade</dt>
          <dd className="mt-1">
            <PriorityBadge priority={task.prioridade} />
          </dd>
        </div>
      </dl>
      {(task.status === "pendente" || canEdit) && (
        <div className="mt-3 flex justify-end border-t border-border pt-2">
          <TaskActions task={task} assignees={assignees} canEdit={canEdit} />
        </div>
      )}
    </article>
  );
}

export function TaskPanel({
  tasks,
  total,
  page,
  pageSize,
  filter,
  summary,
  assignees,
  currentUserId,
  profile,
}: {
  tasks: OperationalTask[];
  total: number;
  page: number;
  pageSize: number;
  filter: "todas" | "pendente" | "em_andamento" | "concluida" | "atrasadas" | "minhas";
  summary: { pending: number; inProgress: number; completed: number; overdue: number };
  assignees: Assignee[];
  currentUserId: string;
  profile: string;
}) {
  const [creationOpen, setCreationOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pending = summary.pending;
  const inProgress = summary.inProgress;
  const completed = summary.completed;

  function taskHref(nextFilter: typeof filter, nextPage = 1) {
    const params = new URLSearchParams();
    if (nextFilter !== "todas") params.set("filtro", nextFilter);
    if (nextPage > 1) params.set("page", String(nextPage));
    const search = params.toString();
    return search ? `/tarefas?${search}` : "/tarefas";
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">
            Tarefas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending} {pending === 1 ? "tarefa pendente" : "tarefas pendentes"}
          </p>
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={creationOpen}
          onClick={() => { setNotice(null); setCreationOpen(true); }}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <Plus className="h-4 w-4" />
            Nova tarefa
        </button>
      </header>
      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo de tarefas">
        <SummaryCard label="Pendentes" value={pending} />
        <SummaryCard label="Em andamento" value={inProgress} />
        <SummaryCard label="Concluídas" value={completed} />
      </section>
      <TaskCreationDialog
        assignees={assignees}
        currentUserId={currentUserId}
        open={creationOpen}
        onClose={() => setCreationOpen(false)}
        onCreated={() => {
          setCreationOpen(false);
          setNotice("Tarefa criada com sucesso.");
        }}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filtrar tarefas por status">
        {([
          ["todas", "Todas"],
          ["pendente", "Pendentes"],
          ["em_andamento", "Em andamento"],
          ["concluida", "Concluídas"],
          ["atrasadas", "Atrasadas"],
          ["minhas", "Minhas"],
        ] as const).map(([value, label]) => (
          <Link
            key={value}
            aria-current={filter === value ? "page" : undefined}
            href={taskHref(value)}
            className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
              filter === value
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {tasks.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <XCircle className="mx-auto h-7 w-7 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Nenhuma tarefa neste filtro
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use “Nova tarefa” para registrar uma pendência operacional.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[52rem] table-fixed border-collapse">
                <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="w-[27%] px-4 py-3 pl-12">Tarefa</th>
                    <th className="w-[15%] px-4 py-3">Responsável</th>
                    <th className="w-[12%] px-4 py-3">Prazo</th>
                    <th className="w-[16%] px-4 py-3">Paciente</th>
                    <th className="w-[11%] px-4 py-3">Prioridade</th>
                    <th className="w-[11%] px-4 py-3">Status</th>
                    <th className="w-[8%] px-4 py-3 text-right">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <DesktopTaskRow
                      key={task.id}
                      task={task}
                      assignees={assignees}
                      currentUserId={currentUserId}
                      profile={profile}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {tasks.map((task) => (
                <MobileTaskCard
                  key={task.id}
                  task={task}
                  assignees={assignees}
                  currentUserId={currentUserId}
                  profile={profile}
                />
              ))}
            </div>
          </>
        )}
        {total > pageSize && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-3 text-sm" aria-label="Paginação de tarefas">
            <span className="text-muted-foreground">Página {safePage} de {totalPages} · {total} tarefas</span>
            <div className="flex gap-2">
              {safePage > 1 && <Link href={taskHref(filter, safePage - 1)} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-secondary">Anterior</Link>}
              {safePage < totalPages && <Link href={taskHref(filter, safePage + 1)} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-secondary">Próxima</Link>}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
