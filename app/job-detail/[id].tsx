import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageAnnotationCanvas from '../../src/components/ImageAnnotationCanvas';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useTheme } from '../../src/context/ThemeContext';
import { inspectionsAPI } from '../../src/services/api';
import { Inspection } from '../../src/types';
import ImageUploadComponent from "../../src/components/ImageUpload";
import ImageViewing from "react-native-image-viewing";

const { width } = Dimensions.get('window');

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<
    { uri: string; note: string }[]
  >([]);
  const [selectedNote, setSelectedNote] = useState<string>("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [openAnnotation, setOpenAnnotation] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    loadInspection();
    requestPermissions();
  }, [id]);

  const requestPermissions = async () => {
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: mediaStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();

    if (cameraStatus !== 'granted' || mediaStatus !== 'granted' || locationStatus !== 'granted') {
      Alert.alert('Permissions Required', 'Camera, media library, and location permissions are required.');
    }
  };

  const loadInspection = async () => {
    try {
      const data = await inspectionsAPI.getById(id as string);
      console.log("INSPECTION DATA---->", data);
      setInspection(data);
      setNotes(data.notes || '');
      setPhotos(
        (data.photos || []).map((p: any) => ({
          uri: p.fileUrl, // handle backend field
          note: p.note || "",
        }))
      );
      console.log("Mapped Photos:", (data.photos || []).map((p: any) => ({
        uri: p.fileUrl,
        note: p.note || "",
      })));
      setLocation(data.gps_coordinates || null);
    } catch (error) {
      console.error('Error loading inspection:', error);
      Alert.alert('Error', 'Failed to load inspection details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!inspection) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorText, { color: theme.error }]}>Inspection not found</Text>
      </SafeAreaView>
    );
  }

  const isPending = inspection.status === 'pending';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Inspection Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={[styles.statusBadge, {
          backgroundColor: inspection.status === 'completed' ? theme.success + '20' : theme.warning + '20',
          borderColor: inspection.status === 'completed' ? theme.success : theme.warning,
        }]}>
          <Text style={[styles.statusText, {
            color: inspection.status === 'completed' ? theme.success : theme.warning
          }]}>
            {inspection.status.toUpperCase()}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.infoRow}>
            <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Deal Name:</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{inspection.dealname}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Inspection ID:</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>#{inspection.inspectionId}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="home-outline" size={20} color={theme.primary} />
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Address:</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{inspection.property_address}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="location" size={20} color={theme.primary} />
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Distance:</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{typeof inspection.distance === "number" ? parseFloat(inspection.distance).toFixed(1) : "-"} km</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color={theme.primary} />
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Created:</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>
              {format(new Date(inspection.created_date), 'MMM dd, yyyy HH:mm')}
            </Text>
          </View>

          {inspection.completed_date && (
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.success} />
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Completed:</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>
                {format(new Date(inspection.completed_date), 'MMM dd, yyyy HH:mm')}
              </Text>
            </View>
          )}
        </View>

        {isPending && (
          <>
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Photos</Text>

              <ImageUploadComponent
                inspectionId={id as string}
                onComplete={loadInspection}
              />
            </View>
          </>
        )}

        {!isPending && (
          <>
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Photos ({photos.length})</Text>
              {photos.length > 0 ? (
                <View style={styles.photoGrid}>
                  {photos.map((photo, index) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        setCurrentImageIndex(index);
                        setVisible(true);
                      }}
                    >
                      <Image
                        source={{ uri: photo.uri }}
                        style={{ width: (width - 64) / 3, height: 120, borderRadius: 8 }}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={[styles.noData, { color: theme.textSecondary }]}>No photos</Text>
              )}
            </View>

            {/* Inspection Map Images Section */}
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                Inspection Map Images ({inspection.inspectionMapImages?.length || 0})
              </Text>

              {inspection.inspectionMapImages &&
                inspection.inspectionMapImages.length > 0 ? (
                <View style={styles.photoGrid}>
                  {inspection.inspectionMapImages.map((item: any, index: number) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        setSelectedPhoto(item.imageUrl);   // open full screen
                        setSelectedNote("");               // no note for map images
                        setSelectedIndex(null);            // not editable
                      }}
                    >
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={{
                          width: (width - 64) / 3,
                          height: 120,
                          borderRadius: 8,
                        }}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={[styles.noData, { color: theme.textSecondary }]}>
                  No map images
                </Text>
              )}
            </View>

            {notes && (
              <View style={[styles.card, { backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Notes</Text>
                <Text style={[styles.notesText, { color: theme.text }]}>{notes}</Text>
              </View>
            )}

            {inspection.gps_coordinates && (
              <View style={[styles.card, { backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>GPS Location</Text>
                <View style={styles.locationInfo}>
                  <Ionicons name="location" size={20} color={theme.primary} />
                  <Text style={[styles.locationText, { color: theme.text }]}>
                    Lat: {inspection.gps_coordinates.lat.toFixed(6)}, Lng: {inspection.gps_coordinates.lng.toFixed(6)}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={selectedPhoto !== null}
        transparent
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.modalContainer}>

          {/* Header icons */}
          <View style={styles.modalHeader}>

            {/* Close */}
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setSelectedPhoto(null)}
            >
              <Ionicons name="close" size={32} color="#FFFFFF" />
            </TouchableOpacity>

            {/* ✏️ Edit */}
            <TouchableOpacity
              style={styles.modalEdit}
              onPress={() => {
                const index = photos.findIndex(p => p.uri === selectedPhoto);
                if (index !== -1) {
                  setSelectedIndex(index);
                  setSelectedNote(photos[index].note);
                }
                setOpenAnnotation(true);
              }}
            >
              <Ionicons name="pencil" size={28} color="#FFFFFF" />
            </TouchableOpacity>

          </View>

          {/* Image */}
          {selectedPhoto && (
            <Image
              source={{ uri: selectedPhoto }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}

        </View>
      </Modal>
      <ImageViewing
        images={photos.map((p) => ({ uri: p.uri }))}
        imageIndex={currentImageIndex}
        visible={visible}
        onRequestClose={() => setVisible(false)}

        FooterComponent={({ imageIndex }) => (
          <View
            style={{
              padding: 20,
              backgroundColor: "rgba(0,0,0,0.6)",
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                textAlign: "center",
              }}
            >
              {photos[imageIndex]?.note || "No notes"}
            </Text>
          </View>
        )}
      />
      {openAnnotation && selectedPhoto && (
        <Modal visible transparent animationType="slide">
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ImageAnnotationCanvas
                imageUri={selectedPhoto}
                initialNote={selectedNote}
                onCancel={() => setOpenAnnotation(false)}
                onSave={(data) => {
                  setPhotos((prev) => {
                    if (selectedIndex !== null) {
                      const updated = [...prev];
                      updated[selectedIndex] = {
                        uri: data.fileUri,
                        note: data.notes,
                      };
                      return updated;
                    } else {
                      return [
                        ...prev,
                        {
                          uri: data.fileUri,
                          note: data.notes,
                        },
                      ];
                    }
                  });

                  setSelectedPhoto(null);
                  setSelectedIndex(null);
                  setOpenAnnotation(false);
                }}
              />
            </GestureHandlerRootView>

          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  address: {
    fontSize: 16,
    marginLeft: 28,
    marginBottom: 12,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  photoButton: {
    flex: 1,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  photoThumbnail: {
    width: (width - 64) / 3,
    height: (width - 64) / 3,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    padding: 4,
    borderRadius: 4,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 120,
  },
  notesText: {
    fontSize: 16,
    lineHeight: 24,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationText: {
    fontSize: 14,
  },
  completeButton: {
    marginTop: 16,
    marginBottom: 32,
  },
  pdfButton: {
    marginTop: 8,
    marginBottom: 32,
  },
  noData: {
    textAlign: 'center',
    padding: 24,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 16,
    padding: 24,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    zIndex: 10,
  },
  modalClose: {
    padding: 8,
  },
  modalEdit: {
    padding: 8,
  },
  fullImage: {
    width: width,
    height: '80%',
  },
});
