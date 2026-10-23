import { formatHeure, formatJour } from "@/lib/utils";

/** Date sur la première ligne, heure (Djibouti) sur la seconde. */
export function DateHeure({ value }: { value: Date | string }) {
  return (
    <span className="inline-flex flex-col leading-tight whitespace-nowrap">
      <span>{formatJour(value)}</span>
      <span className="text-xs text-muted-foreground">{formatHeure(value)}</span>
    </span>
  );
}
