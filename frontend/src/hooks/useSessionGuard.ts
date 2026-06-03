import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { api } from "../api/client";

/**
 * Called once on app mount.
 * - If admin token exists → validates it with /api/auth/me
 * - If expired/invalid   → clears store and redirects to /admin/login
 * - If on admin route without token → redirects to /admin/login
 */
export function useSessionGuard() {
  const { admin, logout } = useAuthStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const checked   = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    const isAdminRoute = location.pathname.startsWith("/admin");
    const token        = localStorage.getItem("access_token");

    if (!isAdminRoute) return; // cabinet / landing don't need admin auth check

    if (!token || !admin) {
      if (location.pathname !== "/admin/login") {
        navigate("/admin/login", { replace: true });
      }
      return;
    }

    // Validate token with server
    api.get("/auth/me")
      .then(({ data }) => {
        // Token valid — update store if role/name changed
        useAuthStore.getState().setAdmin(
          data,
          localStorage.getItem("access_token")!,
          localStorage.getItem("refresh_token")!,
        );
      })
      .catch(() => {
        // Token expired or invalid — clear and redirect
        logout();
        navigate("/admin/login", { replace: true });
      });
  }, []); // eslint-disable-line
}
