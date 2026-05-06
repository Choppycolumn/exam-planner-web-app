import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { initializeDefaultData } from './db/seed';
import { router } from './router/AppRouter';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeDefaultData().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">正在准备本地学习数据库...</div>;
  }

  return <RouterProvider router={router} />;
}
