import type { Account, AccountType } from '@/types';

export const DEBIT_NORMAL_TYPES: AccountType[] = ['asset', 'expense', 'cogs'];
export const CREDIT_NORMAL_TYPES: AccountType[] = ['liability', 'equity', 'revenue'];

export const PAYMENT_ACCOUNT_CODES = [
  '1110', '1120', '1130', '1140', '1150', '1160', '1165', '1170',
] as const;

export const BANK_ACCOUNT_CODES = ['1160', '1165', '1170'] as const;

export function isDebitNormal(type: AccountType): boolean {
  return DEBIT_NORMAL_TYPES.includes(type);
}

/** Normal balance for display (positive = natural side) */
export function normalBalance(account: Pick<Account, 'balance' | 'account_type'>): number {
  return isDebitNormal(account.account_type) ? account.balance : -account.balance;
}

/** Trial balance debit/credit columns from stored balance */
export function trialBalanceAmounts(account: Pick<Account, 'balance' | 'account_type'>): {
  debit: number;
  credit: number;
} {
  const b = account.balance;
  if (isDebitNormal(account.account_type)) {
    return b >= 0 ? { debit: b, credit: 0 } : { debit: 0, credit: Math.abs(b) };
  }
  return b <= 0 ? { debit: 0, credit: Math.abs(b) } : { debit: b, credit: 0 };
}

export function sumAccountsByType(accounts: Account[], types: AccountType[]): number {
  return accounts
    .filter((a) => types.includes(a.account_type))
    .reduce((s, a) => s + normalBalance(a), 0);
}

export function getAccountByCode(accounts: Account[], code: string): Account | undefined {
  return accounts.find((a) => a.code === code);
}

/** Build nested tree from flat accounts (sorted by code) */
export function buildAccountTree(accounts: Account[]): Account[] {
  const map = new Map<string, Account>();
  const roots: Account[] = [];

  for (const a of accounts) {
    map.set(a.id, { ...a, children: [] });
  }

  for (const a of accounts) {
    const node = map.get(a.id)!;
    if (a.parent_id && map.has(a.parent_id)) {
      map.get(a.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: Account[]) => {
    nodes.sort((x, y) => x.code.localeCompare(y.code));
    nodes.forEach((n) => n.children?.length && sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

/** Flatten tree for table display with depth indent */
export function flattenAccountTree(nodes: Account[], depth = 0): { account: Account; depth: number }[] {
  const out: { account: Account; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ account: n, depth });
    if (n.children?.length) out.push(...flattenAccountTree(n.children, depth + 1));
  }
  return out;
}

export function computeRunningBalances(
  opening: number,
  lines: { debit_amount: number; credit_amount: number }[],
): number[] {
  let running = opening;
  return lines.map((line) => {
    running += (line.debit_amount || 0) - (line.credit_amount || 0);
    return running;
  });
}

export const EXPENSE_CATEGORY_ACCOUNTS: Record<string, string> = {
  Rent: '6100',
  Utilities: '6200',
  Salaries: '6300',
  Marketing: '6400',
};
