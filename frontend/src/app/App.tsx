import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toasts } from '@/components/Toasts';
import { createQueryClient } from './queryClient';
import { SceneSearchPage } from '@/pages/SceneSearchPage';

// Workspace pages carry the camera grid and the Rerun viewer; load them only when needed.
const SceneWorkspacePage = lazy(() => import('@/pages/SceneWorkspacePage'));
const SceneComparePage = lazy(() => import('@/pages/SceneComparePage'));

const loading = <div className="page-state" role="status"><span className="spin" aria-hidden="true" /></div>;

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/scenes" replace /> },
  { path: '/scenes', element: <SceneSearchPage /> },
  { path: '/scenes/:sceneId', element: <Suspense fallback={loading}><SceneWorkspacePage /></Suspense> },
  { path: '/compare', element: <Suspense fallback={loading}><SceneComparePage /></Suspense> },
  { path: '*', element: <Navigate to="/scenes" replace /> },
]);

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toasts />
    </QueryClientProvider>
  );
}
