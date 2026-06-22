import type { ReactNode } from 'react';

export type SelectOption = {
  value: string;
  label: ReactNode;
};

/** Build `{ value, label }[]` for Base UI Select — fixes UUID showing in trigger. */
export function toSelectItems<T>(
  rows: T[],
  getValue: (row: T) => string,
  getLabel: (row: T) => ReactNode,
  extras: SelectOption[] = [],
): SelectOption[] {
  return [...extras, ...rows.map((row) => ({ value: getValue(row), label: getLabel(row) }))];
}

export function selectLabel(
  items: SelectOption[] | undefined,
  value: string | null | undefined,
  fallback = '',
): ReactNode {
  if (!value) return fallback;
  return items?.find((i) => i.value === value)?.label ?? value;
}
