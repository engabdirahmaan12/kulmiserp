'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ShoppingCart, Package, Users, FileText, Receipt, BarChart3,
  Calculator, Sparkles, Bell, Truck, Settings, LayoutDashboard,
  ShoppingBag, History,
} from 'lucide-react';
import { useGlobalSearchQuery } from '@/lib/hooks/useIntelligence';
import { openAiCopilot } from '@/lib/stores/ai-copilot';
import { cn } from '@/lib/utils';

const NAV_COMMANDS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, shortcut: 'D' },
  { label: 'Open POS', href: '/dashboard/pos', icon: ShoppingCart, shortcut: 'P' },
  { label: 'Add Product', href: '/dashboard/inventory', icon: Package },
  { label: 'Create Purchase', href: '/dashboard/purchase', icon: Truck },
  { label: 'New Invoice', href: '/dashboard/custom-sales', icon: FileText },
  { label: 'Customers', href: '/dashboard/customers', icon: Users },
  { label: 'Expenses', href: '/dashboard/expenses', icon: Receipt },
  { label: 'Financial Reports', href: '/dashboard/accounting', icon: Calculator },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart3 },
  { label: 'AI Intelligence', href: '/dashboard/intelligence', icon: Sparkles },
  { label: 'Alerts Center', href: '/dashboard/reminders', icon: Bell },
  { label: 'Sales History', href: '/dashboard/sales-history', icon: History },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
];

const TYPE_LABELS: Record<string, string> = {
  product: 'Product',
  customer: 'Customer',
  supplier: 'Supplier',
  sale: 'Invoice',
  expense: 'Expense',
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data: searchResults = [], isFetching } = useGlobalSearchQuery(search, open);

  const run = useCallback(
    (href: string) => {
      onOpenChange(false);
      setSearch('');
      router.push(href);
    },
    [onOpenChange, router],
  );

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="KULMIS Command Palette">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search products, customers, invoices… or type a command"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
        <CommandEmpty>{isFetching ? 'Searching…' : 'No results found.'}</CommandEmpty>

        {searchResults.length > 0 && (
          <CommandGroup heading="Search results">
            {searchResults.map((r) => (
              <CommandItem key={`${r.type}_${r.id}`} onSelect={() => run(r.href)}>
                <ShoppingBag className="h-4 w-4 text-blue-600" />
                <span className="flex-1 truncate">{r.title}</span>
                <span className="text-[10px] text-slate-400 uppercase">{TYPE_LABELS[r.type]}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="AI">
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              setSearch('');
              openAiCopilot();
            }}
          >
            <Sparkles className="h-4 w-4 text-blue-600" />
            <span>Ask KULMIS AI</span>
            <CommandShortcut>⌘I</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          {NAV_COMMANDS.filter((c) =>
            !search || c.label.toLowerCase().includes(search.toLowerCase()),
          ).map(({ label, href, icon: Icon, shortcut }) => (
            <CommandItem key={href} onSelect={() => run(href)}>
              <Icon className={cn('h-4 w-4', 'text-blue-600')} />
              <span>{label}</span>
              {shortcut && <CommandShortcut>⌘{shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        openAiCopilot();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
