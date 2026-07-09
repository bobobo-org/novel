import type { SupabaseClient } from '@supabase/supabase-js';

import type { StoryCreateInput } from './schema';
import { toStoryRow } from './schema';

export type StoryRow = {
  id: string;
  user_id: string;
  title: string;
  genre: string | null;
  theme_mode: string;
  sub_theme: string | null;
  story_engine: string | null;
  hero_type: string | null;
  host_type: string | null;
  world_core: string | null;
  power_core: string | null;
  conflict_core: string | null;
  villain_core: string | null;
  style_mode: string | null;
  core_idea: string | null;
  status: string;
  current_chapter: number;
  created_at: string;
  updated_at: string;
};

export type ChapterRow = {
  id: string;
  story_id: string;
  user_id: string;
  chapter_number: number;
  title: string | null;
  content: string;
  choices: unknown;
  selected_choice: string | null;
  custom_action: string | null;
  model: string | null;
  created_at: string;
};

export async function listStories(supabase: SupabaseClient) {
  return supabase.from('stories').select('*').order('updated_at', { ascending: false });
}

export async function createStory(
  supabase: SupabaseClient,
  input: StoryCreateInput,
  userId: string,
) {
  return supabase.from('stories').insert(toStoryRow(input, userId)).select('*').single();
}

export async function getStoryWithChapters(supabase: SupabaseClient, storyId: string) {
  const storyResult = await supabase.from('stories').select('*').eq('id', storyId).single();

  if (storyResult.error || !storyResult.data) {
    return { story: storyResult, chapters: null };
  }

  const chapters = await supabase
    .from('chapters')
    .select('*')
    .eq('story_id', storyId)
    .order('chapter_number');

  return { story: storyResult, chapters };
}
