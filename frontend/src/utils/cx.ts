type ClassStyles = Record<string, string | undefined>;

/** Resolve a whitespace-separated class list through CSS module maps. */
export function cx(
  styles: ClassStyles,
  ...values: Array<string | false | null | undefined>
): string {
  return values
    .flatMap((value) => (value ? String(value).split(/\s+/) : []))
    .map((name) => styles[name] ?? name)
    .filter(Boolean)
    .join(' ');
}
