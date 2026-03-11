import React from 'react';
import { Stack } from 'expo-router';
import { ThemeProvider as NavigationThemeProvider, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { useColorScheme } from 'react-native';
import { AuthProvider } from '../src/context/AuthContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Toast from "react-native-toast-message";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Custom navigation theme based on color scheme
  const navigationTheme = colorScheme === 'dark' ? {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: '#3B82F6',
      background: '#111827',
      card: '#1F2937',
      text: '#F9FAFB',
      border: '#374151',
    },
  } : {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: '#0F52BA',
      background: '#F5F7FA',
      card: '#FFFFFF',
      text: '#1F2937',
      border: '#E5E7EB',
    },
  };

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <ThemeProvider>
        <AuthProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="job-detail/[id]" />
          </Stack>
          <Toast />
          </GestureHandlerRootView>
        </AuthProvider>
      </ThemeProvider>
    </NavigationThemeProvider>
  );
}