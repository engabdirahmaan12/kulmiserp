-- Expense receipt uploads (images + PDF), public read via getPublicUrl
-- Path convention: {store_id}/{timestamp}.{ext}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  true,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SELECT: public bucket — allow listing/reading objects
CREATE POLICY "expense_receipts_select"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'expense-receipts');

-- INSERT: store members upload under their store folder
CREATE POLICY "expense_receipts_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- UPDATE: required for upsert uploads
CREATE POLICY "expense_receipts_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- DELETE: store members can remove their receipts
CREATE POLICY "expense_receipts_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND user_has_store_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
