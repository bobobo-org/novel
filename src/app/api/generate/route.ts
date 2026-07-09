import OpenAI from 'openai';
import { NextResponse } from 'next/server';

import { assertGenerationQuota, QuotaExceededError } from '@/lib/ai/quota';
import { buildGenerationPrompt, parseGeneratedChapter } from '@/lib/ai/prompt';
import { getOpenAiEnv } from '@/lib/env';
import { type ChapterRow } from '@/lib/stories/queries';
import { generateRequestSchema } from '@/lib/stories/schema';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = generateRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { storyId, mode, choice, customAction } = parsed.data;

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (storyError || !story) {
    return NextResponse.json({ error: 'Story not found' }, { status: 404 });
  }

  try {
    await assertGenerationQuota({ userId: user.id, supabaseAdmin: admin });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    throw error;
  }

  const { data: latestChapter } = await supabase
    .from('chapters')
    .select('*')
    .eq('story_id', storyId)
    .order('chapter_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestMemory } = await supabase
    .from('story_memories')
    .select('*')
    .eq('story_id', storyId)
    .order('chapter_through', { ascending: false })
    .limit(1)
    .maybeSingle();

  const env = getOpenAiEnv();
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const prompt = buildGenerationPrompt({
    story,
    latestChapter: latestChapter as ChapterRow | null,
    memory: latestMemory?.summary ?? null,
    mode,
    choice,
    customAction,
  });

  const startedEvent = await admin
    .from('generation_events')
    .insert({
      user_id: user.id,
      story_id: storyId,
      kind: mode,
      model: env.OPENAI_MODEL,
      status: 'started',
    })
    .select('id')
    .single();

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const outputText = response.output_text ?? '';
    const generated = parseGeneratedChapter(outputText);
    const nextChapterNumber = (story.current_chapter ?? 0) + 1;

    const { data: chapter, error: chapterError } = await admin
      .from('chapters')
      .insert({
        story_id: storyId,
        user_id: user.id,
        chapter_number: nextChapterNumber,
        title: generated.title,
        content: generated.content,
        choices: generated.choices,
        selected_choice: choice ?? null,
        custom_action: customAction ?? null,
        model: env.OPENAI_MODEL,
      })
      .select('*')
      .single();

    if (chapterError) {
      throw chapterError;
    }

    await admin
      .from('stories')
      .update({
        current_chapter: nextChapterNumber,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storyId)
      .eq('user_id', user.id);

    await admin
      .from('generation_events')
      .update({
        chapter_id: chapter.id,
        status: 'succeeded',
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
      })
      .eq('id', startedEvent.data?.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunkText(generated.content, 80)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', chunk })}\n\n`));
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'done',
              chapter,
              choices: generated.choices,
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    await admin
      .from('generation_events')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', startedEvent.data?.id);

    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
  }
}

function chunkText(text: string, size: number) {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [''];
}
