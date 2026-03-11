import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { Button } from '../../src/components/Button';
import { profileAPI, inspectionsAPI } from '../../src/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [profileData, setProfileData] = useState<any>(null);
  const { user, logout } = useAuth();
  const { theme, themeType, toggleTheme } = useTheme();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  const loadProfile = async () => {
    try {
      const data = await profileAPI.getProfile();
      const statsData = await inspectionsAPI.getDashboardStats();
      setProfileData({
      ...data,
      stats: {
        total_inspections: statsData.totalInspections ?? 0,
        completed_inspections: statsData.completedInspections ?? 0,
        pending_inspections: statsData.pendingInspections ?? 0,
      },
    });
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/');
          },
        },
      ]
    );
  };

  const toggleAutoSync = async (value: boolean) => {
    setAutoSync(value);
    await AsyncStorage.setItem('autoSync', JSON.stringify(value));
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Profile</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={[styles.profileCard, { backgroundColor: theme.surface }]}>
          <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.name, { color: theme.text }]}>{user?.name}</Text>
          <Text style={[styles.email, { color: theme.textSecondary }]}>{user?.email}</Text>
          {user?.phone && (
            <View style={styles.phoneContainer}>
              <Ionicons name="call-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.phone, { color: theme.textSecondary }]}>{user.phone}</Text>
            </View>
          )}
          <View style={[styles.roleBadge, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
            <Text style={[styles.roleText, { color: theme.primary }]}>
              {user?.role?.toUpperCase()}
            </Text>
          </View>
        </View>

        {profileData && (
          <View style={[styles.statsCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.statsTitle, { color: theme.text }]}>Statistics</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.primary }]}>
                  {profileData.stats.total_inspections}
                </Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Total</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.success }]}>
                  {profileData.stats.completed_inspections}
                </Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Completed</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.warning }]}>
                  {profileData.stats.pending_inspections}
                </Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Pending</Text>
              </View>
            </View>
          </View>
        )}

        <View style={[styles.settingsCard, { backgroundColor: theme.surface }]}>
          <Text style={[styles.settingsTitle, { color: theme.text }]}>Settings</Text>
          
          <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
            <View style={styles.settingLeft}>
              <Ionicons name="moon" size={20} color={theme.text} />
              <Text style={[styles.settingText, { color: theme.text }]}>Dark Mode</Text>
            </View>
            <Switch
              value={themeType === 'dark'}
              onValueChange={toggleTheme}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
            <View style={styles.settingLeft}>
              <Ionicons name="notifications" size={20} color={theme.text} />
              <Text style={[styles.settingText, { color: theme.text }]}>Notifications</Text>
            </View>
            <Switch
              value={true}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#FFFFFF"
            />
          </View> */}

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons name="sync" size={20} color={theme.text} />
              <Text style={[styles.settingText, { color: theme.text }]}>
                Auto Sync
              </Text>
            </View>

            <Switch
              value={autoSync}
              onValueChange={toggleAutoSync}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <Button
          title="Logout"
          onPress={handleLogout}
          variant="danger"
          style={styles.logoutButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  profileCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    marginBottom: 8,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  phone: {
    fontSize: 14,
  },
  roleBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statsCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  settingsCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingText: {
    fontSize: 16,
  },
  logoutButton: {
    marginTop: 20,
  },
});
