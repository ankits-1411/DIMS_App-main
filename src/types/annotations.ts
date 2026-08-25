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

const deepClone = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(deepClone) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    ) as T;
  }
  return value;
};

const annotationBounds = (annotation: Annotation) => ({
  left: annotation.x - Math.abs(annotation.width) / 2,
  top: annotation.y - Math.abs(annotation.height) / 2,
  right: annotation.x + Math.abs(annotation.width) / 2,
  bottom: annotation.y + Math.abs(annotation.height) / 2,
});

/** Deep-copies and offsets one annotation without changing the source list. */
export const cloneAnnotation = (
  annotations: Annotation[],
  annotationId: string,
  offsetX = 0.02,
  offsetY = 0.02
): Annotation | null => {
  const source = annotations.find((annotation) => annotation.id === annotationId);
  if (!source) return null;

  const clone = deepClone(source);
  do {
    clone.id = newAnnotationId();
  } while (annotations.some((annotation) => annotation.id === clone.id));
  const bounds = annotationBounds(clone);
  const dx = Math.max(-bounds.left, Math.min(offsetX, 1 - bounds.right));
  const dy = Math.max(-bounds.top, Math.min(offsetY, 1 - bounds.bottom));
  clone.x += dx;
  clone.y += dy;
  if (clone.points) {
    clone.points = clone.points.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    }));
  }
  return clone;
};

/** Base stroke widths in canvas pixels, converted to normalised on commit. */
export const STROKE_PX = 3;
export const HIGHLIGHT_STROKE_PX = 16;

const SHAPES: AnnotationShape[] = ["circle", "square", "triangle"];

export const isShapeTool = (value: string): value is AnnotationShape =>
  (SHAPES as string[]).includes(value);
