"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  Ellipsis,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { formatClinicDate, todayInClinic } from "@/lib/agenda/dates";
import {
  KANBAN_STATUSES,
  KANBAN_STATUS_META,
  canMoveTask,
  kanbanPosition,
  moveTaskInColumns,
  type KanbanStatus,
  type TaskKanbanColumns,
} from "@/lib/operational/task-kanban";
import type { TaskKanbanFilters } from "@/lib/operational/queries";
import type { DomainActionState, OperationalTask, TaskPriority } from "@/lib/operational/types";
import { createTask, moveTaskKanban, removeTask, updateTask } from "./actions";

type Assignee = { id: string; nome: string; perfil: string };
type PatientOption = { id: string; nome: string; telefone_contato: string | null };

const PRIORITY: Record<TaskPriority, { label: string; className: string }> = {
  urgente: { label: "Urgente", className: "bg-rose-50 text-rose-700 ring-rose-600/15" },
  alta: { label: "Alta", className: "bg-amber-50 text-amber-700 ring-amber-600/15" },
  media: { label: "Normal", className: "bg-blue-50 text-blue-700 ring-blue-600/15" },
  baixa: { label: "Baixa", className: "bg-slate-100 text-slate-600 ring-slate-500/10" },
};

const COLUMN_STYLE: Record<KanbanStatus, { border: string; dot: string; background: string }> = {
  pendente: { border: "border-slate-200", dot: "bg-slate-400", background: "bg-slate-50/70" },
  em_andamento: { border: "border-blue-200", dot: "bg-blue-500", background: "bg-blue-50/50" },
  aguardando: { border: "border-amber-200", dot: "bg-amber-500", background: "bg-amber-50/50" },
  concluida: { border: "border-emerald-200", dot: "bg-emerald-500", background: "bg-emerald-50/45" },
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function isOverdue(task: OperationalTask) {
  return Boolean(task.prazo && ["pendente", "em_andamento", "aguardando"].includes(task.status) && task.prazo < todayInClinic());
}

function friendlyDate(value: string | null) {
  if (!value) return "Sem prazo";
  const today = todayInClinic();
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === today) return "Hoje";
  if (value === tomorrow.toISOString().slice(0, 10)) return "Amanhã";
  if (value === yesterday.toISOString().slice(0, 10)) return "Ontem";
  return formatClinicDate(value, { day: "2-digit", month: "short" }).replace(".", "");
}

