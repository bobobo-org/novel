import { NextResponse } from 'next/server';

import { getStoryWithChapters } from '@/lib/stories/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> },
) {
  const { storyId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { story, chapters } = await getStoryWithChapters(supabase, storyId);

  if (story.error) {
    return NextResponse.json({ error: story.error.message }, { status: 404 });
  }

  if (chapters?.error) {
    return NextResponse.json({ error: chapters.error.message }, { status: 500 });
  }

  return NextResponse.json({ story: story.data, chapters: chapters?.data ?? [] });
}
