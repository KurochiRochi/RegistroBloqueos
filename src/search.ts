import { professionalKey } from "./model.ts";

/** Coincidencia sin tildes ni mayúsculas, por todas las palabras escritas (en cualquier orden). */
export function matchesAll(text: string, query: string) {
  const hay = professionalKey(text);
  return professionalKey(query)
    .split(" ")
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
