# Laporan Rilis Prototype V1

Tanggal: 2026-10-14. Klasifikasi: `PROTOTYPE_V1_PARTIAL`. Semua status memakai nilai pasti: `PASS`, `FAIL`, `BLOCKED_BY_DATA`, `BLOCKED_BY_AUTHORIZATION`, `BLOCKED_BY_ENVIRONMENT`, `NOT_RUN`, `NOT_VERIFIED`. Tidak ada `PASS` tanpa bukti yang benar-benar dijalankan.

## Ringkasan

- Branch: `prototype-v1` (PRIVATE) di `https://github.com/Justindwinata/TRANSUMIN-NEXUS.git`.
- HEAD lokal = remote: `31772e2ddc0ba7815e20a4bc9babab56cd14c922`.
- Commit checkpoint ini: `06fa181` (G1 lineage/guard), `a40c19b` (pengerasan G1/G2 + bukti F-03), `31772e2` (G4 LEVEL 1 + rerun terintegrasi G5).
- Pohon kerja bersih setelah push. Tanpa force-push, tanpa tulis ulang riwayat, tanpa penghapusan destruktif.
- Runtime uji: API `127.0.0.1:3001`, proxy web `127.0.0.1:3000`, OTP `2.10.0` `127.0.0.1:8080`, snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, tanggal layanan `2026-10-02`, zona `Asia/Jakarta`.
- Database produk `127.0.0.1:5435/transum_in_nexus_product` tidak diubah oleh harness isolasi; setiap DB scratch milik invokasi dihapus dengan `DROP_SUCCESS`.

## Status per gate

| Gate                                            | Status                     | Bukti yang dijalankan                                           | Kode keluar / jumlah                      |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| G1-B lineage/konkurensi/expiry (Tier A isolasi) | `PASS` (subset)            | `pnpm --filter @transum-in/api data:lightweight-acceptance`     | exit 0; 12/12; `DROP_SUCCESS`             |
| G1-D peta/timeline/navigasi + stale race        | `PASS` (subset)            | `pnpm --filter @transum-in/api data:cp3:recovery`               | exit 0; `DROP_SUCCESS`                    |
| G1-C sesi bertanda tangan                       | `PASS`                     | `g1-session-security.test.mjs` + `g1-recovery-guards.test.mjs`  | exit 0; 11/11                             |
| G1 matriks tepi penuh                           | `NOT_VERIFIED`             | —                                                               | —                                         |
| G2 preferensi (4 preferensi)                    | `PASS`                     | `node apps/web/scripts/passenger-g2-preferences-acceptance.mjs` | exit 0; 3 kandidat; `distinct_winners: 2` |
| G2 siklus GPS                                   | `PASS`                     | `node apps/web/scripts/passenger-gps-browser-acceptance.mjs`    | exit 0                                    |
| G3 alamat ketik                                 | `BLOCKED_BY_AUTHORIZATION` | `docs/delivery/G3-GEOCODING-AUTHORIZATION-REQUEST.md`           | —                                         |
| G3 fallback pin/insiden                         | `PASS`                     | `r4-f01-f02`, `passenger-report-m5-acceptance.mjs`              | exit 0; 22/22 (m5)                        |
| G4 handoff LEVEL 0/1 + salin tujuan             | `PASS`                     | `node apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs` | exit 0; `coordinates_in_dom=false`        |
| G5 alur penuh 20 langkah (V20/S14)              | `PASS`                     | `node apps/web/scripts/passenger-r1-full-workflow.mjs`          | exit 0; 20/20                             |
| G5 terintegrasi M7                              | `PASS`                     | `node apps/web/scripts/passenger-integrated-m7-acceptance.mjs`  | exit 0; 20/20                             |
| Gerbang mutu                                    | `PASS`                     | `pnpm check`                                                    | exit 0                                    |
| Pemindaian rahasia                              | `PASS`                     | `pnpm security:scan`                                            | exit 0; 369 terlacak, 13 klien            |

Bukti tambahan seri ini: integrasi standar 9 suite / 31 tes exit 0; unit web 40/40; unit API 109/109 (seri sebelumnya 106/106); navigasi R4-F04 exit 0.

## G1 — detail yang diverifikasi