function canEditTask(task: OperationalTask, currentUserId: string, profile: string) {
  return profile === "administrador" || profile === "recepcao" || task.created_by === currentUserId;
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const item = PRIORITY[priority];
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${item.className}`}>{item.label}</span>;
}

function Modal({ children, onClose, labelledBy }: { children: React.ReactNode; onClose: () => void; labelledBy: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <button type="button" aria-label="Fechar diálogo" className="fixed inset-0 z-[60] cursor-default bg-slate-950/30" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="fixed left-1/2 top-1/2 z-[70] w-[min(44rem,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        <button ref={closeRef} type="button" aria-label="Fechar diálogo" onClick={onClose} className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" />
        </button>
        {children}
      </section>
    </>,
    document.body,
  );
}

function TaskForm({ task, assignees, currentUserId, initialStatus = "pendente", onSuccess }: {
  task?: OperationalTask;
  assignees: Assignee[];
  currentUserId: string;
  initialStatus?: KanbanStatus;
  onSuccess: () => void;
}) {
  const [state, setState] = useState<DomainActionState>(initialDomainActionState);
  const [pending, startTransition] = useTransition();
  const editing = Boolean(task);

  function submit(formData: FormData) {
    startTransition(async () => {
      const next = editing
        ? await updateTask(initialDomainActionState, formData)
        : await createTask(initialDomainActionState, formData);
      setState(next);
      if (next.success) onSuccess();
    });
  }

  return (
    <form action={submit} className="grid gap-4 px-5 py-5 sm:px-6">
      <input type="hidden" name="taskId" value={task?.id ?? ""} />
      <input type="hidden" name="appointmentId" value={task?.agendamento_id ?? ""} />
      {!editing && <input type="hidden" name="initialStatus" value={initialStatus} />}
      <label>
        <span className="mb-1.5 block text-sm font-medium text-foreground">Título</span>
        <input name="title" required minLength={2} maxLength={200} defaultValue={task?.titulo ?? ""} placeholder="Ex.: Confirmar retorno" className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
      </label>
      <label>
        <span className="mb-1.5 block text-sm font-medium text-foreground">Descrição</span>
        <textarea name="description" defaultValue={task?.descricao ?? ""} maxLength={2000} rows={3} placeholder="Informação operacional opcional" className="w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className="mb-1.5 block text-sm font-medium text-foreground">Prazo</span>
          <input name="dueDate" type="date" defaultValue={task?.prazo ?? ""} className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
        </label>
        <label>
          <span className="mb-1.5 block text-sm font-medium text-foreground">Prioridade</span>
          <select name="priority" defaultValue={task?.prioridade ?? "media"} className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">
            <option value="urgente">Urgente</option><option value="alta">Alta</option><option value="media">Normal</option><option value="baixa">Baixa</option>
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-sm font-medium text-foreground">Responsável</span>
          <select name="assigneeId" defaultValue={task?.responsavel_id ?? currentUserId} className="h-10 w-full rounded-md border border-border bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">
            {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.nome}</option>)}
          </select>
        </label>
      </div>
      <PatientPicker inputName="patientId" initialPatient={task?.paciente_id && task.paciente_nome ? { id: task.paciente_id, nome: task.paciente_nome, telefone_contato: null } : null} searchLabel="Buscar paciente para tarefa" />
      {state.error && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <button disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
          {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar tarefa"}
        </button>
      </div>
    </form>
  );
}

function TaskDialog({ task, assignees, currentUserId, profile, onClose, onRemoved, onUpdated }: {
  task?: OperationalTask;
  assignees: Assignee[];
  currentUserId: string;
  profile: string;
  onClose: () => void;
  onRemoved: (taskId: string) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(!task);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const editable = task && task.status === "pendente" && canEditTask(task, currentUserId, profile);

  function remove() {
    if (!task || !window.confirm("Tem certeza que deseja remover esta tarefa?")) return;
    startRemove(async () => {
      const form = new FormData();
      form.set("taskId", task.id);
      const result = await removeTask(initialDomainActionState, form);
      if (!result.success) { setRemoveError(result.error); return; }
      onRemoved(task.id);
      onClose();
    });
  }

  const title = task ? (editing ? "Editar tarefa" : "Detalhes da tarefa") : "Nova tarefa";
  return (
    <Modal onClose={onClose} labelledBy="task-dialog-title">
      <header className="border-b border-border px-5 py-5 pr-14 sm:px-6">
        <h2 id="task-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{task ? "Consulte ou atualize os dados operacionais da tarefa." : "Registre uma atividade e defina um responsável."}</p>
      </header>
      {editing ? (
        <TaskForm task={task} assignees={assignees} currentUserId={currentUserId} onSuccess={() => { onUpdated(); onClose(); }} />
      ) : task && (
        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2"><PriorityBadge priority={task.prioridade} /><span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">{KANBAN_STATUS_META[task.status as KanbanStatus]?.label ?? "Cancelada"}</span></div>
          {task.descricao && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.descricao}</p>}
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Responsável</dt><dd className="mt-1 text-foreground">{task.responsavel_nome}</dd></div>
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prazo</dt><dd className="mt-1 text-foreground">{friendlyDate(task.prazo)}</dd></div>
            {task.paciente_id && task.paciente_nome && <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paciente</dt><dd className="mt-1"><Link className="text-primary hover:underline" href={`/pacientes/${task.paciente_id}`}>{task.paciente_nome}</Link></dd></div>}
          </dl>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            {editable && <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"><Pencil className="h-4 w-4" />Editar</button>}
            {canEditTask(task, currentUserId, profile) && <button type="button" disabled={removing} onClick={remove} className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/30 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />{removing ? "Removendo..." : "Remover"}</button>}
          </div>
          {removeError && <p role="alert" className="text-sm text-destructive">{removeError}</p>}
        </div>
      )}
    </Modal>
  );
}

function TaskActions({ task, onOpen, onMove }: { task: OperationalTask; onOpen: () => void; onMove: (status: KanbanStatus) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth || 188;
      const height = menu.offsetHeight || 120;
      setPosition({ top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12)), left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)) });
    };
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menuRef.current?.contains(node) && !triggerRef.current?.contains(node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);

  const options = KANBAN_STATUSES.filter((status) => task.status !== "cancelada" && canMoveTask(task.status as KanbanStatus, status));
  return <>
    <button ref={triggerRef} type="button" aria-label={`Ações para ${task.titulo}`} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Ellipsis className="h-4 w-4" /></button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={menuRef} role="menu" aria-label={`Ações para ${task.titulo}`} style={position} className="fixed z-[80] w-52 rounded-lg border border-border bg-card p-1.5 shadow-xl">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpen(); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-secondary"><Pencil className="h-4 w-4" />Abrir detalhes</button>
        {options.filter((status) => status !== task.status).map((status) => <button key={status} type="button" role="menuitem" onClick={() => { setOpen(false); onMove(status); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-secondary">Mover para {KANBAN_STATUS_META[status].label}</button>)}
      </div>, document.body,
    )}
  </>;
}

function TaskCard({ task, column, index, columnLength, selectedForMove, onOpen, onMove, onKeyboardSelect, onDragStart, onDragEnd, onDropAt }: {
  task: OperationalTask;
  column: KanbanStatus;
  index: number;
  columnLength: number;
  selectedForMove: boolean;
  onOpen: () => void;
  onMove: (status: KanbanStatus, index?: number) => void;
  onKeyboardSelect: () => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDropAt: (taskId: string, status: KanbanStatus, index: number) => void;
}) {
  const dragging = useRef(false);
  const overdue = isOverdue(task);
  const completed = task.status === "concluida";
  const keyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target) return;
    if (event.key === "Enter") { event.preventDefault(); onOpen(); return; }
    if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); onKeyboardSelect(); return; }
    if (!selectedForMove) return;
    if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); onMove(column, index - 1); }
    if (event.key === "ArrowDown" && index < columnLength - 1) { event.preventDefault(); onMove(column, index + 1); }
    const columnIndex = KANBAN_STATUSES.indexOf(column);
    if (event.key === "ArrowLeft" && columnIndex > 0) { event.preventDefault(); onMove(KANBAN_STATUSES[columnIndex - 1]); }
    if (event.key === "ArrowRight" && columnIndex < KANBAN_STATUSES.length - 1) { event.preventDefault(); onMove(KANBAN_STATUSES[columnIndex + 1]); }
  };
  return (
    <article draggable aria-grabbed={selectedForMove} tabIndex={0} onKeyDown={keyboard}
      onDragStart={(event) => { dragging.current = true; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); onDragStart(task.id); }}
      onDragEnd={() => { window.setTimeout(() => { dragging.current = false; }, 0); onDragEnd(); }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDropAt(event.dataTransfer.getData("text/plain"), column, 0); }}
      onClick={(event) => { if (event.target instanceof Element && event.target.closest("button,a")) return; if (!dragging.current) onOpen(); }}
      aria-label={`${task.titulo}. ${KANBAN_STATUS_META[column].label}. Pressione Enter para abrir ou Espaço para selecionar e mover.`}
      className={`group cursor-grab rounded-lg border bg-card p-3.5 shadow-sm transition motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing ${selectedForMove ? "ring-2 ring-primary" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5"><GripVertical aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/55" /><PriorityBadge priority={task.prioridade} /></div>
        <TaskActions task={task} onOpen={onOpen} onMove={(status) => onMove(status)} />
      </div>
      <h3 className={`mt-3 break-words text-sm font-semibold leading-5 text-foreground ${completed ? "text-muted-foreground line-through" : ""}`}>{task.titulo}</h3>
      {task.descricao && <p className={`mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground ${completed ? "line-through" : ""}`}>{task.descricao}</p>}
      {task.paciente_id && task.paciente_nome && <Link href={`/pacientes/${task.paciente_id}`} onClick={(event) => event.stopPropagation()} className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-primary hover:underline"><UserRound className="h-3.5 w-3.5 shrink-0" />Paciente · <span className="truncate">{task.paciente_nome}</span></Link>}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}><CalendarClock className="h-3.5 w-3.5 shrink-0" />{overdue ? `Atrasada · ${friendlyDate(task.prazo)}` : friendlyDate(task.prazo)}</span>
        <span title={task.responsavel_nome} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{initials(task.responsavel_nome)}</span>
      </div>
    </article>
  );
}

function TaskColumn({ status, tasks, count, movingId, selectedForMove, onCreate, onOpen, onMove, onKeyboardSelect, onDragStart, onDragEnd }: {
  status: KanbanStatus;
  tasks: OperationalTask[];
  count: number;
  movingId: string | null;
  selectedForMove: string | null;
  onCreate: (status: KanbanStatus) => void;
  onOpen: (task: OperationalTask) => void;
  onMove: (taskId: string, status: KanbanStatus, index: number) => void;
  onKeyboardSelect: (taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}) {
  const style = COLUMN_STYLE[status];
  return <section aria-labelledby={`task-column-${status}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) onMove(id, status, tasks.length); }} className={`flex min-h-[31rem] w-[19rem] shrink-0 flex-col rounded-xl border ${style.border} ${style.background} p-3.5 sm:w-[20rem]`}>
    <header className="flex items-start justify-between gap-3 px-1 pb-3">
      <div><div className="flex items-center gap-2"><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${style.dot}`} /><h2 id={`task-column-${status}`} className="text-sm font-semibold text-foreground">{KANBAN_STATUS_META[status].label}</h2><span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">{count}</span></div><p className="mt-1 text-xs text-muted-foreground">{KANBAN_STATUS_META[status].description}</p></div>
    </header>
    <div className="min-h-16 space-y-3" aria-label={`${KANBAN_STATUS_META[status].label}: ${count} tarefas`}>
      {tasks.map((task, index) => <TaskCard key={task.id} task={task} column={status} index={index} columnLength={tasks.length} selectedForMove={selectedForMove === task.id} onOpen={() => onOpen(task)} onMove={(target, targetIndex) => onMove(task.id, target, targetIndex ?? tasks.length)} onKeyboardSelect={() => onKeyboardSelect(task.id)} onDragStart={onDragStart} onDragEnd={onDragEnd} onDropAt={onMove} />)}
      {movingId && tasks.length === 0 && <div className="rounded-lg border border-dashed border-primary/40 bg-card/60 px-3 py-6 text-center text-xs text-muted-foreground">Solte aqui para mover</div>}
    </div>
    <button type="button" onClick={() => onCreate(status)} className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/70 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-primary"><Plus className="h-4 w-4" />Adicionar tarefa</button>
  </section>;
}

export function TaskPanel({ columns, counts, summary, assignees, currentUserId, profile, filters, selectedPatient }: {
  columns: TaskKanbanColumns & Partial<Record<"cancelada", OperationalTask[]>>;
  counts: Record<KanbanStatus, number> & Partial<Record<"cancelada", number>>;
  summary: { pending: number; inProgress: number; awaiting: number; completed: number; overdue: number };
  assignees: Assignee[];
  currentUserId: string;
  profile: string;
  filters: TaskKanbanFilters;
  selectedPatient: PatientOption | null;
}) {
  const router = useRouter();
  const [board, setBoard] = useState<TaskKanbanColumns>(columns);
  const [creationStatus, setCreationStatus] = useState<KanbanStatus | null>(null);
  const [selectedTask, setSelectedTask] = useState<OperationalTask | null>(null);
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const liveRef = useRef<HTMLDivElement>(null);

  function openCreate(status: KanbanStatus = "pendente") { setCreationStatus(status); setNotice(null); }
  function closeDialog() { setCreationStatus(null); setSelectedTask(null); }
  function removeLocal(taskId: string) {
    setBoard((current) => ({
      pendente: current.pendente.filter((task) => task.id !== taskId),
      em_andamento: current.em_andamento.filter((task) => task.id !== taskId),
      aguardando: current.aguardando.filter((task) => task.id !== taskId),
      concluida: current.concluida.filter((task) => task.id !== taskId),
    }));
    setNotice("Tarefa removida com sucesso.");
  }

  function toggleKeyboardMove(taskId: string) {
    setKeyboardTaskId((current) => {
      const selected = current !== taskId;
      setNotice(selected ? "Tarefa selecionada. Use as setas esquerda e direita para movê-la entre as colunas." : "Seleção de movimentação cancelada.");
      return selected ? taskId : null;
    });
  }

  function move(taskId: string, status: KanbanStatus, requestedIndex?: number) {
    const current = board;
    const origin = KANBAN_STATUSES.find((candidate) => current[candidate].some((task) => task.id === taskId));
    if (!origin) return;
    if (!canMoveTask(origin, status)) {
      setNotice("Essa transição não é permitida para a tarefa.");
      return;
    }
    const originIndex = current[origin].findIndex((task) => task.id === taskId);
    const targetIndex = requestedIndex ?? (origin === status ? originIndex : current[status].length);
    const next = moveTaskInColumns(current, taskId, status, targetIndex);
    if (!next) return;
    const position = kanbanPosition(next, status, taskId);
    setBoard(next);
    setKeyboardTaskId(null);
    setNotice(`Tarefa movida para ${KANBAN_STATUS_META[status].label}, posição ${position.index + 1}.`);
    startTransition(async () => {
      const result = await moveTaskKanban({ taskId, status, beforeId: position.beforeId, afterId: position.afterId });
      if (!result.success) {
        setBoard(current);
        setNotice(result.error ?? "Não foi possível mover a tarefa. A posição anterior foi restaurada.");
        return;
      }
      liveRef.current?.focus();
    });
  }

  const visibleCount = KANBAN_STATUSES.reduce((total, status) => total + board[status].length, 0);
  const hasFilters = Boolean(filters.query || filters.assigneeId || filters.priority || filters.due || filters.patientId || filters.mine || filters.includeCancelled);

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight text-foreground">Tarefas</h1><p className="mt-1 text-sm text-muted-foreground">Organize e acompanhe as atividades da clínica.</p></div>
      <button type="button" aria-haspopup="dialog" aria-expanded={Boolean(creationStatus)} onClick={() => openCreate()} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4" />Nova tarefa</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo de tarefas">
      {([ ["A fazer", summary.pending], ["Em andamento", summary.inProgress], ["Aguardando", summary.awaiting], ["Concluídas", summary.completed] ] as const).map(([label, count]) => <article key={label} className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold leading-none text-foreground">{count}</p></article>)}
    </section>

    <form method="get" className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1.5fr)_minmax(10rem,.8fr)_minmax(9rem,.7fr)_minmax(9rem,.7fr)_minmax(14rem,1fr)_auto]">
        <label className="relative"><span className="sr-only">Pesquisar tarefas</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input name="q" type="search" defaultValue={filters.query ?? ""} placeholder="Pesquisar tarefa" className="h-10 w-full rounded-md border border-border bg-input-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
        <select name="responsavel" defaultValue={filters.assigneeId ?? ""} aria-label="Filtrar por responsável" className="h-10 rounded-md border border-border bg-input-background px-3 text-sm"><option value="">Responsável</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.nome}</option>)}</select>
        <select name="prioridade" defaultValue={filters.priority ?? ""} aria-label="Filtrar por prioridade" className="h-10 rounded-md border border-border bg-input-background px-3 text-sm"><option value="">Prioridade</option><option value="urgente">Urgente</option><option value="alta">Alta</option><option value="media">Normal</option><option value="baixa">Baixa</option></select>
        <select name="prazo" defaultValue={filters.due ?? ""} aria-label="Filtrar por prazo" className="h-10 rounded-md border border-border bg-input-background px-3 text-sm"><option value="">Prazo</option><option value="atrasadas">Atrasadas</option><option value="hoje">Hoje</option><option value="sem_prazo">Sem prazo</option></select>
        <PatientPicker inputName="paciente" initialPatient={selectedPatient} searchLabel="Filtrar por paciente" />
        <div className="flex items-center gap-2"><label className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 text-xs font-medium text-muted-foreground"><input name="minhas" value="1" defaultChecked={filters.mine} type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />Minhas</label><button className="h-10 rounded-md bg-secondary px-3 text-sm font-medium text-foreground hover:bg-secondary/80">Filtrar</button></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="inline-flex items-center gap-2 text-xs text-muted-foreground"><input name="canceladas" value="1" defaultChecked={filters.includeCancelled} type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />Incluir canceladas no histórico</label>{hasFilters && <Link href="/tarefas" className="text-xs font-medium text-primary hover:underline">Limpar filtros</Link>}</div>
    </form>

    {notice && <div ref={liveRef} role="status" tabIndex={-1} className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground focus:outline-none">{pending ? "Salvando alteração..." : notice}</div>}

    {visibleCount === 0 ? <section className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center"><XCircle className="mx-auto h-8 w-8 text-muted-foreground/50" /><h2 className="mt-3 text-sm font-semibold text-foreground">{hasFilters ? "Nenhuma tarefa corresponde aos filtros selecionados." : "Nenhuma tarefa encontrada."}</h2><p className="mt-1 text-sm text-muted-foreground">Registre uma pendência operacional para começar a organizar a rotina.</p><button type="button" onClick={() => openCreate()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Criar tarefa</button></section> : <section className="overflow-x-auto pb-3" aria-label="Quadro Kanban de tarefas"><div className="flex min-w-max items-start gap-4"><div className="sr-only" aria-live="polite">{notice}</div>{KANBAN_STATUSES.map((status) => <TaskColumn key={status} status={status} tasks={board[status]} count={counts[status]} movingId={draggingId} selectedForMove={keyboardTaskId} onCreate={openCreate} onOpen={setSelectedTask} onMove={move} onKeyboardSelect={toggleKeyboardMove} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} />)}</div><p className="mt-2 text-xs text-muted-foreground">As concluídas exibem as últimas 50 tarefas. Use os filtros para restringir o quadro.</p></section>}

    {filters.includeCancelled && <CancelledTasks tasks={columns.cancelada ?? []} />}
    {creationStatus && <Modal onClose={closeDialog} labelledBy="task-create-title"><header className="border-b border-border px-5 py-5 pr-14 sm:px-6"><h2 id="task-create-title" className="text-lg font-semibold">Nova tarefa</h2><p className="mt-1 text-sm text-muted-foreground">A tarefa será criada em {KANBAN_STATUS_META[creationStatus].label}.</p></header><TaskForm assignees={assignees} currentUserId={currentUserId} initialStatus={creationStatus} onSuccess={() => { closeDialog(); setNotice("Tarefa criada com sucesso."); router.refresh(); }} /></Modal>}
    {selectedTask && <TaskDialog task={selectedTask} assignees={assignees} currentUserId={currentUserId} profile={profile} onClose={closeDialog} onUpdated={() => { setNotice("Tarefa atualizada com sucesso."); router.refresh(); }} onRemoved={(taskId) => { removeLocal(taskId); router.refresh(); }} />}
  </div>;
}

function CancelledTasks({ tasks }: { tasks: OperationalTask[] }) {
  if (!tasks.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold text-foreground">Histórico cancelado</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{tasks.map((task) => <article key={task.id} className="rounded-lg border border-border bg-slate-50/60 p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-muted-foreground line-through">{task.titulo}</p><span className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">Cancelada</span></div><p className="mt-2 text-xs text-muted-foreground">{task.responsavel_nome} · {friendlyDate(task.prazo)}</p></article>)}</div></section>;
}
