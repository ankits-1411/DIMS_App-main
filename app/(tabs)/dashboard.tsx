import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { StatsCard } from '../../src/components/StatsCard';
import { JobCard } from '../../src/components/JobCard';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { inspectionsAPI, activityAPI } from '../../src/services/api';
import { Inspection, DashboardStats, ChartData } from '../../src/types';
import { BarChart } from 'react-native-gifted-charts';
import { useFocusEffect } from '@react-navigation/native';

export default function DashboardScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<Inspection[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const { user } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [])
  );

  const screenWidth = Dimensions.get('window').width;
  const loadDashboardData = async () => {
    console.log("DASHBOARD FUNCTION CALLED");
    try {
      const [statsData, inspections, activityData] = await Promise.all([
        inspectionsAPI.getDashboardStats(),
        inspectionsAPI.getAssigned(),
        activityAPI.getChart(),
      ]);

      setStats({
        totalInspections: statsData.totalInspections,
        completedInspections: statsData.completedInspections,
        pendingInspections: statsData.pendingInspections,
        completedThisWeek: statsData.completedThisWeek,
        completedThisMonth: statsData.completedThisMonth,
        averagePerDay: statsData.averagePerDay,
        cancelledInspections: statsData.cancelledInspections,
      });

      const mappedInspections: Inspection[] = (inspections || []).map((item: any) => ({
        id: item._id || '',
        inspectionId: item.inspectionId || '',
        property_address: item.propertyAddress || '',
        status: item.status || 'pending',
        created_date: item.createdDate || item.createdAt || '',
        completed_date: item.completedDate || '',
        inspector_name: item.assignedToId?.name || '',
        photos: item.photos || [],
        distance: item.distance || 0,
        inspectionMapImages: item.inspectionMapImages || [],
        dealname: item.dealname || '',
      }));

      setRecentJobs(
        mappedInspections
          .filter(i => i.status === 'pending')
          .slice(0, 3)
      );
      setChartData(activityData.data.slice(-7));
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDashboardData();
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View>
          <Text style={[styles.greeting, { color: theme.textSecondary }]}>Welcome back,</Text>
          <Text style={[styles.userName, { color: theme.text }]}>{user?.name || 'Inspector'}</Text>
        </View>
        {/* <Ionicons name="notifications-outline" size={24} color={theme.text} /> */}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Overview</Text>
          <View style={styles.statsGrid}>
            <StatsCard
              title="Total Jobs"
              value={stats?.totalInspections || 0}
              color={theme.info}
              style={styles.statsCard}
            />
            <StatsCard
              title="Completed"
              value={stats?.completedInspections || 0}
              color={theme.success}
              style={styles.statsCard}
            />
            <StatsCard
              title="Pending"
              value={stats?.pendingInspections || 0}
              color={theme.warning}
              style={styles.statsCard}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Weekly Activity</Text>
          <View style={[styles.chartContainer, { backgroundColor: theme.surface }]}>
            {chartData.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                width={screenWidth - 72} // 20 padding + 20 padding + 16 chart padding + margin adjust
                data={chartData.map((item) => ({
                  value: item.count,
                  label: new Date(item.date).getDate().toString(),
                }))}
                barWidth={22}
                spacing={18}
                barBorderRadius={4}
                frontColor={theme.primary}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={theme.border}
                noOfSections={4}
                yAxisTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
              />
              </ScrollView>
            ) : (
              <Text style={[styles.noData, { color: theme.textSecondary }]}>No activity data</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Pending Jobs</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/jobs')}>
              <Text style={[styles.seeAll, { color: theme.primary }]}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <JobCard
                key={job.id}
                inspection={job}
                onPress={() => router.push(`/job-detail/${job.inspectionId}`)}
              />
            ))
          ) : (
            <View style={[styles.emptyState, { backgroundColor: theme.surface }]}>
              <Ionicons name="checkmark-circle-outline" size={48} color={theme.success} />
              <Text style={[styles.emptyStateText, { color: theme.textSecondary }]}>
                No pending jobs
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
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
    padding: 20,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 14,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  statsCard: {
    width: '31%',
  },
  chartContainer: {
    padding: 16,
    borderRadius: 16,
    marginTop: 12,
  },
  noData: {
    textAlign: 'center',
    padding: 24,
  },
  emptyState: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyStateText: {
    marginTop: 12,
    fontSize: 14,
  },
});
