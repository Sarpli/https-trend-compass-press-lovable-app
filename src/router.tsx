import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteSkeleton } from "./components/RouteSkeleton";

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
