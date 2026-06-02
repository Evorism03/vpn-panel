import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminInfo {
  id: string;
  username: string;
  display_name: string;
  role: string;
}

interface AuthState {
  admin: AdminInfo | null;
  setAdmin: (admin: AdminInfo, access: string, refresh: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      admin: null,
      setAdmin: (admin, access, refresh) => {
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);
        set({ admin });
      },
      logout: () => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        set({ admin: null });
      },
    }),
    { name: "vpn-auth", partialize: (s) => ({ admin: s.admin }) }
  )
);
