const CUIABA_TIME_ZONE = "America/Cuiaba";

function parts(value: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: CUIABA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function dateInputValueInCuiaba(value = new Date()) {
  const valueParts = parts(value);
  return `${valueParts.year}-${valueParts.month}-${valueParts.day}`;
}

export function dateTimeInputValueInCuiaba(value: string | null) {
  if (!value) return "";
  const valueParts = parts(new Date(value));
  return `${valueParts.year}-${valueParts.month}-${valueParts.day}T${valueParts.hour}:${valueParts.minute}`;
}
