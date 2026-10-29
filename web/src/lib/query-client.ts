import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

// RAM-only cache. networkMode "always": localhost works even when the browser says offline.
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status < 500),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      // Sends/AI never retry or resume on their own.
      mutations: { networkMode: "always", retry: false },
    },
  });
}
