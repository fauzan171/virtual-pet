/** System-generated instruction sent with every sketch — presenter never types. */
export const DEFAULT_PROMPT = `Use the provided rough hand-drawn sketch as the primary visual and composition reference.

Interpret the object represented by the sketch intelligently.

Preserve the major composition, silhouette, relative object placement, perspective, proportions, and spatial relationships from the sketch.

Transform the rough drawing into a polished, highly detailed, visually coherent image.

Remove all rough sketch lines from the final result. Do not display the drawing itself. The output must look like a finished professional image rather than a sketch.

Maintain strong visual correspondence with the original drawing while intelligently completing missing visual details.

Create one coherent primary scene with professional composition, realistic lighting, detailed materials, depth, and high visual quality.`;

/** Style presets appended to the prompt. Hand-selected on stage, no keyboard. */
export const STYLES = {
  REALISTIC: 'photorealistic professional photography',
  CINEMATIC: 'cinematic lighting, dramatic composition and realistic materials',
  FUTURISTIC:
    'premium near-future visual design, sophisticated materials and advanced technology',
  '3D': 'high-end professional 3D visualization',
} as const;

export type StyleKey = keyof typeof STYLES;
