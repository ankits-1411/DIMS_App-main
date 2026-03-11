import * as SecureStore from "expo-secure-store";
import { ActivityStats, DashboardStats, Inspection, User } from '../types';

import axios from "axios";

const BASE_URL = "http://3.12.73.118:3001/api";

// Mock Data
const MOCK_USER: User = {
  id: 'user-123',
  email: 'user@gmail.com',
  name: 'Test User',
  phone: '123-456-7890',
  role: 'inspector'
};

interface LoginResponse {
  token: string;
  user: User;
}

// Auth API
export const authAPI = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    try {
      const response = await axios.post<LoginResponse>(
        `${BASE_URL}/users/login`,
        {
          email,
          password,
        }
      );

      if (response.data.user?.role !== "user") {
        throw new Error("Access denied. Only users can login.");
      }

      return response.data; // token + user returned to AuthContext
    } catch (error: any) {
      if (!error?.isAxiosError) {
      throw error;
    }

    const message =
      error?.response?.data?.message ||
      "Login failed";

    throw new Error(message);
    }
  },
  register: async (data: { email: string; password: string; name: string; phone?: string }) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      message: 'User created successfully',
      user: {
        id: `user-${Date.now()}`,
        ...data,
        role: 'inspector'
      }
    };
  },
};

// Inspections API
export const inspectionsAPI = {
  getAssigned: async (): Promise<Inspection[]> => {
  try {
    const token = await SecureStore.getItemAsync("authToken");

    const response = await axios.get<Inspection[]>(
      `${BASE_URL}/inspections`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.log("Get assigned inspections error:", error?.response?.data);

    throw new Error(
      error?.response?.data?.message || "Failed to fetch inspections"
    );
  }
},
  getById: async (id: string): Promise<any> => {
  try {
    const token = await SecureStore.getItemAsync("authToken");
    const response = await axios.get(`${BASE_URL}/inspections/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const item = response.data?.data ?? response.data;

    if (!item) {
      throw new Error("Inspection not found");
    }

    return {
      id: item._id ?? item.inspectionId ?? "",
      distance:
        typeof item.distance === "number"
          ? item.distance
          : item.distance
          ? Number(item.distance)
          : null,

      property_address: item.propertyAddress ?? "",
      inspectionMapImages: Array.isArray(item.inspectionMapImages) ? item.inspectionMapImages : [],
      status: item.status ?? "pending",
      created_date: item.createdDate ?? item.createdAt ?? "",
      completed_date: item.completedDate ?? "",
      inspector_name: item.assignedTo ?? "",
      inspectionId: item.inspectionId ?? "",
      photos: Array.isArray(item.photos) ? item.photos : [],
      notes: item.notes ?? "",
      gps_coordinates: item.gpsCoordinates ?? null,
      assigned_to: item.assignedToId?._id ?? "",
      assigned_to_email: item.assignedToId?.email ?? "",
    };
  } catch (error: any) {
    console.log("Get inspection error FULL:", error);
    console.log("Get inspection error DATA:", error?.response?.data);

    throw new Error(
      error?.response?.data?.message || "Inspection not found"
    );
  }
},
  create: async (data: any): Promise<Inspection> => {
    try {
      const token = await SecureStore.getItemAsync("authToken");
      console.log("Creating inspection with data:", data);

      const response = await axios.post(
        `${BASE_URL}/inspections`,
        data,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const item = response.data?.data ?? response.data;

      if (!item) {
        throw new Error("Invalid response from server");
      }

      return {
        id: item._id ?? item.inspectionId ?? "",
        inspectionMapImages: Array.isArray(item.inspectionMapImages) ? item.inspectionMapImages : [],
        inspectionId: item.inspectionId ?? "",
        property_address: item.propertyAddress ?? "",
        status: item.status ?? "pending",
        created_date: item.createdDate ?? item.createdAt ?? "",
        completed_date: item.completedDate ?? "",
        inspector_name: item.assignedTo ?? "",
        photos: Array.isArray(item.photos) ? item.photos : [],
        notes: item.notes ?? "",
        gps_coordinates: item.gpsCoordinates ?? null,
        assigned_to: item.assignedToId?._id ?? "",
        assigned_to_email: item.assignedToId?.email ?? "",
        distance:
          typeof item.distance === "number"
            ? item.distance
            : null,
      };
    } catch (error: any) {
      console.log("Create inspection error:", error?.response?.data);
      throw new Error(
        error?.response?.data?.message || "Failed to create inspection"
      );
    }
  },
  uploadInspectionPhotos: async (
  inspectionId: string,
  formData: FormData
) => {
  const token = await SecureStore.getItemAsync("authToken");
  return axios.post(
    `${BASE_URL}/inspections/${inspectionId}/photos`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${token}`,
      },
    }
  );
},
  updateNotes: async (id: string, notes: string) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return { message: 'Notes updated' };
  },
  complete: async (id: string, gps_coordinates?: { lat: number; lng: number }) => {
    try {
      const token = await SecureStore.getItemAsync("authToken");
      const response = await axios.patch(`${BASE_URL}/inspections/${id}/complete`, 
        { gps_coordinates },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.data;
    } catch (error: any) {
      console.log("Complete inspection error:", error?.response?.data);
      throw new Error(
        error?.response?.data?.message || "Failed to complete inspection"
      );
    }
  },
  getPDF: async (id: string) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' };
  },

