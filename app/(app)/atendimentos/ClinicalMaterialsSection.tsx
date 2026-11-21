"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, PackageCheck, Plus, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatClinicDate, formatClinicTime } from "@/lib/agenda/dates";
import { initialClinicalMaterialActionState } from "@/lib/clinical/action-state";
import type {
  AttendanceClinicalMaterials,
  ClinicalLotOption,
  ClinicalMaterialConsumption,
  ClinicalMaterialSuggestion,
} from "@/lib/clinical/types";
import {
  loadAvailableClinicalLots,
  recordClinicalMaterialConsumption,
  reverseClinicalMaterialConsumption,
} from "./actions";

type ProcedureSummary = { id: string; descricao: string };

type Props = {
  attendanceId: string;
  inProgress: boolean;
  procedures: ProcedureSummary[];
  data: AttendanceClinicalMaterials;
};

function formatQuantity(quantity: number, unit: string) {
  return `${quantity} ${unit}`;
}

function ModalFrame({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/45 p-3 sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={() => !busy && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h4 id={titleId} className="text-lg font-medium">{title}</h4>
          <button
            ref={closeRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RegistrationDialog({
  attendanceId,
  procedure,
  materials,
  suggestions,
  initialMaterialId,
  onClose,
  onSuccess,
}: {
  attendanceId: string;
  procedure: ProcedureSummary;
  materials: AttendanceClinicalMaterials["materials"];
  suggestions: ClinicalMaterialSuggestion[];
  initialMaterialId?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const materialInputId = useId();
  const lotInputId = useId();
  const quantityInputId = useId();
  const defaultMaterialId = initialMaterialId ?? suggestions[0]?.material_id ?? materials[0]?.id ?? "";
  const defaultMaterial = materials.find((item) => item.id === defaultMaterialId);
  const [selectedMaterialId, setSelectedMaterialId] = useState(defaultMaterialId);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [lots, setLots] = useState<ClinicalLotOption[]>([]);
  const [lotsLoading, setLotsLoading] = useState(Boolean(defaultMaterial?.controla_lote_validade));
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(
    recordClinicalMaterialConsumption,
    initialClinicalMaterialActionState
  );
  const selectedMaterial = materials.find((item) => item.id === selectedMaterialId);
  const selectedSuggestion = suggestions.find(
    (item) => item.material_id === selectedMaterialId
  );

  useEffect(() => {
    let active = true;
    if (!selectedMaterial?.controla_lote_validade) {
      return () => { active = false; };
    }
    void loadAvailableClinicalLots(selectedMaterial.id).then((result) => {
      if (!active) return;
      setLots(result.lots);
      setLotsError(result.error);
      setLotsLoading(false);
    });
    return () => { active = false; };
  }, [selectedMaterial?.controla_lote_validade, selectedMaterial?.id]);

  const changeMaterial = (materialId: string) => {
    const nextMaterial = materials.find((item) => item.id === materialId);
    setSelectedMaterialId(materialId);
    setSelectedLotId("");
    setLots([]);
    setLotsError(null);
    setLotsLoading(Boolean(nextMaterial?.controla_lote_validade));
  };

  useEffect(() => {
    if (state.success) onSuccess(state.notice ?? "Material registrado.");
  }, [onSuccess, state.notice, state.success]);

  return (
    <ModalFrame title="Registrar material utilizado" onClose={onClose} busy={pending}>
      <p className="mt-1 text-sm text-muted-foreground">
        {procedure.descricao}. Registre somente o consumo que realmente ocorreu.
      </p>
      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="attendanceId" value={attendanceId} />
        <input type="hidden" name="procedureId" value={procedure.id} />
        <input type="hidden" name="snapshotId" value={selectedSuggestion?.id ?? ""} />
        <div>
          <label htmlFor={materialInputId} className="text-sm font-medium">Material</label>
          <select
            id={materialInputId}
            name="materialId"
            value={selectedMaterialId}
            onChange={(event) => changeMaterial(event.target.value)}
            required
            disabled={pending}
            aria-invalid={Boolean(state.fieldErrors?.materialId)}
            className="mt-1 h-11 w-full rounded-md border border-border bg-input-background px-3 text-sm disabled:opacity-60"
          >
            <option value="">Selecionar material</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.nome} · {material.unidade}{material.controla_lote_validade ? " · exige lote" : ""}
              </option>
            ))}
          </select>
          {state.fieldErrors?.materialId && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.materialId}</p>}
          {selectedSuggestion && (
            <p className="mt-1 text-xs text-muted-foreground">
              Previsto para este procedimento: {formatQuantity(selectedSuggestion.quantidade_prevista, selectedSuggestion.unidade)}.
            </p>
          )}
        </div>

        {selectedMaterial?.controla_lote_validade ? (
          <div>
            <label htmlFor={lotInputId} className="text-sm font-medium">Lote</label>
            <select
              id={lotInputId}
              name="lotId"
              value={selectedLotId}
              onChange={(event) => setSelectedLotId(event.target.value)}
              required
              disabled={pending || lotsLoading}
              aria-invalid={Boolean(state.fieldErrors?.lotId || lotsError)}
              className="mt-1 h-11 w-full rounded-md border border-border bg-input-background px-3 text-sm disabled:opacity-60"
            >
              <option value="">{lotsLoading ? "Carregando lotes..." : "Selecionar lote"}</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.codigo_lote} · validade {formatClinicDate(lot.data_validade)} · saldo {lot.quantidade_atual}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Lotes válidos aparecem por vencimento mais próximo. A escolha é sempre manual.
            </p>
            {!lotsLoading && !lotsError && lots.length === 0 && (
              <p className="mt-1 text-xs text-destructive">Nenhum lote válido com saldo disponível.</p>
            )}
            {(lotsError || state.fieldErrors?.lotId) && (
              <p className="mt-1 text-xs text-destructive">{lotsError ?? state.fieldErrors?.lotId}</p>
            )}
          </div>
        ) : (
          <input type="hidden" name="lotId" value="" />
        )}

        <div>
          <label htmlFor={quantityInputId} className="text-sm font-medium">Quantidade utilizada</label>
          <input
            id={quantityInputId}
            name="quantity"
            type="number"
            inputMode="numeric"
            min="1"
            max="1000000"
            step="1"
            defaultValue="1"
            required
            disabled={pending}
            aria-invalid={Boolean(state.fieldErrors?.quantity)}
            className="mt-1 h-11 w-full rounded-md border border-border bg-input-background px-3 text-sm disabled:opacity-60"
          />
          {state.fieldErrors?.quantity && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.quantity}</p>}
        </div>

        {state.error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-destructive">{state.error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button
            type="submit"
            disabled={pending || !selectedMaterial || (selectedMaterial.controla_lote_validade && (!selectedLotId || lotsLoading))}
          >
            {pending ? "Registrando..." : "Registrar consumo"}
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

function ReversalDialog({
  attendanceId,
  consumption,
  onClose,
  onSuccess,
}: {
  attendanceId: string;
  consumption: ClinicalMaterialConsumption;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(
    reverseClinicalMaterialConsumption,
    initialClinicalMaterialActionState
  );

  useEffect(() => {
    if (state.success) onSuccess(state.notice ?? "Consumo estornado.");
  }, [onSuccess, state.notice, state.success]);

  return (
    <ModalFrame title="Estornar consumo?" onClose={onClose} busy={pending}>
      <p className="mt-2 text-sm text-muted-foreground">
        O estoque de <strong className="font-medium text-foreground">{consumption.material_nome}</strong> será devolvido. O registro permanecerá no histórico como estornado.
      </p>
      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="attendanceId" value={attendanceId} />
        <input type="hidden" name="consumptionId" value={consumption.id} />
        {state.error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-destructive">{state.error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>Voltar</Button>
          <Button type="submit" disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
            {pending ? "Estornando..." : "Confirmar estorno"}
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

export function ClinicalMaterialsSection({
  attendanceId,
  inProgress,
  procedures,
  data,
}: Props) {
  const [registration, setRegistration] = useState<{ procedureId: string; materialId?: string } | null>(null);
  const [reversal, setReversal] = useState<ClinicalMaterialConsumption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const procedureById = useMemo(
    () => new Map(procedures.map((procedure) => [procedure.id, procedure])),
    [procedures]
  );
  const registrationProcedure = registration
    ? procedureById.get(registration.procedureId)
    : undefined;

  const finishSuccess = (message: string) => {
    setNotice(message);
    setRegistration(null);
    setReversal(null);
  };

  return (
    <section id="materiais-utilizados" className="scroll-mt-24 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            <h3 className="text-base font-medium">Materiais utilizados</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Consumo real registrado no atendimento. Materiais previstos são apenas uma referência.
          </p>
        </div>
      </div>

      {notice && (
        <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-md bg-green-50 p-3 text-sm text-green-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar mensagem" className="shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      {procedures.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Registre um procedimento antes de informar os materiais utilizados.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {procedures.map((procedure) => {
            const suggestions = data.suggestions.filter((item) => item.procedimento_id === procedure.id);
            const consumptions = data.consumptions.filter((item) => item.procedimento_id === procedure.id);
            const pendingControlled = suggestions.filter(
              (item) => item.controla_lote_validade && !item.consumo_ativo_registrado
            );
            return (
              <article key={procedure.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-medium">{procedure.descricao}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {consumptions.filter((item) => item.estornado_em === null).length} consumo(s) ativo(s)
                    </p>
                  </div>
                  {inProgress && data.materials.length > 0 && (
                    <Button size="sm" type="button" onClick={() => setRegistration({ procedureId: procedure.id })}>
                      <Plus className="h-4 w-4" /> Registrar material
                    </Button>
                  )}
                </div>

                {suggestions.length > 0 && (
                  <div className="mt-4 rounded-md bg-secondary/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Previsto pelo serviço</p>
                    <ul className="mt-2 space-y-2">
                      {suggestions.map((suggestion) => (
                        <li key={suggestion.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>
                            {suggestion.material_nome} · {formatQuantity(suggestion.quantidade_prevista, suggestion.unidade)}
                          </span>
                          <span className="flex items-center gap-2">
                            {suggestion.controla_lote_validade && !suggestion.consumo_ativo_registrado && (
                              <Badge tone="warning">Consumo ainda não registrado</Badge>
                            )}
                            {inProgress && (
                              <button
                                type="button"
                                onClick={() => setRegistration({ procedureId: procedure.id, materialId: suggestion.material_id })}
                                className="min-h-9 text-xs font-medium text-primary hover:underline"
                              >
                                Registrar uso
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pendingControlled.length > 0 && inProgress && (
                  <p className="mt-3 flex items-start gap-2 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    A finalização será bloqueada até haver consumo ativo dos materiais controlados por lote indicados acima.
                  </p>
                )}

                {consumptions.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">Nenhum consumo real registrado para este procedimento.</p>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {consumptions.map((consumption) => {
                      const reversed = consumption.estornado_em !== null;
                      return (
                        <div key={consumption.id} className={`rounded-md border p-3 ${reversed ? "bg-secondary/40 text-muted-foreground" : "bg-background"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-medium ${reversed ? "line-through" : ""}`}>{consumption.material_nome}</p>
                            <Badge tone={reversed ? "neutral" : "success"}>{reversed ? "Estornado" : "Ativo"}</Badge>
                          </div>
                          <dl className="mt-2 space-y-1 text-xs">
                            <div className="flex justify-between gap-3"><dt>Quantidade</dt><dd className="font-medium text-foreground">{formatQuantity(consumption.quantidade, consumption.unidade)}</dd></div>
                            {consumption.lote_codigo && <div className="flex justify-between gap-3"><dt>Lote</dt><dd className="font-medium text-foreground">{consumption.lote_codigo}</dd></div>}
                            {consumption.lote_validade && <div className="flex justify-between gap-3"><dt>Validade</dt><dd className="font-medium text-foreground">{formatClinicDate(consumption.lote_validade)}</dd></div>}
                            <div className="flex justify-between gap-3"><dt>Registrado em</dt><dd className="text-right font-medium text-foreground">{formatClinicDate(consumption.created_at, { dateStyle: "short" })} às {formatClinicTime(consumption.created_at)}</dd></div>
                          </dl>
                          {inProgress && !reversed && (
                            <button
                              type="button"
                              onClick={() => setReversal(consumption)}
                              className="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-medium text-destructive hover:underline"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Estornar
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!inProgress && (
        <p className="mt-4 text-xs text-muted-foreground">
          Atendimento finalizado: a rastreabilidade permanece visível e imutável.
        </p>
      )}
      {inProgress && data.materials.length === 0 && procedures.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">Nenhum material ativo está disponível para registro.</p>
      )}

      {registration && registrationProcedure && (
        <RegistrationDialog
          key={`${registration.procedureId}:${registration.materialId ?? "new"}`}
          attendanceId={attendanceId}
          procedure={registrationProcedure}
          materials={data.materials}
          suggestions={data.suggestions.filter((item) => item.procedimento_id === registration.procedureId)}
          initialMaterialId={registration.materialId}
          onClose={() => setRegistration(null)}
          onSuccess={finishSuccess}
        />
      )}
      {reversal && (
        <ReversalDialog
          key={reversal.id}
          attendanceId={attendanceId}
          consumption={reversal}
          onClose={() => setReversal(null)}
          onSuccess={finishSuccess}
        />
      )}
    </section>
  );
}
