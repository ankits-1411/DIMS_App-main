/**
 * Annotation data model.
 *
 * Every coordinate is stored **normalised to the image**: `0..1` fractions of
 * the photo's width and height, never screen or canvas pixels. That is what
 * keeps annotations anchored when the image is zoomed or panned, when the canvas
 * is resized (palette opening, a different device), or when the device rotates —
 * the same fractions simply map onto whatever box the canvas currently is.
 */

export type AnnotationTool =
  | "draw"
  | "highlight"
  | "circle"
  | "square"
  | "triangle"
  | "erase";

export type AnnotationShape = "circle" | "square" | "triangle";

export type AnnotationType = "draw" | "highlight" | AnnotationShape;

export type Annotation = {
  id: string;
  type: AnnotationType;
  color: string;
  /** Stroke width as a fraction of image width, so it scales with the image. */
  strokeWidth: number;
  /** Centre point, normalised. For freehand this is the centre of its bounds. */
  x: number;
  y: number;
  /** Size, normalised. For freehand this is the size of its bounds. */
  width: number;
  height: number;
  /** Degrees. Reserved — no tool currently rotates annotations. */
  rotation: number;
  /** Freehand only: the sampled points, normalised. */
  points?: { x: number; y: number }[];
};

export const PALETTE = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
  "#000000",
];

export const DEFAULT_ANNOTATION_COLOR = PALETTE[0];

/** Base stroke widths in canvas pixels, converted to normalised on commit. */
export const STROKE_PX = 3;
export const HIGHLIGHT_STROKE_PX = 16;

const SHAPES: AnnotationShape[] = ["circle", "square", "triangle"];

export const isShapeTool = (value: string): value is AnnotationShape =>
  (SHAPES as string[]).includes(value);
