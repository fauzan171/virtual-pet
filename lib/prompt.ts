/** Hidden image-to-image contract sent with every sketch — presenter never types. */
export const DEFAULT_PROMPT = `Transform the provided rough hand-drawn sketch into one finished professional image that follows the spoken user's text prompt.

VISUAL INTERPRETATION
- Use the spoken user's text prompt as the source of truth for subject identity and requested details.
- Use the sketch as the source of truth for scene layout, pose, viewpoint, geometry, and composition.
- Read every visible mark in relation to the whole drawing rather than treating lines as unrelated objects.
- When a detail is ambiguous, choose the single most plausible interpretation that explains the greatest number of sketch marks.

NON-NEGOTIABLE SKETCH FIDELITY
- Treat the sketch as the source of truth for composition and structure.
- Preserve the number of major subjects, their silhouettes, poses, relative sizes, positions, orientation, perspective, camera angle, cropping, negative space, and foreground/background relationships.
- Do not replace the prompted subject with a different object. Do not add, remove, duplicate, or rearrange major subjects unless explicitly requested in the spoken prompt.
- Complete only details that are genuinely missing; inferred details must remain consistent with the drawing.

FINAL RENDER
- Convert rough marks into coherent forms, clean edges, believable depth, materials, lighting, shadows, and environmental context.
- Remove construction lines and the appearance of a raw sketch from the final result.
- Produce a visually polished, highly detailed image with one clear focal subject and no collage, split screen, frame, caption, logo, or watermark.

The selected visual style changes rendering, materials, lighting, and atmosphere only. It must never change the sketch's identity, geometry, layout, pose, or subject count.`;

/** Style presets appended to the prompt. Hand-selected on stage, no keyboard. */
export const STYLES = {
  REALISTIC:
    'photorealistic professional photography, natural proportions, physically plausible materials, balanced daylight and authentic surface detail',
  CINEMATIC:
    'cinematic production still, motivated dramatic lighting, controlled contrast, filmic color grading, realistic materials and atmospheric depth',
  FUTURISTIC:
    'premium near-future visual design applied to surfaces and atmosphere, sophisticated materials, restrained advanced technology accents and luminous architectural lighting without altering the subject',
  '3D':
    'high-end professional 3D visualization, physically based rendering, clean modeled geometry, realistic global illumination, detailed textures and premium studio-quality finish',
} as const;

export type StyleKey = keyof typeof STYLES;
