import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { AppLayout } from '@/layouts/AppLayout';
import { HomeRedirect, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { ImportPage } from '@/features/imports/ImportPage';
import { useAuth } from '@/lib/auth';
import { AppSettingsPage } from '@/features/settings/AppSettingsPage';
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
import { AdjustmentsPage } from '@/features/stocks/AdjustmentsPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { ProcurementsPage } from '@/features/procurements/ProcurementsPage';
import { ProcurementFormPage } from '@/features/procurements/ProcurementFormPage';
import { ProcurementDetailPage } from '@/features/procurements/ProcurementDetailPage';
import { ReceiptsPage } from '@/features/procurements/ReceiptsPage';
import { MutationsPage } from '@/features/mutations/MutationsPage';
import { MutationFormPage } from '@/features/mutations/MutationFormPage';
import { MutationDetailPage } from '@/features/mutations/MutationDetailPage';
import { LoansPage } from '@/features/loans/LoansPage';
import { LoanFormPage } from '@/features/loans/LoanFormPage';
import { LoanDetailPage } from '@/features/loans/LoanDetailPage';
import { MaintenancesPage } from '@/features/maintenances/MaintenancesPage';
import { MaintenanceFormPage } from '@/features/maintenances/MaintenanceFormPage';
import { MaintenanceDetailPage } from '@/features/maintenances/MaintenanceDetailPage';
import { DisposalsPage } from '@/features/disposals/DisposalsPage';
import { DisposalFormPage } from '@/features/disposals/DisposalFormPage';
import { DisposalDetailPage } from '@/features/disposals/DisposalDetailPage';
import { OpnamesPage } from '@/features/opnames/OpnamesPage';
import { OpnameDetailPage } from '@/features/opnames/OpnameDetailPage';
import { OpnameScanPage } from '@/features/opnames/OpnameScanPage';

function Home() {
  const { can } = useAuth();
  return can('dashboard.view') ? <DashboardPage /> : <HomeRedirect />;
}

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
              <Route index element={<Home />} />
              <Route path="/laporan/:key" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
              <Route path="/impor" element={<RequirePermission permission="items.import"><ImportPage /></RequirePermission>} />
              <Route path="/pengaturan/aplikasi" element={<RequirePermission permission="settings.manage"><AppSettingsPage /></RequirePermission>} />
              <Route path="/pengaturan/audit-log" element={<RequirePermission permission="audit.view"><AuditLogPage /></RequirePermission>} />
              <Route path="/barang" element={<RequirePermission permission="items.view"><ItemsPage /></RequirePermission>} />
              <Route path="/aset" element={<RequirePermission permission="assets.view"><AssetsPage /></RequirePermission>} />
              <Route path="/aset/cetak-qr" element={<RequirePermission permission="assets.print_qr"><QrPrintPage /></RequirePermission>} />
              <Route path="/aset/:id" element={<RequirePermission permission="assets.view"><AssetDetailPage /></RequirePermission>} />
              <Route path="/scan" element={<RequirePermission permission="assets.view"><ScanPage /></RequirePermission>} />
              <Route path="/q/:code" element={<RequirePermission permission="assets.view"><QrResolvePage /></RequirePermission>} />
              <Route path="/persediaan/penyesuaian" element={<RequirePermission permission="stock_adjustments.view"><AdjustmentsPage /></RequirePermission>} />
              <Route path="/pengadaan" element={<RequirePermission permission="procurements.view"><ProcurementsPage /></RequirePermission>} />
              <Route path="/pengadaan/baru" element={<RequirePermission permission="procurements.create"><ProcurementFormPage /></RequirePermission>} />
              <Route path="/pengadaan/:id" element={<RequirePermission permission="procurements.view"><ProcurementDetailPage /></RequirePermission>} />
              <Route path="/pengadaan/:id/ubah" element={<RequirePermission permission="procurements.update"><ProcurementFormPage /></RequirePermission>} />
              <Route path="/penerimaan" element={<RequirePermission permission="goods_receipts.view"><ReceiptsPage /></RequirePermission>} />
              <Route path="/mutasi" element={<RequirePermission permission="mutations.view"><MutationsPage /></RequirePermission>} />
              <Route path="/mutasi/baru" element={<RequirePermission permission="mutations.create"><MutationFormPage /></RequirePermission>} />
              <Route path="/mutasi/:id" element={<RequirePermission permission="mutations.view"><MutationDetailPage /></RequirePermission>} />
              <Route path="/mutasi/:id/ubah" element={<RequirePermission permission="mutations.create"><MutationFormPage /></RequirePermission>} />
              <Route path="/peminjaman" element={<RequirePermission permission="loans.view"><LoansPage /></RequirePermission>} />
              <Route path="/peminjaman/baru" element={<RequirePermission permission="loans.create"><LoanFormPage /></RequirePermission>} />
              <Route path="/peminjaman/:id" element={<RequirePermission permission="loans.view"><LoanDetailPage /></RequirePermission>} />
              <Route path="/peminjaman/:id/ubah" element={<RequirePermission permission="loans.create"><LoanFormPage /></RequirePermission>} />
              <Route path="/pemeliharaan" element={<RequirePermission permission="maintenances.view"><MaintenancesPage /></RequirePermission>} />
              <Route path="/pemeliharaan/baru" element={<RequirePermission permission="maintenances.create"><MaintenanceFormPage /></RequirePermission>} />
              <Route path="/pemeliharaan/:id" element={<RequirePermission permission="maintenances.view"><MaintenanceDetailPage /></RequirePermission>} />
              <Route path="/pemeliharaan/:id/ubah" element={<RequirePermission permission="maintenances.create"><MaintenanceFormPage /></RequirePermission>} />
              <Route path="/perbaikan/riwayat" element={<RequirePermission permission="maintenances.view"><MaintenancesPage history /></RequirePermission>} />
              <Route path="/penghapusan" element={<RequirePermission permission="disposals.view"><DisposalsPage /></RequirePermission>} />
              <Route path="/penghapusan/baru" element={<RequirePermission permission="disposals.create"><DisposalFormPage /></RequirePermission>} />
              <Route path="/penghapusan/:id" element={<RequirePermission permission="disposals.view"><DisposalDetailPage /></RequirePermission>} />
              <Route path="/penghapusan/:id/ubah" element={<RequirePermission permission="disposals.create"><DisposalFormPage /></RequirePermission>} />
              <Route path="/penghapusan-riwayat" element={<RequirePermission permission="disposals.view"><DisposalsPage history /></RequirePermission>} />
              <Route path="/opname" element={<RequirePermission permission="stock_opnames.view"><OpnamesPage /></RequirePermission>} />
              <Route path="/opname/:id" element={<RequirePermission permission="stock_opnames.view"><OpnameDetailPage /></RequirePermission>} />
              <Route path="/opname/:id/periksa" element={<RequirePermission permission="stock_opnames.scan"><OpnameScanPage /></RequirePermission>} />
              <Route path="/persetujuan" element={<Navigate to="/persetujuan/menunggu" replace />} />
              <Route path="/persetujuan/menunggu" element={<RequirePermission permission="approvals.view"><ApprovalsPage mode="pending" /></RequirePermission>} />
              <Route path="/persetujuan/riwayat" element={<RequirePermission permission="approvals.view"><ApprovalsPage mode="history" /></RequirePermission>} />
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
