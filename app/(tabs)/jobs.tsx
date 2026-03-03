import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/context/ThemeContext';
import { JobCard } from '../../src/components/JobCard';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { inspectionsAPI } from '../../src/services/api';
import { Inspection } from '../../src/types';

type TabType = 'all' | 'pending' | 'completed';

export default function JobsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<Inspection[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Inspection[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    filterJobs();
  }, [jobs, activeTab, searchQuery]);

  const loadJobs = async () => {
    try {
      const data = await inspectionsAPI.getAssigned();
      const mappedInspections: Inspection[] = (data || []).map((item: any) => ({
        id: item._id || '',
        inspectionId: item.inspectionId || '',
        property_address: item.propertyAddress || '',
        status: item.status || 'pending',
        created_date: item.createdDate || item.createdAt || '',
        completed_date: item.completedDate || '',
        inspector_name: item.assignedToId?.name || '',
        photos: item.photos || [],
        distance: item.distance || 0,
      }));
      setJobs(mappedInspections);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filterJobs = () => {
    let filtered = jobs;

    // Filter by tab
    if (activeTab !== 'all') {
      filtered = filtered.filter((job) => job.status === activeTab);
    }

    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(
        (job) =>
          job.property_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
          job.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredJobs(filtered);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadJobs();
  }, []);

  const renderTab = (tab: TabType, label: string) => {
    const isActive = activeTab === tab;
    return (
      <TouchableOpacity
        style={[
          styles.tab,
          isActive && { backgroundColor: theme.primary, borderColor: theme.primary },
          !isActive && { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
        onPress={() => setActiveTab(tab)}
      >
        <Text
          style={[
            styles.tabText,
            { color: isActive ? '#FFFFFF' : theme.textSecondary },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          My Jobs
        </Text>

        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.primary }]}
          onPress={() => router.push('/job-detail/job-create')}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.createButtonText}>Create Job</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search by address or ID..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <View style={styles.tabsContainer}>
        {renderTab('all', 'All')}
        {renderTab('pending', 'Pending')}
        {renderTab('completed', 'Completed')}
      </View>

      <FlatList
        data={filteredJobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JobCard
            inspection={item}
            onPress={() => router.push(`/job-detail/${item.inspectionId}`)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: theme.surface }]}>
            <Ionicons name="briefcase-outline" size={64} color={theme.textSecondary} />
            <Text style={[styles.emptyStateText, { color: theme.textSecondary }]}>
              No jobs found
            </Text>
          </View>
        }
      />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },

  createButtonText: {
    color: '#fff',
    marginLeft: 6,
    fontWeight: '600',
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  searchContainer: {
    padding: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    padding: 60,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyStateText: {
    marginTop: 16,
    fontSize: 16,
  },
});
