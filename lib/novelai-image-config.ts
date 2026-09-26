export const NOVELAI_DEFAULT_MODEL = "nai-diffusion-4-curated-preview";
export const NOVELAI_DEFAULT_RESOLUTION = "832x1216";
export const NOVELAI_DEFAULT_SAMPLER = "k_euler";
export const NOVELAI_DEFAULT_NOISE_SCHEDULE = "karras";
export const NOVELAI_DEFAULT_STEPS = 28;
export const NOVELAI_DEFAULT_SCALE = 6;

export const NOVELAI_MODEL_OPTIONS = [
  { value: "nai-diffusion-5-full", label: "NovelAI Diffusion V5 Full" },
  { value: "nai-diffusion-5-curated", label: "NovelAI Diffusion V5 Curated" },
  { value: "nai-diffusion-4-5-full", label: "NovelAI Diffusion V4.5 Full" },
  { value: "nai-diffusion-4-5-curated", label: "NovelAI Diffusion V4.5 Curated" },
  { value: "nai-diffusion-4-full", label: "NovelAI Diffusion V4 Full" },
  { value: "nai-diffusion-4-curated-preview", label: "NovelAI Diffusion V4 Curated" },
  { value: "nai-diffusion-3", label: "NovelAI Diffusion V3" },
  { value: "nai-diffusion-furry-3", label: "NovelAI Diffusion Furry V3" },
] as const;

export const NOVELAI_COMMON_MODELS = NOVELAI_MODEL_OPTIONS.map(option => option.value);

export const NOVELAI_RESOLUTION_OPTIONS = [
  { value: "832x1216", label: "832x1216 (标准竖向 2:3)", width: 832, height: 1216 },
  { value: "1216x832", label: "1216x832 (标准横向 3:2)", width: 1216, height: 832 },
  { value: "1024x1024", label: "1024x1024 (正方形 1:1)", width: 1024, height: 1024 },
  { value: "1024x1536", label: "1024x1536 (大图竖向)", width: 1024, height: 1536 },
  { value: "1536x1024", label: "1536x1024 (大图横向)", width: 1536, height: 1024 },
  { value: "512x768", label: "512x768 (小图竖向)", width: 512, height: 768 },
  { value: "768x512", label: "768x512 (小图横向)", width: 768, height: 512 },
] as const;

export const NOVELAI_SAMPLER_OPTIONS = [
  { value: "k_euler", label: "Euler" },
  { value: "k_euler_ancestral", label: "Euler Ancestral" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim", label: "DDIM" },
] as const;

export const NOVELAI_NOISE_SCHEDULE_OPTIONS = [
  { value: "karras", label: "Karras" },
  { value: "native", label: "Native" },
  { value: "exponential", label: "Exponential" },
  { value: "polyexponential", label: "Polyexponential" },
] as const;

const resolutionValues = new Set<string>(NOVELAI_RESOLUTION_OPTIONS.map(option => option.value));
const samplerValues = new Set<string>(NOVELAI_SAMPLER_OPTIONS.map(option => option.value));
const noiseScheduleValues = new Set<string>(NOVELAI_NOISE_SCHEDULE_OPTIONS.map(option => option.value));

export function isValidNovelAiModel(value: string): boolean {
  return value.length <= 128 && /^[a-z0-9][a-z0-9._:-]*$/i.test(value);
}

export function normalizeNovelAiModel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return isValidNovelAiModel(normalized) ? normalized : NOVELAI_DEFAULT_MODEL;
}

export function isNovelAiResolution(value: string): boolean {
  return resolutionValues.has(value);
}

export function normalizeNovelAiResolution(value: unknown): string {
  return typeof value === "string" && isNovelAiResolution(value)
    ? value
    : NOVELAI_DEFAULT_RESOLUTION;
}

export function getNovelAiResolution(value: unknown): { value: string; width: number; height: number } {
  const normalized = normalizeNovelAiResolution(value);
  const option = NOVELAI_RESOLUTION_OPTIONS.find(item => item.value === normalized)
    ?? NOVELAI_RESOLUTION_OPTIONS[0];
  return { value: option.value, width: option.width, height: option.height };
}

export function isNovelAiSampler(value: string): boolean {
  return samplerValues.has(value);
}

export function normalizeNovelAiSampler(value: unknown): string {
  return typeof value === "string" && isNovelAiSampler(value)
    ? value
    : NOVELAI_DEFAULT_SAMPLER;
}

export function isNovelAiNoiseSchedule(value: string): boolean {
  return noiseScheduleValues.has(value);
}

export function normalizeNovelAiNoiseSchedule(value: unknown): string {
  return typeof value === "string" && isNovelAiNoiseSchedule(value)
    ? value
    : NOVELAI_DEFAULT_NOISE_SCHEDULE;
}

export function normalizeNovelAiSteps(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(50, Math.floor(value)))
    : NOVELAI_DEFAULT_STEPS;
}

export function normalizeNovelAiScale(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(30, Number(value.toFixed(1))))
    : NOVELAI_DEFAULT_SCALE;
}

// --- 请求参数组装（V3 / V4 两套结构分流）---
//
// NovelAI V4 起提示词不再是一根字符串：参数里必须同时带上 v4_prompt /
// v4_negative_prompt 两套 caption 结构（各自含 base_caption 与 char_captions），
// SMEA 也由 sm/sm_dyn 换成 autoSmea。只发旧结构时上游会对 V4 家族直接返回
// 500 Internal Server Error（V3 家族照常出图），所以这里按模型族分流。
// 客户端直连与服务端转发共用这一份，避免两条链路再次走偏。
const NOVELAI_V4_FAMILY_PATTERN = /diffusion-4(?:-|$)/;

/** 该模型是否属于 V4 / V4.5 家族（需要 v4_prompt 结构）。V3 家族与未知模型返回 false。 */
export function usesNovelAiV4PromptStructure(model: unknown): boolean {
  const normalized = typeof model === "string" ? model.trim().toLowerCase() : "";
  return NOVELAI_V4_FAMILY_PATTERN.test(normalized);
}

export type NovelAiParameterInput = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  scale?: number;
  sampler?: string;
  steps?: number;
  noiseSchedule?: string;
  qualityToggle?: boolean;
  smea?: boolean;
  smeaDyn?: boolean;
};

/** 组装 NovelAI /ai/generate-image 的 parameters 字段。 */
export function buildNovelAiParameters(input: NovelAiParameterInput): Record<string, unknown> {
  const negativePrompt = input.negativePrompt ?? "";
  const common: Record<string, unknown> = {
    width: input.width,
    height: input.height,
    scale: normalizeNovelAiScale(input.scale),
    sampler: normalizeNovelAiSampler(input.sampler),
    steps: normalizeNovelAiSteps(input.steps),
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: input.qualityToggle !== false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: false,
    cfg_rescale: 0,
    noise_schedule: normalizeNovelAiNoiseSchedule(input.noiseSchedule),
    negative_prompt: negativePrompt,
  };

  if (!usesNovelAiV4PromptStructure(input.model)) {
    return {
      ...common,
      sm: input.smea === true,
      sm_dyn: input.smeaDyn === true,
      uncond_scale: 1,
    };
  }

  return {
    ...common,
    params_version: 3,
    autoSmea: false,
    legacy_v3_extend: false,
    use_coords: false,
    image_format: "png",
    v4_prompt: {
      caption: { base_caption: input.prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: negativePrompt, char_captions: [] },
    },
  };
}
