'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { DataPanel } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUploadZone } from '@/components/media/ImageUploadZone';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import { StoreLogo } from '@/components/media/StoreLogo';
import {
  LOGO_SHAPE_OPTIONS,
  getStoreBrandingSettings,
  logoShapeLabel,
  type LogoShape,
} from '@/lib/media/branding';
import { uploadStoreCover, uploadStoreLogo } from '@/lib/storage/upload';
import { cn } from '@/lib/utils';
import { Loader2, Palette, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export function StoreBrandingPanel() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const branding = getStoreBrandingSettings(currentStore);

  const [logoPreview, setLogoPreview] = useState<string | null>(currentStore?.logo_url ?? null);
  const [coverPreview, setCoverPreview] = useState<string | null>(currentStore?.cover_url ?? null);
  const [logoBlob, setLogoBlob] = useState<Blob | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [logoShape, setLogoShape] = useState<LogoShape>(branding.logo_shape ?? 'rounded-12');
  const [logoRadius, setLogoRadius] = useState(branding.logo_radius ?? 12);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropTarget, setCropTarget] = useState<'logo' | 'cover'>('logo');
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeCover, setRemoveCover] = useState(false);

  useEffect(() => {
    setLogoPreview(currentStore?.logo_url ?? null);
    setCoverPreview(currentStore?.cover_url ?? null);
    setLogoShape(branding.logo_shape ?? 'rounded-12');
    setLogoRadius(branding.logo_radius ?? 12);
    setLogoBlob(null);
    setCoverBlob(null);
    setRemoveLogo(false);
    setRemoveCover(false);
  }, [currentStore?.id, currentStore?.logo_url, currentStore?.cover_url, branding.logo_shape, branding.logo_radius]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore?.id || !user?.id) throw new Error('Not authenticated');

      let logoUrl: string | null | undefined;
      let coverUrl: string | null | undefined;

      if (logoBlob) {
        const up = await uploadStoreLogo(currentStore.id, logoBlob);
        logoUrl = up.url;
      }
      if (coverBlob) {
        const up = await uploadStoreCover(currentStore.id, coverBlob);
        coverUrl = up.url;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_branding', {
        p_store_id: currentStore.id,
        p_user_id: user.id,
        p_logo_url: logoUrl ?? null,
        p_cover_url: coverUrl ?? null,
        p_clear_logo: removeLogo,
        p_clear_cover: removeCover,
        p_settings: {
          logo_shape: logoShape,
          logo_radius: logoRadius,
        },
      });

      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Save failed');
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      if (currentStore?.id) {
        const supabase = createClient();
        const { data: refreshed } = await supabase.from('stores').select('*').eq('id', currentStore.id).single();
        if (refreshed) {
          useAuthStore.setState((s) => ({
            currentStore: refreshed as typeof s.currentStore,
            stores: s.stores.map((st) => (st.id === refreshed.id ? (refreshed as typeof st) : st)),
          }));
        }
      }
      toast.success('Branding saved');
      setLogoBlob(null);
      setCoverBlob(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  });

  const onLogoFile = (file: File) => {
    setCropTarget('logo');
    setCropFile(file);
    setRemoveLogo(false);
  };

  const onCoverFile = (file: File) => {
    setCropTarget('cover');
    setCropFile(file);
    setRemoveCover(false);
  };

  const onCropConfirm = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    if (cropTarget === 'logo') {
      setLogoBlob(blob);
      setLogoPreview(url);
    } else {
      setCoverBlob(blob);
      setCoverPreview(url);
    }
    setCropFile(null);
  };

  return (
    <>
      <DataPanel className="p-6 space-y-8">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Store branding</h3>
            <p className="text-sm text-slate-500 mt-0.5">Logo and cover appear across POS, invoices, sidebar, and reports.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ImageUploadZone
            label="Store logo"
            previewUrl={removeLogo ? null : logoPreview}
            onFileSelected={onLogoFile}
            onRemove={() => {
              setLogoPreview(null);
              setLogoBlob(null);
              setRemoveLogo(true);
            }}
          />
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-700">Preview</p>
            <div className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 bg-slate-50/80">
              <StoreLogo
                size="lg"
                srcOverride={removeLogo ? null : logoPreview}
                shapeOverride={logoShape}
                radiusOverride={logoRadius}
              />
              <div>
                <p className="font-semibold text-slate-900">{currentStore?.name}</p>
                <p className="text-xs text-slate-500">Sidebar & invoices</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-slate-500">Logo shape</Label>
              <div className="flex flex-wrap gap-2">
                {LOGO_SHAPE_OPTIONS.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => setLogoShape(shape)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                      logoShape === shape
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    {logoShapeLabel(shape)}
                  </button>
                ))}
              </div>
              {logoShape === 'custom' && (
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-xs text-slate-500 shrink-0">Radius (px)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    value={logoRadius}
                    onChange={(e) => setLogoRadius(Number(e.target.value))}
                    className="h-9 w-24"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-6">
          <ImageUploadZone
            label="Store cover / banner"
            hint="Recommended 1200×400 · PNG, JPG, WEBP · Max 10 MB"
            aspect="banner"
            previewUrl={removeCover ? null : coverPreview}
            onFileSelected={onCoverFile}
            onRemove={() => {
              setCoverPreview(null);
              setCoverBlob(null);
              setRemoveCover(true);
            }}
            className="max-w-2xl"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            className="bg-gradient-to-r from-blue-600 to-indigo-600 gap-2"
            onClick={() => save()}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save branding
          </Button>
        </div>
      </DataPanel>

      <ImageCropDialog
        open={!!cropFile}
        file={cropFile}
        title={cropTarget === 'logo' ? 'Crop logo' : 'Crop cover'}
        onClose={() => setCropFile(null)}
        onConfirm={onCropConfirm}
      />
    </>
  );
}
