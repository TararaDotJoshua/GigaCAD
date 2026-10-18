/** The preview camera's vertical field of view, in degrees. */
export const FIELD_OF_VIEW = 35;

/** Room around the model, so its corners don't touch the stage's edges. */
export const FIT_PADDING = 1.2;

/**
 * How far from its centre the camera sits to show a model of this bounding radius whole, at this
 * aspect ratio. Narrow (portrait) stages fit to the horizontal field of view, which is then the tighter one.
 */
export function fitDistance(radius: number, aspect: number, fov = FIELD_OF_VIEW, padding = FIT_PADDING): number {
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * (aspect > 0 && Number.isFinite(aspect) ? aspect : 1));
  return (padding * radius) / Math.sin(Math.min(vertical, horizontal));
}
