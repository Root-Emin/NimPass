/**
 * The one frame a pass photograph is shown in.
 *
 * Beside `pass-cover-art.tsx` but in its own module so that file exports only
 * components and Fast Refresh keeps working — the same split `button-variants`
 * and `dialog-panel` use.
 *
 * Every surface that shows a pass cover — Discover, My Store, My Passes, the
 * public pass, the creation preview, the confirmation dialog — uses this ratio.
 * A second shape would crop the same upload differently, which is exactly what
 * made a cover look like one picture while composing it and another after it
 * was saved. The box scales with the card's width, so a phone and a desktop
 * show the same crop, not two.
 */
export const PASS_COVER_RATIO_CLASS = 'aspect-[16/10]'
