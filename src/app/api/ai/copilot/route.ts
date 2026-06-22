import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { answerCopilotQuery } from '@/lib/intelligence/copilot';
import { buildCopilotContext } from '@/lib/intelligence/context';
import { estimateTokens, logAiUsage } from '@/lib/platform/log-ai-usage';
import type { StoreIntelligence } from '@/lib/intelligence/types';

export const runtime = 'nodejs';

async function verifyStoreAccess(userId: string, storeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('store_users')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

async function callLlm(system: string, userMessage: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'openai/gpt-4o-mini';
  const baseUrl = process.env.OPENROUTER_API_KEY
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_API_KEY
        ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://kulmis.app', 'X-Title': 'KULMIS ERP' }
        : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      storeId: string;
      storeName: string;
      currency: string;
      query: string;
      intelligence: StoreIntelligence;
      userName?: string;
      stream?: boolean;
      locale?: 'en' | 'so' | 'ar';
    };

    if (!body.storeId || !body.query || !body.intelligence) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const allowed = await verifyStoreAccess(user.id, body.storeId);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const fallback = answerCopilotQuery(body.query, body.intelligence, body.currency, body.storeName);
    const context = buildCopilotContext(
      body.intelligence,
      body.storeName,
      body.currency,
      body.userName,
    );

    const locale = body.locale ?? 'en';
    const languageInstruction =
      locale === 'so'
        ? 'Respond ONLY in Somali (Af-Soomaali). Use clear, professional business Somali.'
        : locale === 'ar'
          ? 'Respond ONLY in Arabic (العربية). Use clear, professional Modern Standard Arabic.'
          : 'Respond ONLY in English.';

    const system = `You are KULMIS AI, an expert ERP business copilot for "${body.storeName}".
${languageInstruction}
Answer ONLY using the store data JSON below. Currency: ${body.currency}.
Be concise, actionable, and friendly. Use bullet points for lists.
If data is missing, say so. Never invent numbers. Never reference other stores.
For reports, use clear sections with numbers formatted as currency.

STORE DATA:
${context}`;

    const llmAnswer = await callLlm(system, body.query);
    const answer = llmAnswer || fallback.answer;
    const source = llmAnswer ? 'llm' : 'rules';

    void logAiUsage({
      storeId: body.storeId,
      userId: user.id,
      promptTokens: estimateTokens(body.query + context),
      completionTokens: estimateTokens(answer),
    });

    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          let i = 0;
          const chunkSize = 12;
          const push = () => {
            if (i >= answer.length) {
              controller.enqueue(encoder.encode(`\n\n[[ACTIONS:${JSON.stringify(fallback.actions ?? [])}]]`));
              controller.enqueue(encoder.encode(`\n[[SOURCE:${source}]]`));
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(answer.slice(i, i + chunkSize)));
            i += chunkSize;
            setTimeout(push, 16);
          };
          push();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    return NextResponse.json({
      answer,
      actions: fallback.actions,
      source,
    });
  } catch (e) {
    console.error('AI copilot error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
