import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteSkeleton } from "./components/RouteSkeleton";
import { installChunkRetry } from "./lib/chunk-retry";

// Handle stale chunk imports after deploys: a fresh build invalidates old
// hashed JS chunks, so route lazy-imports fail with "Importing a module
// script failed." Reload once (guarded via sessionStorage) to pick up the
// new asset manifest instead of leaving the user on a blank page.
installChunkRetry();

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RouteSkeleton,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  });

  return router;
};
