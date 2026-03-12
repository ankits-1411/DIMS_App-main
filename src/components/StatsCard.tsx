import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon?: string;
  color?: string;
  style?: ViewStyle;
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, color, style }) => {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}
    >
      <View style={styles.content}>
        <Text
          style={[styles.title, { color: theme.textSecondary }]}
          numberOfLines={1}
  adjustsFontSizeToFit
        >
          {title}
        </Text>

        <Text style={[styles.value, { color: color || theme.primary }]}>
          {value}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    flexShrink: 1,
  },
  value: {
    fontSize: 32,
    fontWeight: 'bold',
  },
});