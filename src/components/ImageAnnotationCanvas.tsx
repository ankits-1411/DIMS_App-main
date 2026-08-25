import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  Group,
  ImageFormat,
  Path,
  Skia,
  Image as SkiaImage,
  SkPath,
  useImage,
} from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// `runOnJS` is deprecated in Reanimated 4; `scheduleOnRN` is its replacement.
import { scheduleOnRN } from "react-native-worklets";
import {
  Annotation,
  AnnotationTool,
  cloneAnnotation,
  DEFAULT_ANNOTATION_COLOR,
  HIGHLIGHT_STROKE_PX,
  isShapeTool,
  PALETTE,
  STROKE_PX,
} from "../types/annotations";

/** Reserved vertical space for the chrome around the canvas. */
const ACTION_BAR_HEIGHT = 56;
const TOOL_BAR_HEIGHT = 58;
const PALETTE_HEIGHT = 52;
const SELECTION_BAR_HEIGHT = 44;
const NOTES_HEIGHT = 148;

/** Points closer together than this are dropped while drawing freehand. */
const MIN_POINT_DISTANCE = 1.5;
/** Movement below this (in base canvas px) counts as a tap, not a drag. */
const TAP_SLOP = 6;
/** On-screen radius of the resize handle, and of its (larger) touch target. */
const HANDLE_RADIUS = 9;
const HANDLE_TOUCH_RADIUS = 26;
/** A new tapped shape is this fraction of the image width. */
const DEFAULT_SHAPE_SIZE = 0.16;
/** Shapes may not be resized below this fraction of the image width. */
const MIN_SHAPE_SIZE = 0.03;
const MAX_ZOOM = 5;

type Point = { x: number; y: number };
/** Geometry in base-canvas pixels: centre point plus size. */
type Geom = { x: number; y: number; w: number; h: number };
/** What the active one-finger gesture is doing. */
type DragMode = "none" | "draw" | "move" | "resize" | "create" | "pending";

const EMPTY_GEOM: Geom = { x: 0, y: 0, w: 0, h: 0 };

// ---------------------------------------------------------------------------
// Geometry helpers. All are worklets so the identical maths can run on the UI
// thread (live preview, every frame) and on the JS thread (once, on commit) —
// there is deliberately no second implementation to drift out of sync.
// ---------------------------------------------------------------------------

/** Freehand path, smoothed with quadratic curves through sample midpoints. */
const freehandPath = (points: Point[]): SkPath => {
  "worklet";
  const path = Skia.Path.Make();
  if (points.length === 0) return path;

  const first = points[0];
  const last = points[points.length - 1];

  path.moveTo(first.x, first.y);

  if (points.length === 1) {
    // A tap without movement should still leave a visible dot.
    path.lineTo(first.x + 0.1, first.y);
    return path;
  }

  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    path.quadTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2
    );
  }
  path.lineTo(last.x, last.y);

  return path;
};

/** Shape path from a centre point and size, in base-canvas pixels. */
const shapePath = (type: string, g: Geom): SkPath => {
  "worklet";
  const path = Skia.Path.Make();
  const w = Math.abs(g.w);
  const h = Math.abs(g.h);
  const left = g.x - w / 2;
  const top = g.y - h / 2;

  if (type === "circle") {
    // An oval rather than a strict circle so non-uniform resizing works.
    path.addOval({ x: left, y: top, width: w, height: h });
    return path;
  }

  if (type === "square") {
    path.addRect({ x: left, y: top, width: w, height: h });
    return path;
  }

  if (type === "triangle") {
    path.moveTo(g.x, top);
    path.lineTo(left + w, top + h);
    path.lineTo(left, top + h);
    path.close();
    return path;
  }

  return path;
};