getDashboardStats: async (): Promise<DashboardStats> => {
  try {
    const token = await SecureStore.getItemAsync("authToken");

    const response = await axios.get<DashboardStats>(
      `${BASE_URL}/users/dashboard/stats`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.log("Dashboard stats error:", error?.response?.data);

    throw new Error(
      error?.response?.data?.message || "Failed to fetch dashboard stats"
    );
  }
},
};

// Activity API
export const activityAPI = {
getStats: async (): Promise<ActivityStats> => {
  try {
    const token = await SecureStore.getItemAsync("authToken");
    const response = await axios.get(`${BASE_URL}/inspections`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

    const inspections = response.data?.data || response.data || [];

    if (!Array.isArray(inspections)) {
      console.log("Invalid inspections format");
      return {
        total_inspections: 0,
        this_week: 0,
        this_month: 0,
        daily_average: 0,
      };
    }

    const now = new Date();

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const total = inspections.length;

    const thisWeek = inspections.filter((item: any) => {
      const date = new Date(item.completedDate || item.createdDate);
      return date >= startOfWeek;
    }).length;

    const thisMonth = inspections.filter((item: any) => {
      const date = new Date(item.completedDate || item.createdDate);
      return date >= startOfMonth;
    }).length;

    const dailyAverage = total ? Number((total / 30).toFixed(1)) : 0;

    return {
      total_inspections: total,
      this_week: thisWeek,
      this_month: thisMonth,
      daily_average: dailyAverage,
    };

  } catch (error) {
    console.log("Activity stats error:", error);
    return {
      total_inspections: 0,
      this_week: 0,
      this_month: 0,
      daily_average: 0,
    };
  }
},
 getChart: async () => {
  try {
    const inspections = await inspectionsAPI.getAssigned();

    const completed = inspections.filter((i: any) => i.status === "completed");

    // group last 7 days
    const last7: Record<string, number> = {};

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      last7[key] = 0;
    }

    completed.forEach((item: any) => {
      if (!item.completedDate) return;
      const key = new Date(item.completedDate).toISOString().split("T")[0];
      if (last7[key] !== undefined) {
        last7[key]++;
      }
    });

    return {
      data: Object.entries(last7).map(([date, count]) => ({
        date,
        count,
      })),
    };

  } catch (error) {
    console.log("Chart compute error:", error);
    return { data: [] };
  }
},
};

// Profile API
export const profileAPI = {
  getProfile: async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      user: MOCK_USER,
      stats: {
        total_inspections: 150,
        completed_inspections: 140,
        pending_inspections: 10,
      }
    };
  },
};

const api = {
    // Minimal mock for default export
};

export default api;
