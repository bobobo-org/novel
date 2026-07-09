import { z } from 'zod';

export const storyCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  genre: z.string().trim().max(240).optional().default(''),
  themeMode: z.string().trim().min(1).max(40),
  subTheme: z.string().trim().max(40).optional().default(''),
  storyEngine: z.string().trim().max(40).optional().default(''),
  heroType: z.string().trim().max(40).optional().default(''),
  hostType: z.string().trim().max(40).optional().default(''),
  worldCore: z.string().trim().max(40).optional().default(''),
  powerCore: z.string().trim().max(40).optional().default(''),
  conflictCore: z.string().trim().max(40).optional().default(''),
  villainCore: z.string().trim().max(40).optional().default(''),
  styleMode: z.string().trim().max(40).optional().default(''),
  coreIdea: z.string().trim().max(4000).optional().default(''),
});

export const generateRequestSchema = z.object({
  storyId: z.uuid(),
  mode: z.enum(['first_chapter', 'next_chapter', 'outline', 'summarize']).default('first_chapter'),
  choice: z.enum(['A', 'B', 'C']).optional(),
  customAction: z.string().trim().max(1000).optional(),
});

export type StoryCreateInput = z.infer<typeof storyCreateSchema>;
export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;

export function toStoryRow(input: StoryCreateInput, userId: string) {
  return {
    user_id: userId,
    title: input.title,
    genre: input.genre,
    theme_mode: input.themeMode,
    sub_theme: input.subTheme,
    story_engine: input.storyEngine,
    hero_type: input.heroType,
    host_type: input.hostType,
    world_core: input.worldCore,
    power_core: input.powerCore,
    conflict_core: input.conflictCore,
    villain_core: input.villainCore,
    style_mode: input.styleMode,
    core_idea: input.coreIdea,
  };
}