const distance = (ax: number, ay: number, bx: number, by: number) => {
  "worklet";
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

const newAnnotationId = () =>
  `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Rounded to keep the serialised payload compact. */
const round = (value: number) => Math.round(value * 10000) / 10000;

export default function ImageAnnotationCanvas({
  imageUri,
  initialNote,
  initialAnnotations,
  onSave,
  onCancel,
  onDelete,
}: {
  imageUri: string;
  initialNote?: string;
  initialAnnotations?: Annotation[];
  onSave: (data: {
    fileUri: string;
    annotations: Annotation[];
    /** @deprecated kept for callers that still read `paths`. */
    paths: Annotation[];
    notes: string;
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [fileUri, setFileUri] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("draw");
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>(
    initialAnnotations ?? []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNote || "");
  const [savingImage, setSavingImage] = useState(false);

  const canvasRef = useRef<React.ComponentRef<typeof Canvas>>(null);
  const annotationsRef = useRef(annotations);
  const historyRef = useRef<{ past: Annotation[][]; future: Annotation[][] }>({
    past: [],
    future: [],
  });
  annotationsRef.current = annotations;

  const commitAnnotations = useCallback(
    (next: Annotation[] | ((current: Annotation[]) => Annotation[])) => {
      const previous = annotationsRef.current;
      const value = typeof next === "function" ? next(previous) : next;
      if (value === previous) return;

      historyRef.current.past = [
        ...historyRef.current.past.slice(-99),
        previous,
      ];
      historyRef.current.future = [];
      annotationsRef.current = value;
      setAnnotations(value);
    },
    []
  );

  // ----- Live interaction state -------------------------------------------
  // Everything that changes per touch event lives in shared values, so drawing,
  // moving, resizing, zooming and panning never trigger a React render. React
  // state is written exactly once per completed gesture.
  const livePoints = useSharedValue<Point[]>([]);
  const activeTool = useSharedValue<AnnotationTool>("draw");
  const activeColor = useSharedValue(DEFAULT_ANNOTATION_COLOR);
  const mode = useSharedValue<DragMode>("none");
  const startPoint = useSharedValue<Point>({ x: 0, y: 0 });
  const originGeom = useSharedValue<Geom>(EMPTY_GEOM);
  const previewGeom = useSharedValue<Geom>(EMPTY_GEOM);
  const didCommit = useSharedValue(false);

  /** Geometry of the selected shape while it is selected, in base-canvas px. */
  const selGeom = useSharedValue<Geom>(EMPTY_GEOM);
  /** Shape type of the selection, or "" when nothing manipulable is selected. */
  const selShape = useSharedValue("");
  const selColor = useSharedValue(DEFAULT_ANNOTATION_COLOR);
  const selStroke = useSharedValue(STROKE_PX);

  /** Image view transform: screen = base * scale + translate. */
  const viewScale = useSharedValue(1);
  const viewTx = useSharedValue(0);
  const viewTy = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  const canvasW = useSharedValue(1);
  const canvasH = useSharedValue(1);

  // Convert a base-canvas image URI into a real file for Skia to decode.
  useEffect(() => {
    let cancelled = false;

    const convert = async () => {
      try {
        if (!imageUri.startsWith("data:")) {
          if (!cancelled) setFileUri(imageUri);
          return;
        }

        const base64 = imageUri.split(",")[1];
        if (!base64) throw new Error("Malformed image data");

        const path = `${FileSystem.cacheDirectory}annot_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(path, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!cancelled) setFileUri(path);
      } catch (error) {
        console.log("Prepare annotation image error:", error);
        if (!cancelled) setPrepareError("This image could not be opened.");
      }
    };

    convert();
    return () => {
      cancelled = true;
    };
  }, [imageUri]);

  const image = useImage(fileUri);

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId]
  );

  /**
   * The canvas is sized to the photo's own aspect ratio, scaled to fit the space
   * between the bars. Because annotations are stored in normalised image
   * coordinates, changing this size (rotation, palette opening, a different
   * device) repositions nothing — the same fractions simply map onto a new box.
   */
  const canvasSize = useMemo(() => {
    const chrome =
      ACTION_BAR_HEIGHT +
      TOOL_BAR_HEIGHT +
      NOTES_HEIGHT +
      (paletteOpen ? PALETTE_HEIGHT : 0) +
      (selectedId ? SELECTION_BAR_HEIGHT : 0);

    const availableWidth = windowWidth;
    const availableHeight = Math.max(
      200,
      windowHeight - insets.top - insets.bottom - chrome
    );

    if (!image) {
      return { width: availableWidth, height: availableHeight };
    }

    const scale = Math.min(
      availableWidth / image.width(),
      availableHeight / image.height()
    );

    return {
      width: Math.round(image.width() * scale),
      height: Math.round(image.height() * scale),
    };
  }, [
    image,
    insets.bottom,
    insets.top,
    paletteOpen,
    selectedId,
    windowHeight,
    windowWidth,
  ]);

  useEffect(() => {
    canvasW.value = canvasSize.width;
    canvasH.value = canvasSize.height;
  }, [canvasSize, canvasW, canvasH]);

  // ----- Normalised <-> base-canvas conversion ----------------------------

  const toBaseGeom = useCallback(
    (a: Annotation): Geom => ({
      x: a.x * canvasSize.width,
      y: a.y * canvasSize.height,
      w: a.width * canvasSize.width,
      h: a.height * canvasSize.height,
    }),
    [canvasSize]
  );

  const toNormalisedGeom = useCallback(
    (g: Geom) => ({
      x: round(g.x / canvasSize.width),
      y: round(g.y / canvasSize.height),
      width: round(Math.abs(g.w) / canvasSize.width),
      height: round(Math.abs(g.h) / canvasSize.height),
    }),
    [canvasSize]
  );

  /** Keeps the shared values that render the selection in step with state. */
  useEffect(() => {
    if (!selectedAnnotation || !isShapeTool(selectedAnnotation.type)) {
      selShape.value = "";
      selGeom.value = EMPTY_GEOM;
      return;
    }
    selShape.value = selectedAnnotation.type;
    selGeom.value = toBaseGeom(selectedAnnotation);
    selColor.value = selectedAnnotation.color;
    selStroke.value = selectedAnnotation.strokeWidth * canvasSize.width;
  }, [
    canvasSize.width,
    selColor,
    selGeom,
    selShape,
    selStroke,
    selectedAnnotation,
    toBaseGeom,
  ]);

  const selectTool = useCallback(
    (next: AnnotationTool) => {
      setTool(next);
      activeTool.value = next;
      // Freehand and erase have no manipulable selection of their own; dropping
      // it here stops stale resize handles hanging around after a tool change.
      if (next === "draw" || next === "highlight" || next === "erase") {
        setSelectedId(null);
      }
    },
    [activeTool]
  );

  const applyColor = useCallback(
    (next: string) => {
      setColor(next);
      activeColor.value = next;

      // Only ever recolours an annotation the user explicitly selected.
      if (selectedId) {
        commitAnnotations((prev) =>
          prev.map((a) => (a.id === selectedId ? { ...a, color: next } : a))
        );
      }
    },
    [activeColor, commitAnnotations, selectedId]
  );

  // ----- Commit handlers (JS thread, once per gesture) --------------------

  const commitFreehand = useCallback(
    (points: Point[], strokeColor: string, strokePx: number, highlight: boolean) => {
      if (points.length === 0) return;

      let minX = points[0].x;
      let maxX = points[0].x;
      let minY = points[0].y;
      let maxY = points[0].y;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const annotation: Annotation = {
        id: newAnnotationId(),
        type: highlight ? "highlight" : "draw",
        color: strokeColor,
        strokeWidth: round(strokePx / canvasSize.width),
        x: round((minX + maxX) / 2 / canvasSize.width),
        y: round((minY + maxY) / 2 / canvasSize.height),
        width: round((maxX - minX) / canvasSize.width),
        height: round((maxY - minY) / canvasSize.height),
        rotation: 0,
        points: points.map((p) => ({
          x: round(p.x / canvasSize.width),
          y: round(p.y / canvasSize.height),
        })),
      };

      commitAnnotations((prev) => [...prev, annotation]);
    },
    [canvasSize, commitAnnotations]
  );

  const commitShape = useCallback(
    (geom: Geom, shape: string, shapeColor: string, select: boolean) => {
      const normalised = toNormalisedGeom(geom);

      const annotation: Annotation = {
        id: newAnnotationId(),
        type: shape as Annotation["type"],
        color: shapeColor,
        strokeWidth: round(STROKE_PX / canvasSize.width),
        rotation: 0,
        ...normalised,
        // Clamped up rather than rejected: a short drag should still produce a
        // usable shape the user can then resize, not silently nothing.
        width: Math.max(MIN_SHAPE_SIZE, normalised.width),
        height: Math.max(
          (MIN_SHAPE_SIZE * canvasSize.width) / canvasSize.height,
          normalised.height
        ),
      };

      commitAnnotations((prev) => [...prev, annotation]);
      if (select) setSelectedId(annotation.id);
    },
    [canvasSize.height, canvasSize.width, commitAnnotations, toNormalisedGeom]
  );

  const commitSelectedGeom = useCallback(
    (geom: Geom) => {
      commitAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedId ? { ...a, ...toNormalisedGeom(geom) } : a
        )
      );
    },
    [commitAnnotations, selectedId, toNormalisedGeom]
  );

  /**
   * Hit test in normalised space, topmost (most recently added) first, so
   * overlapping annotations resolve the way the user sees them stacked.
   */
  const hitTest = useCallback(
    (nx: number, ny: number): Annotation | null => {
      // Tolerance scales with zoom so the target stays a constant screen size.
      const padX = (14 / viewScale.value) / canvasSize.width;
      const padY = (14 / viewScale.value) / canvasSize.height;

      for (let i = annotations.length - 1; i >= 0; i--) {
        const a = annotations[i];

        if (a.points && a.points.length > 0) {
          // Separate x/y tolerances: normalised units are not the same size in
          // pixels on both axes unless the photo happens to be square.
          const reachX = Math.max(a.strokeWidth, padX);
          const reachY = Math.max(
            (a.strokeWidth * canvasSize.width) / canvasSize.height,
            padY
          );
          const hit = a.points.some(
            (p) => Math.abs(p.x - nx) <= reachX && Math.abs(p.y - ny) <= reachY
          );
          if (hit) return a;
          continue;
        }

        const halfW = a.width / 2 + padX;
        const halfH = a.height / 2 + padY;
        if (
          nx >= a.x - halfW &&
          nx <= a.x + halfW &&
          ny >= a.y - halfH &&
          ny <= a.y + halfH
        ) {
          return a;
        }
      }
      return null;
    },
    [annotations, canvasSize.height, canvasSize.width, viewScale]
  );

  const deleteAnnotation = useCallback((id: string) => {
    commitAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, [commitAnnotations]);

  const handleClone = useCallback(() => {
    if (!selectedId) return;
    const cloned = cloneAnnotation(annotations, selectedId);
    if (!cloned) return;
    commitAnnotations((prev) => [...prev, cloned]);
    setSelectedId(cloned.id);
  }, [annotations, commitAnnotations, selectedId]);

  /**
   * A tap that did not turn into a drag. Selects, places or erases depending on
   * the active tool.
   */
  const handleTap = useCallback(
    (baseX: number, baseY: number) => {
      const nx = baseX / canvasSize.width;
      const ny = baseY / canvasSize.height;
      const hit = hitTest(nx, ny);

      if (tool === "erase") {
        if (hit) deleteAnnotation(hit.id);
        else setSelectedId(null);
        return;
      }

      // Tapping an existing annotation always selects it, whatever the tool —
      // otherwise a shape tool could never reach an annotation underneath it.
      if (hit) {
        setSelectedId(hit.id);
        return;
      }

      if (isShapeTool(tool)) {
        // Tap-to-place: a small default shape, square on screen, auto-selected.
        const width = DEFAULT_SHAPE_SIZE;
        const height = (DEFAULT_SHAPE_SIZE * canvasSize.width) / canvasSize.height;
        commitShape(
          {
            x: baseX,
            y: baseY,
            w: width * canvasSize.width,
            h: height * canvasSize.height,
          },
          tool,
          color,
          true
        );
        return;
      }

      setSelectedId(null);
    },
    [
      canvasSize.height,
      canvasSize.width,
      color,
      commitShape,
      deleteAnnotation,
      hitTest,
      tool,
    ]
  );

  // ----- Gestures ---------------------------------------------------------

  /** One finger: draw, move, resize, place or select. */
  const drawGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .averageTouches(true)
        .onBegin((e) => {
          "worklet";
          // Screen -> base canvas coordinates, undoing the zoom/pan transform.
          const bx = (e.x - viewTx.value) / viewScale.value;
          const by = (e.y - viewTy.value) / viewScale.value;

          startPoint.value = { x: bx, y: by };
          didCommit.value = false;

          const t = activeTool.value;
          const g = selGeom.value;

          // A selected shape claims the touch first: its resize handle, then
          // its body. This is what lets move/resize coexist with drawing.
          if (selShape.value !== "") {
            const handleX = g.x + Math.abs(g.w) / 2;
            const handleY = g.y + Math.abs(g.h) / 2;
            if (
              distance(bx, by, handleX, handleY) <=
              HANDLE_TOUCH_RADIUS / viewScale.value
            ) {
              mode.value = "resize";
              originGeom.value = g;
              return;
            }

            if (
              Math.abs(bx - g.x) <= Math.abs(g.w) / 2 &&
              Math.abs(by - g.y) <= Math.abs(g.h) / 2
            ) {
              mode.value = "move";
              originGeom.value = g;
              return;
            }
          }

          if (t === "draw" || t === "highlight") {
            mode.value = "draw";
            livePoints.value = [{ x: bx, y: by }];
            return;
          }

          // Shape and erase tools resolve on release: a tap places/erases, a
          // drag draws the shape out to size.
          mode.value = "pending";
        })
        .onUpdate((e) => {
          "worklet";
          const bx = (e.x - viewTx.value) / viewScale.value;
          const by = (e.y - viewTy.value) / viewScale.value;
          const dx = bx - startPoint.value.x;
          const dy = by - startPoint.value.y;

          if (mode.value === "draw") {
            livePoints.modify((points) => {
              "worklet";
              const last = points[points.length - 1];
              if (
                last &&
                Math.abs(last.x - bx) < MIN_POINT_DISTANCE &&
                Math.abs(last.y - by) < MIN_POINT_DISTANCE
              ) {
                return points;
              }
              points.push({ x: bx, y: by });
              return points;
            });
            return;
          }

          if (mode.value === "move") {
            const o = originGeom.value;
            selGeom.value = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
            return;
          }

          if (mode.value === "resize") {
            const o = originGeom.value;
            const minW = MIN_SHAPE_SIZE * canvasW.value;
            const minH = MIN_SHAPE_SIZE * canvasW.value;
            // Resizes about the centre, so the shape does not creep as it grows.
            selGeom.value = {
              x: o.x,
              y: o.y,
              w: Math.max(minW, Math.abs(o.w) + dx * 2),
              h: Math.max(minH, Math.abs(o.h) + dy * 2),
            };
            return;
          }

          if (
            (mode.value === "pending" || mode.value === "create") &&
            activeTool.value !== "erase" &&
            distance(bx, by, startPoint.value.x, startPoint.value.y) > TAP_SLOP
          ) {
            mode.value = "create";
            previewGeom.value = {
              x: (startPoint.value.x + bx) / 2,
              y: (startPoint.value.y + by) / 2,
              w: Math.abs(dx),
              h: Math.abs(dy),
            };
          }
        })
        .onEnd((_e, success) => {
          "worklet";
          // `success` is false when the gesture was cancelled — most commonly
          // because a second finger landed to start a pinch. Committing then
          // would leave a stray dot or a half-dragged shape behind.
          if (!success) return;

          const t = activeTool.value;
          didCommit.value = true;

          if (mode.value === "draw") {
            scheduleOnRN(
              commitFreehand,
              livePoints.value,
              activeColor.value,
              t === "highlight" ? HIGHLIGHT_STROKE_PX : STROKE_PX,
              t === "highlight"
            );
            return;
          }

          if (mode.value === "move" || mode.value === "resize") {
            scheduleOnRN(commitSelectedGeom, selGeom.value);
            return;
          }

          if (mode.value === "create") {
            scheduleOnRN(
              commitShape,
              previewGeom.value,
              t,
              activeColor.value,
              true
            );
            return;
          }

          if (mode.value === "pending") {
            scheduleOnRN(handleTap, startPoint.value.x, startPoint.value.y);
          }
        })
        .onFinalize(() => {
          "worklet";
          if (!didCommit.value) livePoints.value = [];
          mode.value = "none";
          previewGeom.value = EMPTY_GEOM;
          didCommit.value = false;
        }),
    [
      activeColor,
      activeTool,
      canvasW,
      commitFreehand,
      commitSelectedGeom,
      commitShape,
      didCommit,
      handleTap,
      livePoints,
      mode,
      originGeom,
      previewGeom,
      selGeom,
      selShape,
      startPoint,
      viewScale,
      viewTx,
      viewTy,
    ]
  );

  /** Keeps the zoomed image from being dragged off screen. */
  const clampTranslation = useCallback(() => {
    "worklet";
    const maxX = 0;
    const minX = canvasW.value * (1 - viewScale.value);
    const maxY = 0;
    const minY = canvasH.value * (1 - viewScale.value);
    viewTx.value = Math.min(maxX, Math.max(minX, viewTx.value));
    viewTy.value = Math.min(maxY, Math.max(minY, viewTy.value));
  }, [canvasH, canvasW, viewScale, viewTx, viewTy]);

  /** Two fingers: pinch to zoom the image about the focal point. */
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          "worklet";
          pinchStartScale.value = viewScale.value;
        })
        .onUpdate((e) => {
          "worklet";
          const next = Math.min(
            MAX_ZOOM,
            Math.max(1, pinchStartScale.value * e.scale)
          );
          // Hold the point under the fingers still while scaling.
          const ratio = next / viewScale.value;
          viewTx.value = e.focalX - (e.focalX - viewTx.value) * ratio;
          viewTy.value = e.focalY - (e.focalY - viewTy.value) * ratio;
          viewScale.value = next;
          clampTranslation();
        })
        .onEnd(() => {
          "worklet";
          if (viewScale.value <= 1.01) {
            viewScale.value = 1;
            viewTx.value = 0;
            viewTy.value = 0;
          }
        }),
    [clampTranslation, pinchStartScale, viewScale, viewTx, viewTy]
  );

  /** Two fingers: pan the zoomed image. Never competes with one-finger drawing. */
  const viewPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(2)
        .onChange((e) => {
          "worklet";
          viewTx.value += e.changeX;
          viewTy.value += e.changeY;
          clampTranslation();
        }),
    [clampTranslation, viewTx, viewTy]
  );

  const gesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Simultaneous(pinchGesture, viewPanGesture),
        drawGesture
      ),
    [drawGesture, pinchGesture, viewPanGesture]
  );

  // ----- Derived (UI-thread) render values --------------------------------

  const viewTransform = useDerivedValue(() => [
    { translateX: viewTx.value },
    { translateY: viewTy.value },
    { scale: viewScale.value },
  ]);

  /** The in-progress freehand stroke or shape preview. */
  const livePath = useDerivedValue(() => {
    if (mode.value === "draw") return freehandPath(livePoints.value);
    if (mode.value === "create") {
      return shapePath(activeTool.value, previewGeom.value);
    }
    return Skia.Path.Make();
  });

  const liveStrokeWidth = useDerivedValue(() =>
    activeTool.value === "highlight" ? HIGHLIGHT_STROKE_PX : STROKE_PX
  );
  const liveOpacity = useDerivedValue(() =>
    activeTool.value === "highlight" && mode.value === "draw" ? 0.45 : 1
  );

  /** The selected shape, driven by shared values so dragging never re-renders. */
  const selectedPath = useDerivedValue(() =>
    selShape.value === ""
      ? Skia.Path.Make()
      : shapePath(selShape.value, selGeom.value)
  );

  /** Dashed bounding box around the selected shape. */
  const selectionBoxPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (selShape.value === "") return path;
    const g = selGeom.value;
    const pad = 6 / viewScale.value;
    path.addRect({
      x: g.x - Math.abs(g.w) / 2 - pad,
      y: g.y - Math.abs(g.h) / 2 - pad,
      width: Math.abs(g.w) + pad * 2,
      height: Math.abs(g.h) + pad * 2,
    });
    return path;
  });

  /** Resize handle, kept a constant on-screen size regardless of zoom. */
  const handlePath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (selShape.value === "") return path;
    const g = selGeom.value;
    path.addCircle(
      g.x + Math.abs(g.w) / 2,
      g.y + Math.abs(g.h) / 2,
      HANDLE_RADIUS / viewScale.value
    );
    return path;
  });

  const selectionStrokeWidth = useDerivedValue(() => 1.5 / viewScale.value);

  /**
   * Freehand strokes are selectable (to recolour or delete) but not movable or
   * resizable, so their selection outline is static and can come from state.
   */
  const freehandSelectionBox = useMemo(() => {
    if (!selectedAnnotation || isShapeTool(selectedAnnotation.type)) return null;

    const path = Skia.Path.Make();
    const width = Math.max(selectedAnnotation.width * canvasSize.width, 10);
    const height = Math.max(selectedAnnotation.height * canvasSize.height, 10);
    path.addRect({
      x: selectedAnnotation.x * canvasSize.width - width / 2 - 6,
      y: selectedAnnotation.y * canvasSize.height - height / 2 - 6,
      width: width + 12,
      height: height + 12,
    });
    return path;
  }, [canvasSize.height, canvasSize.width, selectedAnnotation]);

  // Hand off from the live preview to the committed annotation without a gap.
  useEffect(() => {
    if (mode.value === "none") livePoints.value = [];
  }, [annotations, livePoints, mode]);

  /**
   * Committed annotations, converted from normalised coordinates into
   * base-canvas paths. Rebuilt only when the annotation list or the canvas size
   * changes — never while drawing.
   */
  /**
   * The selected shape is drawn from shared values instead of from state, so
   * that dragging and resizing it needs no React render. It is therefore
   * excluded here to avoid drawing it twice.
   */
  const liveSelectedId =
    selectedAnnotation && isShapeTool(selectedAnnotation.type)
      ? selectedAnnotation.id
      : null;

  const renderedAnnotations = useMemo(
    () =>
      annotations
        .filter((a) => a.id !== liveSelectedId)
        .map((a) => {
        const geom: Geom = {
          x: a.x * canvasSize.width,
          y: a.y * canvasSize.height,
          w: a.width * canvasSize.width,
          h: a.height * canvasSize.height,
        };

        return {
          id: a.id,
          type: a.type,
          color: a.color,
          strokeWidth: Math.max(1, a.strokeWidth * canvasSize.width),
          opacity: a.type === "highlight" ? 0.45 : 1,
          path: a.points
            ? freehandPath(
                a.points.map((p) => ({
                  x: p.x * canvasSize.width,
                  y: p.y * canvasSize.height,
                }))
              )
            : shapePath(a.type, geom),
        };
      }),
    [annotations, canvasSize.height, canvasSize.width, liveSelectedId]
  );

  // ----- Actions ----------------------------------------------------------

  const applyHistory = (direction: "undo" | "redo") => {
    const from = direction === "undo" ? "past" : "future";
    const to = direction === "undo" ? "future" : "past";
    const stack = historyRef.current[from];
    if (stack.length === 0) return;

    const value = direction === "undo" ? stack[stack.length - 1] : stack[0];
    historyRef.current[from] =
      direction === "undo" ? stack.slice(0, -1) : stack.slice(1);
    historyRef.current[to] =
      direction === "undo"
        ? [...historyRef.current[to], annotationsRef.current]
        : [annotationsRef.current, ...historyRef.current[to]];
    annotationsRef.current = value;
    setAnnotations(value);
    setSelectedId((current) => (value.some((a) => a.id === current) ? current : null));
  };

  const handleUndo = () => applyHistory("undo");
  const handleRedo = () => applyHistory("redo");

  const handleClearAll = () => {
    if (annotations.length === 0) return;
    commitAnnotations([]);
    setSelectedId(null);
  };

  const handleSaveImage = async () => {
    if (savingImage) return;

    setSavingImage(true);
    try {
      if (!canvasRef.current) {
        throw new Error("Canvas is not ready yet");
      }

      // Reset zoom and drop the selection first: the snapshot captures exactly
      // what is on the canvas, so a zoomed view or a visible selection box and
      // resize handle would otherwise be baked into the saved photo.
      setSelectedId(null);
      viewScale.value = 1;
      viewTx.value = 0;
      viewTy.value = 0;

      // Two frames: one for React to commit the cleared selection, one for
      // Skia to paint it.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const snapshot = canvasRef.current.makeImageSnapshot();

      // JPEG, not PNG: a lossless full-canvas snapshot runs to several MB per
      // photo, large enough to be refused by a default server body-size limit.
      const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, 80);

      const filePath = `${FileSystem.cacheDirectory}annotated_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(filePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const info = await FileSystem.getInfoAsync(filePath);
      if (!info.exists) {
        throw new Error("Annotated image could not be saved to disk");
      }

      console.log("Annotated image saved:", filePath, {
        annotations: annotations.length,
        bytes: info.size,
      });

      onSave({
        fileUri: filePath,
        annotations,
        paths: annotations,
        notes,
      });
    } catch (err) {
      console.log("SAVE ERROR:", err);
      setSavingImage(false);
    }
  };

  // ----- Render -----------------------------------------------------------

  if (prepareError) {
    return (
      <View style={styles.loader}>
        <Text style={styles.loaderText}>{prepareError}</Text>
        <TouchableOpacity onPress={onCancel} style={styles.errorButton}>
          <Text style={styles.loaderText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!image || !fileUri) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loaderText}>Preparing image...</Text>
      </View>
    );
  }

  const tools: {
    tool: AnnotationTool;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
  }[] = [
    { tool: "draw", icon: "brush", label: "Draw" },
    { tool: "highlight", icon: "color-fill-outline", label: "Highlight" },
    { tool: "circle", icon: "ellipse-outline", label: "Circle" },
    { tool: "square", icon: "square-outline", label: "Square" },
    { tool: "triangle", icon: "triangle-outline", label: "Triangle" },
    { tool: "erase", icon: "backspace-outline", label: "Erase" },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Action bar. The safe-area inset is applied here as padding because
          <SafeAreaView> reports no insets inside a Modal on iOS. */}
      <View style={[styles.actionBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.actionButton}
          accessibilityLabel="Cancel"
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <View style={styles.actionGroup}>
          <TouchableOpacity
            onPress={handleUndo}
            disabled={historyRef.current.past.length === 0}
            style={[
              styles.actionButton,
              historyRef.current.past.length === 0 && styles.disabled,
            ]}
            accessibilityLabel="Undo"
          >
            <Ionicons name="arrow-undo" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRedo}
            disabled={historyRef.current.future.length === 0}
            style={[
              styles.actionButton,
              historyRef.current.future.length === 0 && styles.disabled,
            ]}
            accessibilityLabel="Redo"
          >
            <Ionicons name="arrow-redo" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleClearAll}
            disabled={annotations.length === 0}
            style={[
              styles.actionButton,
              annotations.length === 0 && styles.disabled,
            ]}
            accessibilityLabel="Clear all annotations"
          >
            <Ionicons name="refresh" size={22} color="#fff" />
          </TouchableOpacity>

          {onDelete && (
            <TouchableOpacity
              onPress={onDelete}
              style={styles.actionButton}
              accessibilityLabel="Delete photo"
            >
              <Ionicons name="trash" size={22} color="#f87171" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={handleSaveImage}
          disabled={savingImage}
          style={[styles.actionButton, savingImage && styles.disabled]}
          accessibilityLabel="Save"
        >
          {savingImage ? (
            <ActivityIndicator size="small" color="#4ade80" />
          ) : (
            <Ionicons name="checkmark" size={28} color="#4ade80" />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.canvasArea}>
        <GestureDetector gesture={gesture}>
          <Canvas ref={canvasRef} style={canvasSize}>
            {/* Everything is inside the same transform, so annotations stay
                anchored to the image through zoom and pan. */}
            <Group transform={viewTransform}>
              <SkiaImage
                image={image}
                x={0}
                y={0}
                width={canvasSize.width}
                height={canvasSize.height}
              />

              {renderedAnnotations.map((a) => (
                <Path
                  key={a.id}
                  path={a.path}
                  style="stroke"
                  strokeWidth={a.strokeWidth}
                  strokeCap="round"
                  strokeJoin="round"
                  color={a.color}
                  opacity={a.opacity}
                />
              ))}

              <Path
                path={selectedPath}
                style="stroke"
                strokeWidth={selStroke}
                strokeCap="round"
                strokeJoin="round"
                color={selColor}
              />

              <Path
                path={livePath}
                style="stroke"
                strokeWidth={liveStrokeWidth}
                strokeCap="round"
                strokeJoin="round"
                color={activeColor}
                opacity={liveOpacity}
              />

              <Path
                path={selectionBoxPath}
                style="stroke"
                strokeWidth={selectionStrokeWidth}
                color="#38bdf8"
              />
              <Path path={handlePath} color="#38bdf8" />

              {freehandSelectionBox && (
                <Path
                  path={freehandSelectionBox}
                  style="stroke"
                  strokeWidth={selectionStrokeWidth}
                  color="#38bdf8"
                />
              )}
            </Group>
          </Canvas>
        </GestureDetector>
      </View>

      {selectedAnnotation && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>
            {selectedAnnotation.type === "draw"
              ? "Freehand"
              : selectedAnnotation.type === "highlight"
              ? "Highlight"
              : selectedAnnotation.type.charAt(0).toUpperCase() +
                selectedAnnotation.type.slice(1)}{" "}
            selected
          </Text>

          <View style={styles.actionGroup}>
            <TouchableOpacity
              onPress={() => setSelectedId(null)}
              style={styles.selectionButton}
              accessibilityLabel="Deselect"
            >
              <Text style={styles.selectionButtonText}>Deselect</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleClone}
              style={styles.selectionButton}
              accessibilityLabel="Clone selected annotation"
            >
              <Ionicons name="copy-outline" size={16} color="#fff" />
              <Text style={styles.selectionButtonText}>Clone</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => deleteAnnotation(selectedAnnotation.id)}
              style={[styles.selectionButton, styles.selectionDelete]}
              accessibilityLabel="Delete selected annotation"
            >
              <Ionicons name="trash" size={16} color="#fff" />
              <Text style={styles.selectionButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {paletteOpen && (
        <View style={styles.palette}>
          {PALETTE.map((swatch) => (
            <TouchableOpacity
              key={swatch}
              onPress={() => applyColor(swatch)}
              style={[
                styles.swatch,
                { backgroundColor: swatch },
                color === swatch && styles.swatchActive,
              ]}
              accessibilityLabel={`Colour ${swatch}`}
            />
          ))}
        </View>
      )}

      <View style={styles.toolBar}>
        {tools.map((item) => {
          const active = tool === item.tool;
          return (
            <TouchableOpacity
              key={item.tool}
              onPress={() => selectTool(item.tool)}
              style={[styles.toolButton, active && styles.toolButtonActive]}
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={active ? "#0b1220" : "#e5e7eb"}
              />
              <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          onPress={() => setPaletteOpen((open) => !open)}
          style={[styles.toolButton, paletteOpen && styles.toolButtonActive]}
          accessibilityLabel="Colour"
        >
          <View style={[styles.colorPreview, { backgroundColor: color }]} />
          <Text
            style={[styles.toolLabel, paletteOpen && styles.toolLabelActive]}
          >
            Color
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom inset keeps the field clear of the iOS home indicator and the
          Android gesture bar. */}
      <View style={[styles.notes, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.notesLabel}>Image Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          style={styles.input}
          placeholder="Notes for this photo..."
          placeholderTextColor="#666"
          multiline
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 8,
    backgroundColor: "#111",
  },
  actionGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
  canvasArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#0b1220",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  selectionText: { color: "#93c5fd", fontSize: 13, fontWeight: "600" },
  selectionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1e293b",
  },
  selectionDelete: { backgroundColor: "#b91c1c" },
  selectionButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  palette: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#0b1220",
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: {
    borderColor: "#fff",
    transform: [{ scale: 1.15 }],
  },
  toolBar: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 6,
    backgroundColor: "#111",
  },
  toolButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 6,
    marginHorizontal: 2,
    borderRadius: 10,
    // A generous touch target even though the buttons are visually compact.
    minHeight: 44,
  },
  toolButtonActive: {
    backgroundColor: "#f8fafc",
  },
  toolLabel: { color: "#9ca3af", fontSize: 9, fontWeight: "600" },
  toolLabelActive: { color: "#0b1220" },
  colorPreview: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
  },
  notes: { paddingHorizontal: 12, paddingTop: 10 },
  notesLabel: { color: "#fff", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "#444",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    minHeight: 70,
    textAlignVertical: "top",
  },
  loader: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loaderText: { color: "#fff" },
  errorButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#444",
  },
});
