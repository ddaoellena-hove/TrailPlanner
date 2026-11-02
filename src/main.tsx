import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AppHeader } from '@/components/AppHeader';
import { TripPage } from '@/pages/TripPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { TripsPage } from '@/pages/TripsPage';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppHeader />
          <Routes>
            <Route path="/" element={<TripsPage />} />
            <Route path="/voyages/:slug" element={<TripPage />} />
            <Route path="/randos" element={<LibraryPage />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
