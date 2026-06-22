import { createClient as createAdminClient } from '@supabase/supabase-js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function logAiUsage(params: {
  storeId: string;
  userId: string;
  requestType?: string;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
}) {
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const tokens = (params.promptTokens ?? 0) + (params.completionTokens ?? 0);
    const costPerToken = 0.000002;

    await admin.from('ai_usage_logs').insert({
      store_id: params.storeId,
      user_id: params.userId,
      request_type: params.requestType ?? 'copilot',
      tokens_used: tokens,
      estimated_cost_usd: tokens * costPerToken,
      model: params.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    });
  } catch {
    // Non-blocking — table may not exist until migration applied
  }
}

export { estimateTokens };
