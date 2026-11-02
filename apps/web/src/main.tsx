import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  // networkMode 'always': saat offline permintaan tetap dicoba dan gagal cepat (ApiError 0), bukan menggantung menunggu jaringan.
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, networkMode: 'always' }, mutations: { networkMode: 'always' } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker menyimpan shell aplikasi agar dapat dibuka tanpa jaringan. Pembaruan dipasang otomatis.
registerSW({ immediate: true });
