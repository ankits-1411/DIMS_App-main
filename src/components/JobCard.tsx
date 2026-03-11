import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Inspection } from '../types';

interface JobCardProps {
  inspection: Inspection;
  onPress: () => void;
}

export const JobCard: React.FC<JobCardProps> = ({ inspection, onPress }) => {
  const { theme } = useTheme();

  const getStatusColor = () => {
    return inspection.status === 'completed' ? theme.success : theme.warning;
  };

  const getStatusBadgeStyle = () => ({
    backgroundColor: inspection.status === 'completed' ? theme.success + '20' : theme.warning + '20',
    borderColor: getStatusColor(),
  });
  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="home-outline" size={20} color={theme.primary} />
          <Text style={[styles.id, { color: theme.textSecondary }]} numberOfLines={1}>
            {(inspection.dealname || "#" + inspection.id || "").toString().slice(0, 8)}
          </Text>
        </View>
        <View style={[styles.badge, getStatusBadgeStyle()]}>
          <Text style={[styles.badgeText, { color: getStatusColor() }]}>
            {inspection.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={[styles.address, { color: theme.text }]} numberOfLines={2}>
        {inspection.property_address}
      </Text>

      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.footerText, { color: theme.textSecondary }]}>
            {inspection.created_date
              ? format(new Date(inspection.created_date), "dd MMM yyyy")
              : "N/A"}
          </Text>
        </View>

        {inspection.photos && inspection.photos.length > 0 && (
          <View style={styles.footerItem}>
            <Ionicons name="camera-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.footerText, { color: theme.textSecondary }]}>
              {inspection.photos.length} photos
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  id: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  address: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
  },
});