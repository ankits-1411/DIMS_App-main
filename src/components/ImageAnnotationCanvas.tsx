import { useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  Path,
  Skia,
  Image as SkiaImage,
  useImage,
  Text as SkiaText,
  useFont,
  SkPath,
} from "@shopify/react-native-skia";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const { width } = Dimensions.get("window");
const HEIGHT = 420;

export default function ImageAnnotationCanvas({ imageUri, initialNote, onSave, onCancel }: { imageUri: string; initialNote?: string; onSave: (data: { fileUri: string; paths: any[]; notes: string }) => void; onCancel: () => void }) {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [tool, setTool] = useState("pen");
  const [paths, setPaths] = useState<{ type: string; path: SkPath }[]>([]);
  const [currentPath, setCurrentPath] = useState<SkPath | null>(null);
  const [history, setHistory] = useState<{ type: string; path: SkPath }[][]>([]);
  const [notes, setNotes] = useState(initialNote || "");
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [texts, setTexts] = useState<{ x: number; y: number; text: string }[]>([]);

  const font = null;
  const canvasRef = useRef<React.ComponentRef<typeof Canvas>>(null);

  // convert base64 image
  useEffect(() => {
    const convert = async () => {
      if (!imageUri.startsWith("data:")) {
        setFileUri(imageUri);
        return;
      }
      const base64 = imageUri.split(",")[1];
      const path = FileSystem.cacheDirectory + `annot_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setFileUri(path);
    };
    convert();
  }, [imageUri]);

  const image = useImage(fileUri);

  // Gesture handler
  const panGesture = Gesture.Pan().runOnJS(true)
    .onBegin((e) => {
        console.log("TOUCH START GESTURE WORKING");
      setStartPoint({ x: e.x, y: e.y });

      if (tool === "pen" || tool === "highlight") {
        const p = Skia.Path.Make();
        p.moveTo(e.x, e.y);
        setCurrentPath(p);
      }

      if (tool === "text") {
        setTexts((prev) => [
          ...prev,
          { x: e.x, y: e.y, text: "Tap to edit" },
        ]);
      }
    })
    .onUpdate((e) => {
      if ((tool === "pen" || tool === "highlight") && currentPath) {
        currentPath.lineTo(e.x, e.y);
        setCurrentPath(currentPath.copy());
      }
    })
    .onEnd((e) => {
      if ((tool === "pen" || tool === "highlight") && currentPath) {
        setHistory((prev) => [...prev, paths]);
        setPaths((prev) => [...prev, { type: tool, path: currentPath }]);
        setCurrentPath(null);
      }

      if (tool === "rect" && startPoint) {
        const rect = Skia.Path.Make();
        rect.addRect({
          x: startPoint.x,
          y: startPoint.y,
          width: e.x - startPoint.x,
          height: e.y - startPoint.y,
        });
        setPaths((prev) => [...prev, { type: "rect", path: rect }]);
      }

      if (tool === "circle" && startPoint) {
        const r = Math.sqrt(
          Math.pow(e.x - startPoint.x, 2) +
          Math.pow(e.y - startPoint.y, 2)
        );
        const circle = Skia.Path.Make();
        circle.addCircle(startPoint.x, startPoint.y, r);
        setPaths((prev) => [...prev, { type: "circle", path: circle }]);
      }

      setStartPoint(null);
    });

    const handleUndo = () => {
        setPaths((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated.pop();
            return updated;
        });
    };

    const handleSaveImage = async () => {
  if (!canvasRef.current) return;

  const snapshot = canvasRef.current.makeImageSnapshot();
  const pngBase64 = snapshot.encodeToBase64();

  const filePath =
    FileSystem.cacheDirectory + `annotated_${Date.now()}.png`;

  await FileSystem.writeAsStringAsync(filePath, pngBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  onSave({
    fileUri: filePath,
    paths,
    notes,
  });
};

  if (!image || !fileUri) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={{ color: "#fff" }}>Preparing image...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => setTool("pen")}>
          <Ionicons name="brush" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setTool("rect")}>
          <Ionicons name="square-outline" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setTool("circle")}>
          <Ionicons name="ellipse-outline" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setTool("highlight")}>
          <Ionicons name="color-fill-outline" size={22} color="#fff" />
        </TouchableOpacity>

        {/* <TouchableOpacity onPress={() => setTool("text")}>
          <Ionicons name="text" size={22} color="#fff" />
        </TouchableOpacity> */}

              <TouchableOpacity onPress={handleUndo}>
                  <Ionicons name="arrow-undo" size={22} color="#fff" />
              </TouchableOpacity>

        <TouchableOpacity onPress={() => setPaths([])}>
          <Ionicons name="trash" size={22} color="red" />
        </TouchableOpacity>

        <TouchableOpacity onPress={onCancel}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSaveImage}>
          <Ionicons name="checkmark" size={26} color="green" />
        </TouchableOpacity>
      </View>

      {/* Canvas */}
      <GestureDetector gesture={panGesture}>
        <Canvas ref={canvasRef} style={{ width, height: HEIGHT }}>
          <SkiaImage image={image} x={0} y={0} width={width} height={HEIGHT} />

          {paths.map((item, i) => (
            <Path
              key={i}
              path={item.path}
              style="stroke"
              strokeWidth={item.type === "highlight" ? 12 : 3}
              color={item.type === "highlight" ? "yellow" : "red"}
            />
          ))}

          {currentPath && (
            <Path path={currentPath} style="stroke" strokeWidth={3} color="red" />
          )}

                  {font &&
                      texts.map((t, i) => (
                          <SkiaText
                              key={i}
                              x={t.x}
                              y={t.y}
                              text={t.text}
                              font={font}
                              color="white"
                          />
                      ))}
        </Canvas>
      </GestureDetector>

      {/* Notes */}
      <View style={styles.notes}>
        <Text style={{ color: "#fff" }}>Image Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          style={styles.input}
          multiline
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  toolbar: {
  flexDirection: "row",
  justifyContent: "space-around",
  paddingVertical: 12,
  backgroundColor: "#111",
},
  notes: { padding: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#444",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
  },
  loader: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
});