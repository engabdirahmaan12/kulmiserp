'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Tag, Plus, Pencil, Trash2, FolderOpen } from 'lucide-react';
import type { ProductCategory } from '@/types';
import { toSelectItems } from '@/lib/ui/select-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

const PRESET_COLORS = [
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Green', value: '#22C55E' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Purple', value: '#A855F7' },
  { label: 'Orange', value: '#F97316' },
  { label: 'Teal', value: '#14B8A6' },
  { label: 'Pink', value: '#EC4899' },
  { label: 'Yellow', value: '#EAB308' },
  { label: 'Indigo', value: '#6366F1' },
  { label: 'Gray', value: '#6B7280' },
];

interface CategoryWithCount extends ProductCategory {
  product_count: number;
}

async function fetchCategories(storeId: string): Promise<CategoryWithCount[]> {
  const supabase = createClient();
  const [{ data: cats, error }, { data: counts }] = await Promise.all([
    supabase.from('product_categories').select('*').eq('store_id', storeId).order('name'),
    supabase.from('products').select('category_id').eq('store_id', storeId),
  ]);
  if (error) throw error;
  const countMap: Record<string, number> = {};
  (counts ?? []).forEach((p) => {
    if (p.category_id) countMap[p.category_id] = (countMap[p.category_id] ?? 0) + 1;
  });
  return (cats ?? []).map((c) => ({ ...c, product_count: countMap[c.id] ?? 0 }));
}

const emptyForm = { name: '', description: '', color: '#3B82F6', parent_id: '' };

export default function CategoriesPage() {
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [showDialog, setShowDialog] = useState(false);
  const [editCat, setEditCat] = useState<CategoryWithCount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryWithCount | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories', currentStore?.id],
    queryFn: () => fetchCategories(currentStore!.id),
    enabled: !!currentStore,
  });

  const openAdd = () => {
    setEditCat(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (cat: CategoryWithCount) => {
    setEditCat(cat);
    setForm({ name: cat.name, description: cat.description ?? '', color: cat.color, parent_id: cat.parent_id ?? '' });
    setShowDialog(true);
  };

  const { mutate: saveCategory, isPending: saving } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const payload = {
        store_id: currentStore!.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
        parent_id: form.parent_id || null,
      };
      if (editCat) {
        const { error } = await supabase.from('product_categories').update(payload).eq('id', editCat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('product_categories').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', currentStore?.id] });
      toast.success(editCat ? t('categories.categoryUpdated') : t('categories.categoryCreated'));
      setShowDialog(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: deleteCategory, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from('product_categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', currentStore?.id] });
      toast.success(t('categories.categoryDeleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const topLevel = categories.filter((c) => !c.parent_id);
  const parentCategoryItems = useMemo(
    () => toSelectItems(
      topLevel.filter((c) => c.id !== editCat?.id),
      (c) => c.id,
      (c) => c.name,
      [{ value: 'none', label: t('categories.noneTopLevel') }],
    ),
    [topLevel, editCat?.id],
  );
  const totalProducts = categories.reduce((s, c) => s + c.product_count, 0);
  const withProducts = categories.filter((c) => c.product_count > 0).length;

  return (
    <PageShell>
      <PageHeader
        title={t('categories.title')}
        description={t('categories.description')}
        icon={Tag}
        variant="banner"
        actions={
          <Button onClick={openAdd} className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold bg-white/20 hover:bg-white/30 border border-white/30 text-white shadow-none')}>
            <Plus className="h-4 w-4" /> {t('categories.addCategory')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('categories.count')} value={String(categories.length)} accent="blue" />
        <StatChip label={t('categories.topLevel')} value={String(topLevel.length)} accent="violet" />
        <StatChip label={t('categories.withProducts')} value={String(withProducts)} accent="emerald" />
        <StatChip label={t('categories.totalProducts')} value={String(totalProducts)} accent="orange" />
      </StatStrip>

      {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Tag className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-base font-medium mb-1">{t('categories.noCategoriesYet')}</p>
            <p className="text-sm mb-4">{t('categories.organizeHint')}</p>
            <Button onClick={openAdd} className={cn(btnPrimary, 'gap-2')}>
              <Plus className="h-4 w-4" /> {t('categories.createFirst')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {categories.map((cat) => {
              const parent = categories.find((c) => c.id === cat.parent_id);
              return (
                <div
                  key={cat.id}
                  className="group relative bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: cat.color + '20' }}
                    >
                      <div className="h-4 w-4 rounded-full" style={{ backgroundColor: cat.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate text-sm">{cat.name}</p>
                      {parent && (
                        <p className="text-xs text-slate-400 truncate">{t('categories.inParent', { parent: parent.name })}</p>
                      )}
                      {cat.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{cat.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge variant="secondary" className="text-xs">
                      <FolderOpen className="h-3 w-3 mr-1" />
                      {t('categories.productsCount', { count: cat.product_count })}
                    </Badge>
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(cat)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-white shadow hover:bg-slate-100 text-slate-500"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(cat)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-white shadow hover:bg-red-50 text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editCat ? t('categories.editCategory') : t('categories.addCategory')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('categories.name')} *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('categories.namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('categories.descriptionLabel')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('categories.descriptionPlaceholder')}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('categories.color')}</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                    className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${form.color === c.value ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : ''}`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('categories.parentCategory')}</Label>
              <Select
                items={parentCategoryItems}
                value={form.parent_id || 'none'}
                onValueChange={(v) => setForm((f) => ({ ...f, parent_id: (v ?? '') === 'none' ? '' : (v ?? '') }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('categories.noneTopLevel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('categories.noneTopLevel')}</SelectItem>
                  {topLevel.filter((c) => c.id !== editCat?.id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>{t('categories.cancel')}</Button>
            <Button
              onClick={() => saveCategory()}
              disabled={!form.name.trim() || saving}
              className={btnPrimary}
            >
              {saving ? t('categories.saving') : editCat ? t('categories.update') : t('categories.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('categories.deleteCategory')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            {t('categories.deleteConfirm')} <strong>{deleteTarget?.name}</strong>?
            {(deleteTarget?.product_count ?? 0) > 0 && (
              <span className="text-red-600"> {t('categories.hasProductsWarning', { count: deleteTarget?.product_count ?? 0 })}</span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('categories.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteCategory(deleteTarget.id)}
              disabled={deleting}
            >
              {deleting ? t('categories.deleting') : t('categories.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
