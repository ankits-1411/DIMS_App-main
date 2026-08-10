import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { inspectionsAPI } from "../services/api";
import { Annotation } from "../types/annotations";
import ImageAnnotationCanvas from "./ImageAnnotationCanvas";

const { width } = Dimensions.get("window");

interface Props {
  inspectionId: string;
  onComplete: () => void;
}

/** A photo staged for upload. `id` is stable for the lifetime of the entry so
 *  that deleting/reordering never acts on the wrong item. */
type StagedPhoto = {
  id: string;
  uri: string;
  note: string;
  /** Structured annotation data, submitted alongside the flattened image so the
   *  annotations remain editable/recreatable rather than only pixels. */
  annotations: Annotation[];
  /** The un-annotated original, so re-opening the editor does not stack
   *  annotations on top of an image they have already been burnt into. */
  sourceUri: string;
};

/** The photo currently open in the annotation canvas. `id` is null for a
 *  brand new capture that has not been added to the list yet. */
type EditingPhoto = {
  id: string | null;
  uri: string;
  note: string;
  annotations: Annotation[];
};

type UploadStage = "idle" | "checking" | "uploading" | "completing";

const newId = () =>
  `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** How long to wait for a fresh satellite fix before falling back. */
const GPS_TIMEOUT_MS = 20000;
/** A last known fix older than this is not worth reporting as the location. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * nginx in front of the API accepts a 25MB request body and rejects anything
 * larger by closing the connection — which arrives here as an unexplained
 * "Network Error" rather than a 413. Refuse oversized submissions locally so
 * the inspector gets a message they can act on. The margin covers multipart
 * boundaries, headers and the metadata fields.
 */
const MAX_UPLOAD_BYTES = 22 * 1024 * 1024;

/**
 * `DeadSystemException` is thrown when a binder call reaches an Android system
 * service while `system_server` is dead or restarting — i.e. the OS itself is
 * coming down, not a fault in this app. It is transient, so it is worth naming
 * precisely rather than reporting as a generic location failure.
 */
const isDeadSystemError = (error: any) =>
  /DeadSystemException/i.test(String(error?.message ?? error));

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * `hasServicesEnabledAsync` is only an advisory pre-check, and on Android it
 * crosses binder to the system location service — exactly the call that fails
 * with a DeadSystemException while the OS is restarting. A check that cannot be
 * answered must not block the capture, so this returns `null` for "unknown" and
 * lets the actual position request be the source of truth.
 */
const areLocationServicesEnabled = async (): Promise<boolean | null> => {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch (error) {
    console.log("hasServicesEnabledAsync failed, continuing anyway:", error);
    return null;
  }
};

/**
 * Gets a position, falling back to the last known fix. GPS is mandatory to
 * complete an inspection, so a flaky location service must not hard-block an
 * inspector in the field — and a high-accuracy request can hang indefinitely
 * indoors, which is why it is bounded by a timeout.
 */
const getPosition = async (): Promise<{
  coords: Location.LocationObjectCoords;
  fromLastKnown: boolean;
}> => {
  try {
    const loc = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      }),
      GPS_TIMEOUT_MS,
      "GPS lookup"
    );
    return { coords: loc.coords, fromLastKnown: false };
  } catch (error) {
    console.log("getCurrentPositionAsync failed, trying last known fix:", error);

    try {
      const last = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
      });
      if (last) return { coords: last.coords, fromLastKnown: true };
    } catch (lastKnownError) {
      console.log("getLastKnownPositionAsync also failed:", lastKnownError);
    }

    throw error;
  }
};

/**
 * React Native builds the multipart body by reading the file at `uri` off disk,
 * so the name/type must match what is actually there. The annotation canvas
 * writes PNG snapshots, which used to be uploaded as `photo_0.jpg` +
 * `image/jpeg` and could be rejected by server-side mime validation.
 */
const describeFile = (uri: string, index: number) => {
  const ext = (uri.split("?")[0].split(".").pop() || "").toLowerCase();
  const known: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  const safeExt = known[ext] ? ext : "jpg";
  return {
    name: `photo_${index}.${safeExt}`,
    type: known[safeExt] || "image/jpeg",
  };
};

export default function ImageUploadComponent({
  inspectionId,
  onComplete,
}: Props) {
  const { theme } = useTheme();

  const [images, setImages] = useState<StagedPhoto[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");
  const [gpsLocation, setGpsLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // The static map is kept as both the remote URL (for previewing) and a
  // downloaded local copy (the only form that can actually be uploaded).
  const [mapImage, setMapImage] = useState<{
    url: string;
    localUri: string | null;
  } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<EditingPhoto | null>(null);
  const [capturingGPS, setCapturingGPS] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);

  // `disabled` on a TouchableOpacity is applied on the next render, so a fast
  // double tap can fire the handler twice before `stage` updates. A ref closes
  // that window synchronously.
  const submittingRef = useRef(false);

  const saving = stage !== "idle";

  const openForEditing = useCallback((photo: EditingPhoto) => {
    setEditing(photo);
  }, []);

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Camera permission required",
          "Enable camera access for this app in your device settings."
        );
        return;
      }

      // No `base64: true` — the file on disk is all we need, and decoding a
      // full-resolution photo into a base64 string for every capture wasted
      // several MB of JS heap per image.
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      openForEditing({
        id: null,
        uri: result.assets[0].uri,
        note: "",
        annotations: [],
      });
    } catch (error) {
      console.log("Take photo error:", error);
      Alert.alert("Camera error", "Failed to open the camera. Please try again.");
    }
  };

  const pickImage = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Photo library permission required",
          "Enable photo access for this app in your device settings."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      openForEditing({
        id: null,
        uri: result.assets[0].uri,
        note: "",
        annotations: [],
      });
    } catch (error) {
      console.log("Pick image error:", error);
      Alert.alert(
        "Photo library error",
        "Failed to open the photo library. Please try again."
      );
    }
  };

  const removeImage = (id: string) => {
    const target = images.find((img) => img.id === id);
    if (!target) return;

    Alert.alert("Remove photo", "Remove this photo from the inspection?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          // Filter by id, never by index: the annotation modal and the grid can
          // disagree about indices once an item has been removed.
          setImages((prev) => prev.filter((img) => img.id !== id));
          setEditing((current) => (current?.id === id ? null : current));
          console.log("Removed staged photo:", id);
        },
      },
    ]);
  };

  const getMapImageUrl = (lat: number, lng: number) => {
    const mapKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=600x300&markers=color:red%7C${lat},${lng}&key=${mapKey}`;
  };

  /**
   * Downloads the static map to local storage — the only form that can be
   * attached to the upload, since the multipart encoder cannot read a remote
   * URL. On a non-200 the Maps API writes a plain-text explanation into the
   * response body, so it is read back and logged verbatim: a 403 here is a
   * Google Cloud configuration problem (Maps Static API not enabled, billing
   * off, or the key restricted to Android apps, which cannot authorise a
   * server-side static map request) and the exact reason matters.
   */
  const downloadMapImage = async (url: string) => {
    const target = `${FileSystem.cacheDirectory}location_map_${Date.now()}.png`;
    const download = await FileSystem.downloadAsync(url, target);

    if (download.status === 200) {
      const info = await FileSystem.getInfoAsync(download.uri);
      console.log("Location map downloaded:", download.uri, {
        bytes: info.exists ? info.size : 0,
      });
      return { localUri: download.uri, reason: null as string | null };
    }

    let reason = `HTTP ${download.status}`;
    try {
      const body = await FileSystem.readAsStringAsync(download.uri);
      if (body?.trim()) reason = body.trim();
    } catch {
      // Body was binary or unreadable; the status alone will have to do.
    }
    await FileSystem.deleteAsync(download.uri, { idempotent: true });

    console.log("Location map download failed:", download.status, reason);
    return { localUri: null, reason };
  };

  const captureGPS = async () => {
    if (capturingGPS) return;

    try {
      setCapturingGPS(true);
      setMapError(null);
      setGpsNotice(null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission required",
          "Location permission is required to capture GPS coordinates."
        );
        return;
      }

      // Advisory only — see areLocationServicesEnabled. `null` means the check
      // itself could not be answered, in which case we still try to get a fix
      // rather than refusing outright.
      const servicesEnabled = await areLocationServicesEnabled();
      if (servicesEnabled === false) {
        Alert.alert(
          "Location disabled",
          "Please turn on GPS/location services in your device settings."
        );
        return;
      }

      const { coords: position, fromLastKnown } = await getPosition();

      const coords = { lat: position.latitude, lng: position.longitude };
      setGpsLocation(coords);
      console.log("GPS captured:", coords, { fromLastKnown });

      if (fromLastKnown) {
        setGpsNotice(
          "Approximate location from the last known fix. Move outdoors and tap Capture GPS again for a precise reading."
        );
      }

      if (!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {
        console.log("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set");
        setMapImage(null);
        setMapError(
          "Map preview unavailable: the Google Maps API key is missing from this build."
        );
        return;
      }

      const url = getMapImageUrl(coords.lat, coords.lng);
      try {
        const { localUri, reason } = await downloadMapImage(url);
        setMapImage({ url, localUri });
        setMapError(reason);
      } catch (downloadError: any) {
        // A missing map image must never block the inspection — the
        // coordinates themselves are what matter.
        console.log("Location map download error:", downloadError);
        setMapImage({ url, localUri: null });
        setMapError(downloadError?.message || "Map image could not be downloaded.");
      }
    } catch (error: any) {
      console.log("Capture GPS error:", error);

      if (isDeadSystemError(error)) {
        Alert.alert(
          "Location service restarting",
          "Android's system location service was restarting, so it could not " +
            "answer (DeadSystemException). This is a temporary device-level " +
            "fault, not a problem with the inspection. Wait a few seconds and " +
            "tap Capture GPS again — if it keeps happening, restart the device."
        );
        return;
      }

      Alert.alert(
        "Location error",
        /timed out/i.test(error?.message || "")
          ? "Could not get a GPS fix in time. Move outdoors or near a window and try again."
          : "Failed to capture your GPS location. Move to an area with better signal and try again."
      );
    } finally {
      setCapturingGPS(false);
    }
  };

  /**
   * Confirms every staged photo still exists on disk. Cache files can be
   * evicted by the OS between capture and upload, and a missing file makes the
   * multipart request fail as an unhelpful "Network Error".
   */
  const collectUploadableImages = async (photos: StagedPhoto[]) => {
    const usable: StagedPhoto[] = [];
    const missing: StagedPhoto[] = [];
    let totalBytes = 0;

    for (const photo of photos) {
      try {
        const info = await FileSystem.getInfoAsync(photo.uri);
        if (info.exists && !info.isDirectory) {
          usable.push(photo);
          totalBytes += info.size ?? 0;
        } else {
          missing.push(photo);
        }
      } catch (error) {
        console.log("File check failed:", photo.uri, error);
        missing.push(photo);
      }
    }

    return { usable, missing, totalBytes };
  };

  const completeInspection = async () => {
    if (submittingRef.current) return;

    if (images.length === 0) {
      Alert.alert("Photo required", "Please add at least one photo.");
      return;
    }

    if (!gpsLocation) {
      Alert.alert(
        "GPS required",
        "Please capture the GPS location before completing."
      );
      return;
    }

    submittingRef.current = true;
    setProgress(0);

    // `stage` read from the catch block would be the value captured at render
    // time, not the stage the failure actually happened in. Track it locally.
    let currentStage: UploadStage = "checking";
    const goToStage = (next: UploadStage) => {
      currentStage = next;
      setStage(next);
    };
    goToStage("checking");

    try {
      const { usable, missing, totalBytes } = await collectUploadableImages(
        images
      );

      if (missing.length > 0) {
        console.log(
          "Missing photo files:",
          missing.map((m) => m.uri)
        );
      }

      if (usable.length === 0) {
        Alert.alert(
          "Photos unavailable",
          "The attached photos are no longer available on this device. Please re-capture them."
        );
        setImages([]);
        return;
      }

      if (missing.length > 0) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Some photos are missing",
            `${missing.length} of ${images.length} photo(s) are no longer on this device. Upload the remaining ${usable.length}?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Upload", onPress: () => resolve(true) },
            ],
            { cancelable: false }
          );
        });

        if (!proceed) return;
        setImages(usable);
      }

      if (totalBytes > MAX_UPLOAD_BYTES) {
        Alert.alert(
          "Photos too large",
          `These ${usable.length} photo(s) total ${Math.round(
            totalBytes / (1024 * 1024)
          )}MB, more than the ${Math.floor(
            MAX_UPLOAD_BYTES / (1024 * 1024)
          )}MB the server accepts in one submission. Remove a few photos and try again.`
        );
        return;
      }

      const formData = new FormData();
      const imageMeta: {
        filename: string;
        note: string;
        annotations: Annotation[];
      }[] = [];

      usable.forEach((img, index) => {
        const { name, type } = describeFile(img.uri, index);

        formData.append("photos", { uri: img.uri, name, type } as any);
        // The uploaded file already has the annotations drawn into it; the
        // structured data goes along so they stay recreatable and editable
        // rather than existing only as pixels.
        imageMeta.push({
          filename: name,
          note: img.note || "",
          annotations: img.annotations ?? [],
        });
      });

      formData.append("imageMeta", JSON.stringify(imageMeta));
      formData.append("notes", generalNotes.trim());
      formData.append("gpsLat", String(gpsLocation.lat));
      formData.append("gpsLng", String(gpsLocation.lng));

      // Only ever append the downloaded local copy.
      if (mapImage?.localUri) {
        formData.append("currentLocationImage", {
          uri: mapImage.localUri,
          name: "location-map.png",
          type: "image/png",
        } as any);
      } else if (mapImage?.url) {
        // Let the backend fetch it itself rather than skipping it entirely.
        formData.append("currentLocationImageUrl", mapImage.url);
      }

      console.log("Uploading inspection photos:", {
        inspectionId,
        photoCount: usable.length,
        totalKB: Math.round(totalBytes / 1024),
        hasLocationImage: Boolean(mapImage?.localUri),
      });

      goToStage("uploading");
      const res = await inspectionsAPI.uploadInspectionPhotos(
        inspectionId,
        formData,
        setProgress
      );
      console.log("UPLOAD RESPONSE:", res.data);

      // The upload only stores photos. Marking the inspection completed is a
      // separate call that was never being made, which is why the status
      // stayed "pending" even after a successful upload.
      goToStage("completing");
      await inspectionsAPI.complete(inspectionId, gpsLocation);

      setImages([]);
      setGeneralNotes("");
      onComplete();

      Alert.alert(
        "Inspection completed",
        `Uploaded ${usable.length} photo(s) and the GPS location.`
      );
    } catch (error: any) {
      const message =
        error?.message || "Something went wrong. Please try again.";
      console.log("Complete inspection failed at stage:", currentStage, {
        inspectionId,
        message: error?.message,
      });

      // Photos are deliberately kept staged so the user can retry without
      // re-capturing anything.
      Alert.alert("Could not complete inspection", message, [
        { text: "OK" },
      ]);

      // Refresh either way: the upload may have succeeded before the failure.
      onComplete();
    } finally {
      submittingRef.current = false;
      setStage("idle");
      setProgress(0);
    }
  };

  const buttonLabel = () => {
    switch (stage) {
      case "checking":
        return "Checking photos...";
      case "uploading":
        return `Uploading ${Math.round(progress * 100)}%`;
      case "completing":
        return "Completing inspection...";
      default:
        return "Complete Inspection";
    }
  };

  return (
    <View style={{ marginTop: 20 }}>
      <TouchableOpacity
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={takePhoto}
        disabled={saving}
      >
        <Text style={styles.buttonText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={pickImage}
        disabled={saving}
      >
        <Text style={styles.buttonText}>Upload Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.button,
          (capturingGPS || saving) && styles.buttonDisabled,
        ]}
        onPress={captureGPS}
        disabled={capturingGPS || saving}
      >
        <Text style={styles.buttonText}>
          {capturingGPS ? "Capturing Coordinates..." : "Capture GPS"}
        </Text>
      </TouchableOpacity>

      {images.length > 0 && (
        <Text style={[styles.sectionLabel, { color: theme.text }]}>
          Attached Photos ({images.length})
        </Text>
      )}

      <View style={styles.grid}>
        {images.map((photo) => (
          // Keyed by the stable id, not the array index. Index keys made React
          // reuse the same <Image> host view after a deletion, so the grid
          // looked unchanged even though state had updated.
          <View key={photo.id} style={styles.thumbWrapper}>
            <TouchableOpacity
              disabled={saving}
              onPress={() =>
                // Re-opens the *original* photo plus its stored annotations, so
                // existing annotations stay editable instead of being flattened
                // pixels that new annotations get drawn on top of.
                openForEditing({
                  id: photo.id,
                  uri: photo.sourceUri,
                  note: photo.note,
                  annotations: photo.annotations,
                })
              }
            >
              <Image source={{ uri: photo.uri }} style={styles.image} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteBadge}
              disabled={saving}
              onPress={() => removeImage(photo.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Remove photo"
            >
              <Ionicons name="close" size={16} color="#fff" />
            </TouchableOpacity>

            {photo.note ? (
              <View style={styles.noteBadge}>
                <Ionicons name="document-text" size={12} color="#fff" />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {gpsLocation && (
        <View style={styles.gpsContainer}>
          <Text style={styles.gpsTitle}>📍 GPS Location Captured</Text>
          <Text style={styles.gpsText}>
            Lat: {gpsLocation.lat.toFixed(6)}, Lng: {gpsLocation.lng.toFixed(6)}
          </Text>

          {gpsNotice && (
            <Text style={[styles.gpsWarning, { marginTop: 6 }]}>
              {gpsNotice}
            </Text>
          )}

          {/* Only the downloaded copy is rendered. Falling back to the remote
              URL is pointless: if the download was rejected, an <Image> fetch
              of the same URL fails the same way and just shows a broken box. */}
          {mapImage?.localUri && (
            <Image
              source={{ uri: mapImage.localUri }}
              style={styles.mapImage}
              resizeMode="cover"
            />
          )}

          {mapError && (
            <View style={styles.mapErrorBox}>
              <Text style={styles.gpsWarning}>
                Map preview unavailable — the coordinates above are still
                captured and will be submitted.
              </Text>
              <Text style={styles.mapErrorDetail} numberOfLines={4}>
                {mapError}
              </Text>
            </View>
          )}
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.text }]}>
        General Notes
      </Text>
      <TextInput
        placeholder="General inspection notes..."
        value={generalNotes}
        onChangeText={setGeneralNotes}
        multiline
        editable={!saving}
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

      {stage === "uploading" && (
        <View style={[styles.progressTrack, { borderColor: theme.border }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(3, Math.round(progress * 100))}%` },
            ]}
          />
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.button,
          styles.completeButton,
          saving && styles.buttonDisabled,
        ]}
        onPress={completeInspection}
        disabled={saving}
      >
        <View style={styles.completeButtonInner}>
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text style={styles.buttonText}>{buttonLabel()}</Text>
        </View>
      </TouchableOpacity>

      {editing && (
        // `statusBarTranslucent` makes the Android modal span the status bar so
        // the inset padding inside the canvas is what positions the toolbar,
        // matching iOS instead of double-offsetting.
        <Modal visible transparent animationType="slide" statusBarTranslucent>
          {/* A Modal is a separate native view hierarchy, so it needs its own
              provider for useSafeAreaInsets() to resolve real insets. */}
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView
              style={{ flex: 1, backgroundColor: "#000" }}
            >
              <ImageAnnotationCanvas
                imageUri={editing.uri}
                initialNote={editing.note}
                initialAnnotations={editing.annotations}
                onCancel={() => setEditing(null)}
                onDelete={
                  editing.id
                    ? () => {
                        const id = editing.id as string;
                        setEditing(null);
                        removeImage(id);
                      }
                    : undefined
                }
                onSave={(data) => {
                  const editedId = editing.id;
                  // `editing.uri` is the un-annotated original; `data.fileUri`
                  // is the flattened image that gets uploaded.
                  const sourceUri = editing.uri;

                  setImages((prev) => {
                    if (editedId) {
                      // Match on id — the entry may have moved since it opened.
                      return prev.map((img) =>
                        img.id === editedId
                          ? {
                              ...img,
                              uri: data.fileUri,
                              note: data.notes,
                              annotations: data.annotations,
                              sourceUri,
                            }
                          : img
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: newId(),
                        uri: data.fileUri,
                        note: data.notes,
                        annotations: data.annotations,
                        sourceUri,
                      },
                    ];
                  });

                  setEditing(null);
                }}
              />
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </Modal>
      )}
    </View>
  );
}

const THUMB = (width - 60) / 3;

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#007bff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  completeButton: {
    backgroundColor: "green",
  },
  completeButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 10,
  },
  thumbWrapper: {
    width: THUMB,
    height: THUMB,
  },
  image: {
    width: THUMB,
    height: THUMB,
    borderRadius: 8,
    backgroundColor: "#222",
  },
  deleteBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  noteBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
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
  progressTrack: {
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#22c55e",
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
  gpsWarning: {
    color: "#fcd34d",
    fontSize: 12,
  },
  mapErrorBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.25)",
    gap: 4,
  },
  mapErrorDetail: {
    color: "#94a3b8",
    fontSize: 11,
  },
  mapImage: {
    width: "100%",
    height: 150,
    borderRadius: 10,
    marginTop: 10,
  },
});
