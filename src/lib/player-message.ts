/** A backend refusal is already written for players; a thrown program error is not. */
export function playerMessage(raw: string, fallback: string): string {
  if (/^(?:TypeError|ReferenceError|RangeError|SyntaxError)\b/.test(raw)) return fallback;
  return raw.replace(/^Error: /, "");
}
