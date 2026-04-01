export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface Inspection {
  currentLocationImage: string | undefined;
  id: string;
  distance: string,
  dealname: string;
  inspectionId: string,
  inspectionMapImages: string[];
  property_address: string;
  status: 'pending' | 'completed';
  assigned_to?: string;
  assigned_to_email?: string;
  created_date: string;
  completed_date?: string;
  photos: string[];
  notes?: string;
  gps_coordinates?: {
    lat: number;
    lng: number;
  };
  inspector_name: string;
}

export type DashboardStats = {
  totalInspections: number;
  completedInspections: number;
  pendingInspections: number;
  completedThisWeek: number;
  completedThisMonth: number;
  averagePerDay: number;
  cancelledInspections: number;

  dailyActivity?: {
    _id: string;
    count: number;
  }[];

  recentCompleted?: any[];
  recentPending?: any[];
};

export interface ActivityStats {
  total_inspections: number;
  this_week: number;
  this_month: number;
  daily_average: number;
}

export interface ChartData {
  date: string;
  count: number;
}

export interface ProfileData {
  user: User;
  stats: {
    total_inspections: number;
    completed_inspections: number;
    pending_inspections: number;
  };
}