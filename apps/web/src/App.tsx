import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { AppLayout } from '@/layouts/AppLayout';
import { HomeRedirect, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { UsersPage } from '@/features/users/UsersPage';
import { RolesPage } from '@/features/users/RolesPage';
import { MasterPage } from '@/features/master/MasterPage';
import { ItemsPage } from '@/features/items/ItemsPage';
import { AssetsPage } from '@/features/assets/AssetsPage';
import { AssetDetailPage } from '@/features/assets/AssetDetailPage';
import { QrPrintPage } from '@/features/assets/QrPrintPage';
import { ScanPage, QrResolvePage } from '@/features/scan/ScanPage';
import { StocksPage } from '@/features/stocks/StocksPage';
import { StockCardPage } from '@/features/stocks/StockCardPage';

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-lg font-semibold">Halaman tidak ditemukan</h1>
      <p className="mt-1 text-sm text-muted">Alamat yang Anda buka tidak tersedia.</p>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/ganti-password" element={<ChangePasswordPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="/barang" element={<RequirePermission permission="items.view"><ItemsPage /></RequirePermission>} />
              <Route path="/aset" element={<RequirePermission permission="assets.view"><AssetsPage /></RequirePermission>} />
              <Route path="/aset/cetak-qr" element={<RequirePermission permission="assets.print_qr"><QrPrintPage /></RequirePermission>} />
              <Route path="/aset/:id" element={<RequirePermission permission="assets.view"><AssetDetailPage /></RequirePermission>} />
              <Route path="/scan" element={<RequirePermission permission="assets.view"><ScanPage /></RequirePermission>} />
              <Route path="/q/:code" element={<RequirePermission permission="assets.view"><QrResolvePage /></RequirePermission>} />
              <Route path="/persediaan" element={<RequirePermission permission="stocks.view"><StocksPage /></RequirePermission>} />
              <Route path="/persediaan/:itemId" element={<RequirePermission permission="stocks.view"><StockCardPage /></RequirePermission>} />
              <Route path="/pengaturan/pengguna" element={<RequirePermission permission="users.view"><UsersPage /></RequirePermission>} />
              <Route path="/pengaturan/role" element={<RequirePermission permission="roles.view"><RolesPage /></RequirePermission>} />
              <Route path="/master" element={<Navigate to="/master/organizational-units" replace />} />
              <Route path="/master/:resource" element={<RequirePermission permission="master.view"><MasterPage /></RequirePermission>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
        <Toaster position="bottom-right" closeButton richColors={false} />
      </AuthProvider>
    </BrowserRouter>
  );
}
