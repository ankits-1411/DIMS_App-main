import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/context/ThemeContext';
import { StatsCard } from '../../src/components/StatsCard';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { activityAPI, inspectionsAPI } from '../../src/services/api';
import { ActivityStats, ChartData, Inspection } from '../../src/types';
import { BarChart } from 'react-native-gifted-charts';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';

export default function ActivityScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [recentCompletions, setRecentCompletions] = useState<Inspection[]>([]);
  const { theme } = useTheme();

  useFocusEffect(
    useCallback(() => {
      loadActivityData();
    }, [])
  );

  const loadActivityData = async () => {
    try {
      const [statsData, chartResponse, inspections] = await Promise.all([
        activityAPI.getStats(),
        activityAPI.getChart(),
        inspectionsAPI.getAssigned(),
      ]);

      setStats(statsData);
      setChartData((chartResponse?.data || []).slice(-14));
      
      const mappedInspections: Inspection[] = (inspections || []).map((item: any) => ({
        id: item._id ?? item._id ?? "",
        distance: item.distance ?? "",
        inspectionId: item.inspectionId ?? item.inspectionId ?? "",
        property_address: item.propertyAddress ?? "",
        status: item.status ?? "pending",
        created_date: item.createdDate ?? item.createdAt ?? "",
        completed_date: item.completedDate ?? "",
        inspector_name: item.assignedTo ?? "",
        photos: Array.isArray(item.photos) ? item.photos : [],
        inspectionMapImages: Array.isArray(item.inspectionMapImages) ? item.inspectionMapImages : [],
        dealname: item.dealname ?? "",
      }));

      const completed = mappedInspections
        .filter(i => i.status === "completed")
        .sort((a, b) =>
          new Date(b.completed_date || b.created_date).getTime() -
          new Date(a.completed_date || a.created_date).getTime()
        )
        .slice(0, 5);

      setRecentCompletions(completed);
    } catch (error) {
      console.error('Error loading activity:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadActivityData();
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Activity</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Summary Stats</Text>
          <View style={styles.statsGrid}>
            <StatsCard
              title="Total Inspections"
              value={stats?.total_inspections || 0}
              color={theme.primary}
              style={styles.statsCard}
            />
            <StatsCard
              title="This Week"
              value={stats?.this_week || 0}
              color={theme.success}
              style={styles.statsCard}
            />
            <StatsCard
              title="This Month"
              value={stats?.this_month || 0}
              color={theme.info}
              style={styles.statsCard}
            />
            <StatsCard
              title="Daily Average"
              value={stats?.daily_average || 0}
              color={theme.warning}
              style={styles.statsCard}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Last 14 Days</Text>
          <View style={[styles.chartContainer, { backgroundColor: theme.surface }]}>
            {chartData.length > 0 ? (
              <BarChart
                data={chartData.map((item) => ({
                  value: item.count,
                  label: new Date(item.date).getDate().toString(),
                }))}
                barWidth={20}
                barBorderRadius={4}
                frontColor={theme.primary}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={theme.border}
                noOfSections={4}
                yAxisTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
                spacing={15}
              />
            ) : (
              <Text style={[styles.noData, { color: theme.textSecondary }]}>No activity data</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Recent Completions</Text>
          {recentCompletions.length > 0 ? (
            recentCompletions.map((inspection) => (
              <View
                key={inspection.id}
                style={[styles.completionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={styles.completionHeader}>
                  <Ionicons name="checkmark-circle" size={24} color={theme.success} />
                  <View style={styles.completionInfo}>
                    <Text style={[styles.completionId, { color: theme.textSecondary }]}>
                      {inspection.dealname || `#${inspection.id.slice(0, 8)}`}
                    </Text>
                    <Text style={[styles.completionAddress, { color: theme.text }]} numberOfLines={1}>
                      {inspection.property_address}
                    </Text>
                    <Text style={[styles.completionDate, { color: theme.textSecondary }]}>
                      {format(new Date(inspection.completed_date || inspection.created_date), 'MMM dd, yyyy • HH:mm')}
                    </Text>
                  </View>
                  {inspection.photos && inspection.photos.length > 0 && (
                    <View style={styles.photoCount}>
                      <Ionicons name="camera" size={16} color={theme.textSecondary} />
                      <Text style={[styles.photoCountText, { color: theme.textSecondary }]}>
                        {inspection.photos.length}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          ) : (
            <View style={[styles.emptyState, { backgroundColor: theme.surface }]}>
              <Ionicons name="time-outline" size={48} color={theme.textSecondary} />
              <Text style={[styles.emptyStateText, { color: theme.textSecondary }]}>
                No completed inspections yet
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
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statsCard: {
    flex: 1,
    minWidth: '47%',
  },
  chartContainer: {
    padding: 16,
    borderRadius: 16,
  },
  noData: {
    textAlign: 'center',
    padding: 24,
  },
  completionCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  completionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  completionInfo: {
    flex: 1,
  },
  completionId: {
    fontSize: 12,
    marginBottom: 4,
  },
  completionAddress: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  completionDate: {
    fontSize: 12,
  },
  photoCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  photoCountText: {
    fontSize: 12,
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
