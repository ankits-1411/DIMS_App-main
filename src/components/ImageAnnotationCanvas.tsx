import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
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
import { runOnJS, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Reserved vertical space for the chrome around the canvas. Deliberately erring
 * on the generous side: under-reserving would size the canvas taller than the
 * space available and clip the bottom of the photo.
 */
const TOOLBAR_HEIGHT = 60;
const NOTES_HEIGHT = 150;

/** Points closer together than this are dropped: fewer points means a shorter
 *  path to rebuild each frame and a visibly smoother line. */
const MIN_POINT_DISTANCE = 1.5;

type Tool = "pen" | "highlight" | "rect" | "circle";
type Point = { x: number; y: number };
type Stroke = { type: Tool; path: SkPath };

/**
 * Builds an SkPath from the raw touch points. Marked as a worklet so the exact
 * same geometry can be produced on the UI thread (for the live preview, every
 * frame) and on the JS thread (once, when the stroke is committed).
 *
 * Freehand strokes are smoothed with quadratic curves through the midpoint of
 * each pair of samples, which removes the polygonal look of raw `lineTo`
 * segments.
 */
const buildPath = (points: Point[], tool: Tool): SkPath => {
  "worklet";
  const path = Skia.Path.Make();
  if (points.length === 0) return path;

  const first = points[0];
  const last = points[points.length - 1];

  if (tool === "rect") {
    // Normalised with min/abs so dragging up or left still produces a
    // rectangle — negative width/height silently drew nothing before.
    path.addRect({
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      width: Math.abs(last.x - first.x),
      height: Math.abs(last.y - first.y),
    });
    return path;
  }

  if (tool === "circle") {
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    path.addCircle(first.x, first.y, Math.sqrt(dx * dx + dy * dy));
    return path;
  }

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

const strokeWidthFor = (tool: Tool) => (tool === "highlight" ? 12 : 3);
const colorFor = (tool: Tool) => (tool === "highlight" ? "yellow" : "red");

export default function ImageAnnotationCanvas({
  imageUri,
  initialNote,
  onSave,
  onCancel,
  onDelete,
}: {
  imageUri: string;
  initialNote?: string;
  onSave: (data: { fileUri: string; paths: any[]; notes: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [fileUri, setFileUri] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [notes, setNotes] = useState(initialNote || "");
  const [savingImage, setSavingImage] = useState(false);

  const canvasRef = useRef<React.ComponentRef<typeof Canvas>>(null);

  // Live gesture state lives entirely in shared values so that drawing never
  // triggers a React render. The previous implementation ran the gesture with
  // `runOnJS(true)` and called `setCurrentPath(path.copy())` on every touch
  // move, which meant a full re-render plus an O(n) path copy per event — the
  // cause of the lag, which got worse the longer the stroke became.
  const livePoints = useSharedValue<Point[]>([]);
  const activeTool = useSharedValue<Tool>("pen");
  const isDrawing = useSharedValue(false);
  const didCommit = useSharedValue(false);

  const selectTool = useCallback(
    (next: Tool) => {
      setTool(next);
      activeTool.value = next;
    },
    [activeTool]
  );

  // Convert a base64 data URI into a real file, which is what Skia can decode.
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

  /**
   * The canvas is sized to the photo's own aspect ratio, scaled to fit the space
   * left between the toolbar and the notes field. Previously it was a hard-coded
   * `width x 420` box with the image stretched to fill it, which distorted every
   * photo and left drawable canvas area outside the picture.
   *
   * Sizing the canvas to exactly the fitted photo also means the saved snapshot
   * is the photo and nothing else — no letterbox bars baked into the upload.
   */
  const canvasSize = useMemo(() => {
    const availableWidth = windowWidth;
    const availableHeight = Math.max(
      220,
      windowHeight -
        insets.top -
        insets.bottom -
        TOOLBAR_HEIGHT -
        NOTES_HEIGHT
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
  }, [image, insets.bottom, insets.top, windowHeight, windowWidth]);

  /** Commits a finished stroke to React state. Runs once per stroke, not per
   *  touch event. Kept dependency-free so the gesture can stay memoised. */
  const commitStroke = useCallback((points: Point[], strokeTool: Tool) => {
    if (points.length === 0) return;
    setStrokes((prev) => [...prev, { type: strokeTool, path: buildPath(points, strokeTool) }]);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Pan waits ~10px before activating by default, so the start of every
        // signature stroke was being swallowed and the pen felt unresponsive.
        .minDistance(0)
        .maxPointers(1)
        .averageTouches(true)
        .onBegin((e) => {
          "worklet";
          isDrawing.value = true;
          livePoints.value = [{ x: e.x, y: e.y }];
        })
        .onUpdate((e) => {
          "worklet";
          if (!isDrawing.value) return;
          // `modify` mutates in place and still notifies dependents, avoiding
          // a full array copy on every touch move.
          livePoints.modify((points) => {
            "worklet";
            const last = points[points.length - 1];
            if (
              last &&
              Math.abs(last.x - e.x) < MIN_POINT_DISTANCE &&
              Math.abs(last.y - e.y) < MIN_POINT_DISTANCE
            ) {
              return points;
            }
            points.push({ x: e.x, y: e.y });
            return points;
          });
        })
        .onEnd(() => {
          "worklet";
          if (!isDrawing.value) return;
          didCommit.value = true;
          runOnJS(commitStroke)(livePoints.value, activeTool.value);
        })
        .onFinalize(() => {
          "worklet";
          isDrawing.value = false;
          // On a committed stroke the live preview is cleared from the effect
          // below, once React has actually painted the committed stroke —
          // clearing it here would blank the stroke for a frame or two. A
          // cancelled gesture never commits, so it is discarded immediately.
          if (!didCommit.value) livePoints.value = [];
          didCommit.value = false;
        }),
    [activeTool, commitStroke, didCommit, isDrawing, livePoints]
  );

  // Hand off from the live (UI-thread) preview to the committed stroke without
  // a visible gap. Skipped mid-stroke so a fast next stroke is not wiped.
  useEffect(() => {
    if (!isDrawing.value) livePoints.value = [];
  }, [strokes, isDrawing, livePoints]);

  // Rebuilt on the UI thread each frame while drawing; empty the rest of the time.
  const livePath = useDerivedValue(() =>
    buildPath(livePoints.value, activeTool.value)
  );
  const liveStrokeWidth = useDerivedValue(() =>
    activeTool.value === "highlight" ? 12 : 3
  );
  const liveColor = useDerivedValue(() =>
    activeTool.value === "highlight" ? "yellow" : "red"
  );

  const handleUndo = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  const handleSaveImage = async () => {
    if (savingImage) return;

    setSavingImage(true);
    try {
      if (!canvasRef.current) {
        throw new Error("Canvas is not ready yet");
      }

      const snapshot = canvasRef.current.makeImageSnapshot();

      // Encode as JPEG, not PNG. A lossless full-canvas PNG snapshot runs to
      // several megabytes per photo, which is slow to upload and large enough
      // to be rejected outright by a default server body-size limit (nginx
      // caps request bodies at 1 MB out of the box). JPEG at quality 80 is
      // visually equivalent here and typically 10-20x smaller.
      const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, 80);

      const filePath = `${FileSystem.cacheDirectory}annotated_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(filePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Confirm the file landed before handing the path to the uploader —
      // a silently-missing file surfaces later as an opaque upload failure.
      const info = await FileSystem.getInfoAsync(filePath);
      if (!info.exists) {
        throw new Error("Annotated image could not be saved to disk");
      }

      console.log("Annotated image saved:", filePath, {
        strokes: strokes.length,
        bytes: info.size,
      });
      onSave({ fileUri: filePath, paths: strokes, notes });
    } catch (err) {
      console.log("SAVE ERROR:", err);
      setSavingImage(false);
    }
  };

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

  const toolButtons: { tool: Tool; icon: keyof typeof Ionicons.glyphMap }[] = [
    { tool: "pen", icon: "brush" },
    { tool: "rect", icon: "square-outline" },
    { tool: "circle", icon: "ellipse-outline" },
    { tool: "highlight", icon: "color-fill-outline" },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* The inset is applied as padding on the toolbar itself rather than via
          <SafeAreaView>, which reports no insets inside a Modal on iOS and let
          the tool icons slide under the status bar / notch. */}
      <View style={[styles.toolbar, { paddingTop: insets.top + 8 }]}>
        {toolButtons.map((item) => (
          <TouchableOpacity
            key={item.tool}
            onPress={() => selectTool(item.tool)}
            style={[styles.toolButton, tool === item.tool && styles.toolActive]}
            accessibilityLabel={item.tool}
          >
            <Ionicons
              name={item.icon}
              size={22}
              color={tool === item.tool ? "#111" : "#fff"}
            />
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          onPress={handleUndo}
          disabled={strokes.length === 0}
          style={[styles.toolButton, strokes.length === 0 && styles.disabled]}
          accessibilityLabel="Undo"
        >
          <Ionicons name="arrow-undo" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setStrokes([])}
          disabled={strokes.length === 0}
          style={[styles.toolButton, strokes.length === 0 && styles.disabled]}
          accessibilityLabel="Clear drawing"
        >
          <Ionicons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>

        {onDelete && (
          <TouchableOpacity
            onPress={onDelete}
            style={styles.toolButton}
            accessibilityLabel="Delete photo"
          >
            <Ionicons name="trash" size={22} color="red" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onCancel}
          style={styles.toolButton}
          accessibilityLabel="Cancel"
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSaveImage}
          disabled={savingImage}
          style={[styles.toolButton, savingImage && styles.disabled]}
          accessibilityLabel="Save"
        >
          {savingImage ? (
            <ActivityIndicator size="small" color="green" />
          ) : (
            <Ionicons name="checkmark" size={26} color="green" />
          )}
        </TouchableOpacity>
      </View>

      {/* Centred in the space between the toolbar and the notes field so the
          photo is never clipped and never stretched. */}
      <View style={styles.canvasArea}>
        <GestureDetector gesture={gesture}>
          <Canvas ref={canvasRef} style={canvasSize}>
            <SkiaImage
              image={image}
              x={0}
              y={0}
              width={canvasSize.width}
              height={canvasSize.height}
            />

            {strokes.map((item, i) => (
              <Path
                key={i}
                path={item.path}
                style="stroke"
                strokeWidth={strokeWidthFor(item.type)}
                strokeCap="round"
                strokeJoin="round"
                color={colorFor(item.type)}
              />
            ))}

            <Path
              path={livePath}
              style="stroke"
              strokeWidth={liveStrokeWidth}
              strokeCap="round"
              strokeJoin="round"
              color={liveColor}
            />
          </Canvas>
        </GestureDetector>
      </View>

      {/* Bottom inset keeps the field clear of the iOS home indicator and the
          Android gesture bar. */}
      <View style={[styles.notes, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={{ color: "#fff" }}>Image Notes</Text>
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
  toolbar: {
    flexDirection: "row",
    // space-between + horizontal padding keeps all nine controls on one row even
    // on a narrow Android device, where space-around overflowed.
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingBottom: 8,
    backgroundColor: "#111",
  },
  toolButton: {
    padding: 6,
    borderRadius: 8,
  },
  canvasArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  toolActive: {
    backgroundColor: "#fff",
  },
  disabled: {
    opacity: 0.4,
  },
  notes: { paddingHorizontal: 12, paddingTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#444",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    minHeight: 76,
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
