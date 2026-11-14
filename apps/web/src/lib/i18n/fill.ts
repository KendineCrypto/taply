/**
 * Fills `{name}` placeholders. Values are inserted as plain text by React, so
 * nothing here can introduce markup. Unknown placeholders are left visible
 * rather than silently dropped, so a missing value is noticed in review.
 * (No dictionary import: safe for the NEAR Mainnet bundle.)
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
