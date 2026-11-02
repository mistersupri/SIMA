import { z } from 'zod';

// CSP produksi tidak mengizinkan 'unsafe-eval'. Zod 4 menguji `new Function()` untuk kompilasi JIT;
// dengan jitless pengujian itu dilewati sehingga tidak ada pelanggaran CSP (kinerja validasi form tetap memadai).
z.config({ jitless: true });
