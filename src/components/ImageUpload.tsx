import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  Dimensions,
  TextInput,
  SafeAreaView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ImageAnnotationCanvas from "./ImageAnnotationCanvas";
import { inspectionsAPI } from "../services/api";
import { useTheme } from "../context/ThemeContext";

const { width } = Dimensions.get("window");

interface Props {
  inspectionId: string;
  onComplete: () => void;
}

export default function ImageUploadComponent({
  inspectionId,
  onComplete,
}: Props) {

  const [images, setImages] = useState<
    { uri: string; note: string }[]
  >([]);

  const { theme } = useTheme();
  const [generalNotes, setGeneralNotes] = useState("");
  const [gpsLocation, setGpsLocation] = useState<any>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [openAnnotation, setOpenAnnotation] = useState(false);
  const [capturingGPS, setCapturingGPS] = useState(false);
  const [saving, setSaving] = useState(false);

  const takePhoto = async () => {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Camera permission is required");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0].base64) {
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;

      // 🔥 Open in annotation
      setSelectedPhoto(base64Image);
      setSelectedIndex(null);
      setSelectedNote("");
      setOpenAnnotation(true);
    }
  } catch (error) {
    Alert.alert("Failed to open camera");
  }
};

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0].base64) {
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setSelectedPhoto(base64Image);
      setSelectedIndex(null);
      setSelectedNote("");
      setOpenAnnotation(true);
    }
  };

const captureGPS = async () => {
  try {
    setCapturingGPS(true);

    Alert.alert("Capturing Coordinates", "Getting your GPS location...");

    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      Alert.alert("Permission Required", "Location permission is required.");
      setCapturingGPS(false);
      return;
    }

    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      Alert.alert("Location Disabled", "Please enable GPS in device settings.");
      setCapturingGPS(false);
      return;
    }

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    const coords = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
    };

    setGpsLocation(coords);

  } catch (error) {
    Alert.alert("Error", "Failed to capture GPS location.");
  } finally {
    setCapturingGPS(false);
  }
};

const completeInspection = async () => {
  if (images.length === 0) {
    Alert.alert("Please add at least one photo");
    return;
  }

  if (!gpsLocation) {
    Alert.alert("Please capture GPS before completing");
    return;
  }

  setSaving(true);

  try {
    const formData = new FormData();

    const imageMeta: { filename: string; note: string }[] = [];
    // 🔹 Append Images
    images.forEach((img, index) => {
      const filename = `photo_${index}.jpg`;

      formData.append("photos", {
        uri: img.uri,
        name: filename,
        type: "image/jpeg",
      } as any);

      // Add image meta (note per image)
        imageMeta.push({
            filename,
            note: img.note || "",
        });
    });

    // 🔹 Append General Notes
    formData.append("imageMeta", JSON.stringify(imageMeta));
    formData.append("notes", generalNotes.trim());

    // 🔹 Append GPS
    formData.append("manualGpsLat", String(gpsLocation.lat));
    formData.append("manualGpsLng", String(gpsLocation.lng));

    // 🔹 Append inspectionId (optional if needed by backend)
    // formData.append("inspectionId", inspectionId);

    console.log("FINAL FORM DATA READY");

    const res = await inspectionsAPI.uploadInspectionPhotos(
      inspectionId,
      formData
    );
    console.log("UPLOAD RESPONSE:", res.data);

    const uploaded = res.data;

    onComplete && onComplete();

    Alert.alert(
      "Inspection Completed",
      `Uploaded ${images.length} image(s) and GPS location`
    );

    // 🔥 Don't call API yet — wait for your API function
    // await inspectionsAPI.completeInspection(formData);

    setImages([]);
    onComplete();

  } catch (err) {
    console.log("ERROR:", err);
    Alert.alert("Upload failed");
  } finally {
    setSaving(false);
  }
};

  return (
    <View style={{ marginTop: 20 }}>

        <TouchableOpacity style={styles.button} onPress={takePhoto}>
        <Text style={styles.buttonText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={pickImage}>
        <Text style={styles.buttonText}>Upload Photo</Text>
      </TouchableOpacity>

          <TouchableOpacity
              style={styles.button}
              onPress={captureGPS}
              disabled={capturingGPS}
          >
              <Text style={styles.buttonText}>
                  {capturingGPS ? "Capturing Coordinates..." : "Capture GPS"}
              </Text>
          </TouchableOpacity>

      <View style={styles.grid}>
        {images.map((photo, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => {
              setSelectedPhoto(photo.uri);
              setSelectedNote(photo.note);
              setSelectedIndex(index);
              setOpenAnnotation(true);
            }}
          >
            <Image source={{ uri: photo.uri }} style={styles.image} />
          </TouchableOpacity>
        ))}
      </View>

          {gpsLocation && (
              <View style={styles.gpsContainer}>
                  <Text style={styles.gpsTitle}>📍 GPS Location Captured</Text>
                  <Text style={styles.gpsText}>
                      Lat: {gpsLocation.lat.toFixed(6)}, Lng: {gpsLocation.lng.toFixed(6)}
                  </Text>
              </View>
          )}

          <Text
              style={{
                  fontSize: 16,
                  fontWeight: "600",
                  marginTop: 10,
                  marginBottom: 6,
                  color: theme.text,
              }}
          >
              General Notes
          </Text>
          <TextInput
              placeholder="General inspection notes..."
              value={generalNotes}
              onChangeText={setGeneralNotes}
              multiline
              placeholderTextColor={theme.textSecondary}
              style={[
                  styles.notes,
                  {
                      backgroundColor: theme.background,
                      color: theme.text,
                      borderColor: theme.border,
                  },
              ]}
          />

      <TouchableOpacity
        style={[styles.button, { backgroundColor: "green" }]}
        onPress={completeInspection}
      >
        <Text style={styles.buttonText}>
          {saving ? "Completing..." : "Complete Inspection"}
        </Text>
      </TouchableOpacity>

      {openAnnotation && selectedPhoto && (
        <Modal visible transparent animationType="slide">
          <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ImageAnnotationCanvas
                imageUri={selectedPhoto}
                initialNote={selectedNote}
                onCancel={() => setOpenAnnotation(false)}
                onSave={(data) => {
                  setImages((prev) => {
                    if (selectedIndex !== null) {
                      const updated = [...prev];
                      updated[selectedIndex] = {
                        uri: data.fileUri,
                        note: data.notes,
                      };
                      return updated;
                    } else {
                      return [...prev, {
                        uri: data.fileUri,
                        note: data.notes,
                      }];
                    }
                  });

                  setOpenAnnotation(false);
                  setSelectedPhoto(null);
                  setSelectedIndex(null);
                }}
              />
            </GestureHandlerRootView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#007bff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 10,
  },
  image: {
    width: (width - 60) / 3,
    height: (width - 60) / 3,
    borderRadius: 8,
  },
  notes: {
  borderWidth: 1,
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  minHeight: 100,
  textAlignVertical: "top",
  marginTop: 12,
  marginBottom: 10,
},
gpsContainer: {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  backgroundColor: "#0f3d2e",
  borderWidth: 1,
  borderColor: "#1e6f4f",
},

gpsTitle: {
  color: "#4ade80",
  fontWeight: "700",
  marginBottom: 4,
},

gpsText: {
  color: "#a7f3d0",
  fontSize: 13,
},
});