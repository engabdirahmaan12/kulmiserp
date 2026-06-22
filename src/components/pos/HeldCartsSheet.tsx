'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { usePosStore } from '@/lib/stores/pos';
import { deleteHeldCartFromDatabase } from '@/lib/pos/held-cart-persistence';
import { PauseCircle, Play, Trash2, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface HeldCartsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function HeldCartsSheet({ open, onClose }: HeldCartsSheetProps) {
  const { held_carts, resumeCart, deleteHeldCart } = usePosStore();
  const { t } = useTranslation();

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <SheetTitle className="flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-orange-500" />
              {t('pos.heldCarts', { count: held_carts.length })}
            </SheetTitle>
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {held_carts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <PauseCircle className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">{t('pos.noHeldCarts')}</p>
            </div>
          ) : (
            held_carts.map((cart) => (
              <div
                key={cart.id}
                className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{cart.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {format(new Date(cart.held_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (cart.db_sale_id) {
                        try {
                          await deleteHeldCartFromDatabase(cart.db_sale_id);
                        } catch { /* local-only fallback */ }
                      }
                      deleteHeldCart(cart.id);
                    }}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  {cart.items.slice(0, 3).map((item) => (
                    <div key={item.line_key} className="flex justify-between text-sm gap-2">
                      <span className="text-slate-600 truncate mr-2">
                        {item.product_name}
                        {item.sale_unit_code ? (
                          <span className="text-[10px] text-slate-400 ml-1 uppercase">{item.sale_unit_code}</span>
                        ) : null}
                      </span>
                      <span className="text-slate-900 shrink-0">×{item.quantity}</span>
                    </div>
                  ))}
                  {cart.items.length > 3 && (
                    <p className="text-xs text-slate-400">{t('pos.moreItems', { count: cart.items.length - 3 })}</p>
                  )}
                </div>

                {cart.customer && (
                  <p className="text-xs text-slate-500">
                    {t('pos.customerLabel', { name: cart.customer.full_name })}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40 gap-1.5"
                    onClick={async () => {
                      resumeCart(cart.id);
                      if (cart.db_sale_id) {
                        try {
                          await deleteHeldCartFromDatabase(cart.db_sale_id);
                        } catch { /* already loaded locally */ }
                      }
                      onClose();
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t('pos.resume')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
