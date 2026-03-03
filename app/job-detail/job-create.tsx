import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Switch,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { inspectionsAPI } from '../../src/services/api';
import { useTheme } from '../../src/context/ThemeContext';
import { Picker } from '@react-native-picker/picker';

type RecurrenceType = 'monthly' | 'quarterly' | 'biAnnual' | 'annual' | null;

interface FormData {
    propertyAddress: string;
    notes: string;
    gpsCoordinates: { lat: number; lng: number } | null;
    createNewDeal: boolean;
    recurrenceType: RecurrenceType;
    rolloverEnabled: boolean;
    isImmediate: boolean;
    dealname: string;
}

export default function CreateJobScreen() {
    const router = useRouter();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState<FormData>({
        propertyAddress: '',
        notes: '',
        gpsCoordinates: null,
        createNewDeal: true,
        recurrenceType: 'monthly',
        rolloverEnabled: true,
        isImmediate: false,
        dealname: '',
    });

    const handleChange = (field: keyof FormData, value: any) => {
        setFormData((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleSubmit = async () => {
        if (!formData.propertyAddress.trim()) {
            Alert.alert('Error', 'Property address is required');
            return;
        }

        setLoading(true);
        try {
            await inspectionsAPI.create({
                ...formData,
                propertyAddress: formData.propertyAddress.trim(),
                dealname: formData.dealname.trim(),
            });

            Alert.alert('Success', 'Driveby created successfully!');
            router.replace('/(tabs)/jobs');
        } catch (error: any) {
            console.error(error);
            Alert.alert(
                'Error',
                error?.response?.data?.message || 'Failed to create Driveby'
            );
        } finally {
            setLoading(false);
        }
    };

    const getCurrentLocation = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'Location permission is required');
            return;
        }

        const location = await Location.getCurrentPositionAsync({});
        handleChange('gpsCoordinates', {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
        });

        Alert.alert('Success', 'Location captured successfully');
    };

    return (
        <SafeAreaView
            style={[styles.container, { backgroundColor: theme.background }]}
        >
            <ScrollView contentContainerStyle={styles.content}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: theme.text }]}>
                        Create New Driveby
                    </Text>
                </View>

                {/* Title */}
                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        Title *
                    </Text>
                    <TextInput
                        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                        placeholder="Enter Driveby title"
                        placeholderTextColor={theme.textSecondary}
                        value={formData.dealname}
                        onChangeText={(text) => handleChange('dealname', text)}
                    />
                </View>

                {/* Address */}
                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        Property Address *
                    </Text>
                    <TextInput
                        style={[
                            styles.textArea,
                            { color: theme.text, borderColor: theme.border },
                        ]}
                        multiline
                        numberOfLines={4}
                        placeholder="Enter property address..."
                        placeholderTextColor={theme.textSecondary}
                        value={formData.propertyAddress}
                        onChangeText={(text) => handleChange('propertyAddress', text)}
                    />
                </View>

                {/* GPS */}
                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        GPS Coordinates (Optional)
                    </Text>

                    <TouchableOpacity
                        style={[styles.buttonOutline, { borderColor: theme.primary }]}
                        onPress={getCurrentLocation}
                    >
                        <Ionicons name="location-outline" size={18} color={theme.primary} />
                        <Text style={{ color: theme.primary, marginLeft: 6 }}>
                            Use Current Location
                        </Text>
                    </TouchableOpacity>

                    {formData.gpsCoordinates && (
                        <Text style={{ marginTop: 8, color: theme.textSecondary }}>
                            Lat: {formData.gpsCoordinates.lat.toFixed(6)} |
                            Lng: {formData.gpsCoordinates.lng.toFixed(6)}
                        </Text>
                    )}
                </View>

                {/* Create Deal */}
                <View style={styles.switchRow}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        Create new HubSpot deal
                    </Text>
                    <Switch
                        value={formData.createNewDeal}
                        onValueChange={(value) => handleChange('createNewDeal', value)}
                    />
                </View>

                {/* Recurring Inspection Type */}
                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        Recurring Inspection Type
                    </Text>

                    <View
                        style={[
                            styles.pickerContainer,
                            { borderColor: theme.border, backgroundColor: theme.surface },
                        ]}
                    >
                        <Picker
                            selectedValue={formData.recurrenceType || ''}
                            enabled={!formData.isImmediate}
                            onValueChange={(value) =>
                                handleChange('recurrenceType', value as RecurrenceType)
                            }
                            dropdownIconColor={theme.text}
                            style={{
                                color: theme.text, // selected value color
                            }}
                            itemStyle={{
                                color: theme.text, // 👈 IMPORTANT for iOS dropdown list
                            }}
                        >
                            <Picker.Item label="Select recurrence type" value="" />
                            <Picker.Item label="Monthly" value="monthly" />
                            <Picker.Item label="Quarterly" value="quarterly" />
                            <Picker.Item label="Bi-Annual" value="biAnnual" />
                            <Picker.Item label="Annual" value="annual" />
                        </Picker>
                    </View>
                </View>

                {/* Immediate Job */}
                <View style={styles.switchRow}>
                    <Text style={[styles.label, { color: theme.text }]}>
                        Create Immediate Job
                    </Text>
                    <Switch
                        value={formData.isImmediate}
                        onValueChange={(value) =>
                            setFormData((prev) => ({
                                ...prev,
                                isImmediate: value,
                                recurrenceType: value ? null : 'monthly',
                            }))
                        }
                    />
                </View>

                {/* Submit */}
                <TouchableOpacity
                    style={[styles.submitButton, { backgroundColor: theme.primary }]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.submitText}>Create Driveby</Text>
                    )}
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 20 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        gap: 12,
    },
    title: { fontSize: 20, fontWeight: 'bold' },
    field: { marginBottom: 20 },
    label: { marginBottom: 8, fontSize: 14, fontWeight: '600' },
    input: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
    },
    textArea: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        textAlignVertical: 'top',
    },
    buttonOutline: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        padding: 10,
        borderRadius: 8,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    submitButton: {
        padding: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    submitText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    pickerContainer: {
        borderWidth: 1,
        borderRadius: 8,
        overflow: 'hidden',
    },
});