- Lineage generasi: `baseRecoveryId` disimpan saat proposal dibuat dan `predecessorRecoveryId` disimpan sebagai garis keturunan penerimaan; `recoveryId` stabil memuat sumber generasi.
- `accept()` atomik: serialisasi lewat kunci baris, penjaga `accepted_recovery_id` = basis proposal, penjaga `progress.revision`, tanpa `COALESCE`, `progress.revision` tidak naik buta.
- Ketahanan browser: proposal terlambat diabaikan setelah remount (tanpa mutasi), respons penerimaan yang hilang direkonsiliasi dari baca server otoritatif dengan tepat satu POST, riwayat WALK selesai tidak berubah, paritas digest peta dan urutan/sidik jari timeline antar generasi eksak.
- Sesi: format `owner.expiry.HMAC`, batas TTL, perbandingan konstan-waktu, gagal-tertutup sebelum permintaan ke hulu; umur kedaluwarsa yang dirusak, format lama, dan pergantian pemilik ditolak.
- Sisa: varian struktur sisa-perjalanan lain, fallback hanya skematis, `walking_steps` rusak, kedaluwarsa sesi pasca-rotasi di jalur browser, dan koridor browser dua-recovery: `NOT_VERIFIED`.

## G2 — detail yang diverifikasi

- `FASTEST` memilih durasi minimum, `LEAST_WALKING` jarak jalan minimum, `FEWEST_TRANSFERS` jumlah transit minimum; `BALANCED` dihitung ulang persis min-max 0.5/0.3/0.2 dengan pemenang = argmin.
- Perpindahan cepat berakhir pada preferensi terakhir (`FASTEST`); permintaan identik berulang menghasilkan peringkat identik.
- Keragaman tidak direkayasa: kasus pemenang identik dan kandidat tunggal dicatat apa adanya.

## G4 — detail yang diverifikasi

- Tautan resmi hanya beranda (HTTPS, `noopener noreferrer`, host statis, tanpa query/path pengalihan); tidak ada tautan dalam/API mitra, tidak ada klaim ketersediaan/tarif/pemesanan.
- Tombol "Salin tujuan" menyalin konteks tujuan (nama + koordinat) ke papan klip hanya setelah aksi pengguna; koordinat tidak pernah tampil di DOM; ada pesan jujur bila penyalinan diblokir.

## Blocker jujur (tidak diubah)

- Alamat ketik: `BLOCKED_BY_AUTHORIZATION` (tanpa penyedia/geocoder resmi; tanpa Nominatim publik).
- Integrasi penyedia pihak ketiga (ketersediaan/tarif/ETA/pemesanan/deep link): `BLOCKED_BY_DATA`/`BLOCKED_BY_AUTHORIZATION`.
- POI bernama Kemang Village/Lippo Mall Kemang (V01/S01): `BLOCKED_BY_DATA`.
- Validasi pejalan kaki V15/S11 dan handoff penuh V16/S12: `BLOCKED_BY_DATA`.
- Snapshot penuh Tier B: `BLOCKED_BY_ENVIRONMENT`.
- GPS perangkat nyata: `NOT_VERIFIED` (geolokasi otomatis `SIMULATED`).
- S09 `NO_PATH`/`NO_VALID_ALTERNATIVE`: `NOT_VERIFIED` (exit 1; OTP mengembalikan alternatif jalan + TransJakarta asli).

## Batas keselamatan dan kepatuhan

- Build sumber-sumber saja: `.env`, `.next*`, `dist`, cache, data, dan artefak runtime tidak pernah diunggah. Cocok cache dev Turbopack yang terabaikan (`CONTROLLED_REVIEW_TOKEN`, `POSTGRES_PASSWORD`) dieksklusi dan tidak boleh dipublikasikan.
- Sesi prototipe dan isolasi pemilik bukan penerimaan autentikasi produksi.
- Data bersintetis/terkendali selalu berlabel `SIMULATED`; laporan penumpang tetap `REPORTED_UNVERIFIED` sampai tinjauan terkendali (`≠` VERIFIED).

## Perintah reproduksi

```sh
pnpm check
pnpm security:scan
pnpm --filter @transum-in/api data:lightweight-acceptance
pnpm --filter @transum-in/api data:cp3:recovery
node apps/web/scripts/passenger-g2-preferences-acceptance.mjs
node apps/web/scripts/passenger-gps-browser-acceptance.mjs
node apps/web/scripts/passenger-r4-f01-f02-acceptance.mjs
node apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs
node apps/web/scripts/passenger-report-m5-acceptance.mjs
node apps/web/scripts/passenger-r1-full-workflow.mjs
node apps/web/scripts/passenger-integrated-m7-acceptance.mjs
```

## Langkah berikutnya yang diotorisasi

1. Jalankan matriks tepi G1 penuh pada scratch isolasi bila diotorisasi (varian struktur, fallback skematis, langkah rusak, kedaluwarsa sesi pasca-rotasi, koridor dua-recovery).
2. Sediakan keputusan penyedia geocoding (G3) dan penyedia mobilitas (G4/V16) sebelum memperluas.
3. Pertahankan branch `prototype-v1` PRIVATE; setiap perubahan berikutnya lewat commit kecil terverifikasi tanpa force-push.
