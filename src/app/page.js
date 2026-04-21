'use client';

import { useEffect } from 'react';
import { useApp } from './providers/AppProvider';
import Landing from '@/modules/landing/Landing';
import Scan from '@/modules/scan/Scan';
import Processing from '@/modules/processing/Processing';

export default function Home() {
  const { appState } = useApp();

  useEffect(() => {
    console.log('App state changed:', appState.currentScreen);
  }, [appState]);

  return (
    <main className="min-h-screen bg-ppg-900">
      {appState.currentScreen === 'landing' && <Landing />}
      {appState.currentScreen === 'scan' && <Scan />}
      {appState.currentScreen === 'processing' && <Processing />}
    </main>
  );
}
