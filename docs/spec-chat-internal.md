# RetailPro — Chat Internal Tenant (DM + channel, mention @ dan #, polling)

| | |
|---|---|
| Dokumen | `docs/spec-chat-internal.md` |
| Status | **Shipped** — schema v11, jalur baca/tulis lewat `src/lib/chat.ts` (diverifikasi 2026-11-18) |
| Tanggal | 2026-11-17 |
| Skema | migrasi `011`, schema version 10 → **11** — ** empat tabel baru sepenuhnya aditif**, tidak ada `ALTER` pada tabel lama |
| Batas kepercayaan | visibilitas channel/DM adalah **aturan produk/UI, bukan batas keamanan** — tidak ada row-level security di data tenant |

> **Catatan status (2026-11-17).** Dokumen ini adalah catatan desain pada satu titik waktu dan
> dibekukan. Semuanya ada di kode: `src/lib/chat-mentions.ts` (codec mention murni, teruji),
> `src/lib/chat.ts` (satu-satunya modul akses data chat), `src/hooks/use-chat.ts` (react-query +
> polling + optimistic append), `src/components/chat/` + `src/pages/Chat.tsx` (layar tiga panel),
> kunci izin `use_chat`/`manage_channels` di `src/config/roles.ts`, dan rute `/backoffice/chat`
> di `src/App.tsx` + `src/components/layout/nav-items.ts`. Dibuktikan `src/lib/chat-mentions.test.ts`
> dan blok chat pada `src/lib/db/__tests__/schema.test.ts`.

---

## 0. Ringkasan

Pemilik dan karyawan saling mengobrol di dalam satu tenant lewat layar bernuansa Slack: **Direct
Message** satu-satu dan **Channel** bernama. Di dalam pesan, `@` menyebut **orang** dan `#`
menyebut **produk / invoice / purchase order / vendor** sebagai chip yang bisa diklik ke recordnya.

Fitur ini hidup sepenuhnya di sisi klien. SPA membaca dan menulis **langsung** ke database Turso
tenant lewat `src/lib/db` (`query`/`runTransaction`/`batchQuery`) memakai token jangka pendek —
tidak ada application server di jalur data. Karena itu "backend" chat adalah sebuah modul data-access
klien (`src/lib/chat.ts`), mengikuti pola satu-implementasi yang sudah dipakai `stock-movement.ts`
dan `vendor-catalog.ts`. Tidak ada endpoint `api/` atau `server/` baru, tidak ada dependensi baru,
dan tidak ada perubahan CSP: `vercel.json` sudah membolehkan `https://*.turso.io` dan `wss://*.turso.io`.

Ruang lingkup yang dikunci: **DM + channel**, **real-time = polling**, **mention `@` dan `#` saja**.
Ditangguhkan dengan titik perpanjangan bersih: reaksi, thread, lampiran berkas, read-receipt/badge
belum dibaca, presence, notifikasi, dan full-text search.

---

## 1. Keputusan (dikunci sebelum implementasi)

1. **Polling, bukan push.** Arsitektur serverless + Turso-direct tidak punya kanal push. Menambah
   WebSocket/SSE berarti infrastruktur baru + fungsi Vercel + pelonggaran CSP untuk manfaat marginal
   pada skala organisasi kecil. Polling reaktif lewat `refetchInterval` memadai dan nol biaya infra.
2. **Label terbaca + baris mention terstruktur**, bukan token di dalam body. Composer menyisipkan teks
   apa adanya (`@Budi`, `#Kopi ABC`) ke textarea polos sehingga body tetap terbaca dan bisa dicari;
   referensi terstruktur (`kind`, `entity_id`, `label`) disimpan sebagai baris `chat_mentions`.
3. **Snapshot label.** `chat_mentions.label` membekukan substring saat dikirim, jadi chip tetap terbaca
   benar walaupun entitasnya kemudian diganti nama atau dihapus — sama seperti `payment_terms_days`
   pada PO dan `unit_name` pada daftar harga vendor yang merupakan snapshot.
4. **Soft-delete dan aditif.** Pesan tidak pernah dihapus keras (`deleted` diubah ke 1); migrasi hanya
   menambah tabel/indeks, tidak menyentuh baris lama.

---

## 2. Skema (database tenant — tanpa `tenant_id`, per tenant)

Empat tabel aditif. Kolom `id`, `created_at`, dan pola boolean mengikuti konvensi rumah yang sama.

| Tabel | Isi |
|---|---|
| `chat_conversations` | `kind` (`channel`/`dm`), `name`/`topic` channel, `is_private`, `archived`, `created_by`, `dm_key` (kanonik: dua id user diurutkan lalu digabung, NULL untuk channel), plus kolom denormalized untuk baca daftar: `last_message_at`, `last_message_sender_id`, `last_message_preview` |
| `chat_participants` | `PRIMARY KEY (conversation_id, user_id)`, `member_role` (`owner`/`member`), `joined_at` |
| `chat_messages` | `conversation_id`, `sender_id`, `body` (teks natural, terbaca & bisa dicari), `edited_at`, `deleted` (soft), `system`, `created_at` |
| `chat_mentions` | `message_id`, `kind` (`user`/`product`/`invoice`/`po`/`vendor`), `entity_id` (bisa NULL bila record hilang), `label` (snapshot `@…`/`#…`) |

Indeks:

| Indeks | Fungsi |
|---|---|
| `idx_chat_dm_key` | partial `UNIQUE(dm_key) WHERE dm_key IS NOT NULL` — DM ganda runtuh ke satu baris |
| `idx_chat_channel_name` | partial `UNIQUE(name) WHERE kind = 'channel'` — satu channel per nama |
| `idx_chat_part_user` | `(user_id, conversation_id)` — daftar percakapan seseorang |
| `idx_chat_part_conv` | `(conversation_id)` — anggota sebuah percakapan |
| `idx_chat_msg_conv` | `(conversation_id, created_at, id)` — window terbaru + "muat yang lama" (keyset) |
| `idx_chat_mentions_msg` | `(message_id)` — ambil chip per pesan |
| `idx_chat_conv_recent` | `(last_message_at)` — urutkan daftar secara murah |

Versi dinaikkan di tiga tempat yang harus sepakat (`scripts/check-docs.mjs` menjaganya): stamp
`tenant.sql` `(1, 11)`, `CURRENT_SCHEMA_VERSION = 11` di `scripts/apply-schema-all.mjs`, dan prefix
migrasi tertinggi `011_`.

---

## 3. Model mention

Codec-nya murni dan tak bergantung React (`src/lib/chat-mentions.ts`) — inilah satu aturan render,
bukan regex rapuh di waktu render.

- Composer menyelipkan **label** ke body dan mencatat `picked` (`{kind, entity_id, label}`).
- `extractMentions(body, picked)` menyisakan hanya mention yang label-nya masih ada di body saat
  dikirim (undo yang menghapus "@Budi" tidak meninggalkan chip menggantung) dan menghapus duplikat persis.
- `renderSegments(body, mentions)` memindai kiri-ke-kanan dan, di tiap posisi, memilih **label terpanjang**
  yang cocok. Lebar-pertama membuat "@Budi" menang atas "@Bud" di offset yang sama; teks tak cocok
  tetap literal.
- `entityRoute(kind, id)` menentukan ke mana chip `#` bernavigasi (product → daftar produk `?product=`,
  invoice → transaksi POS `?invoice=`, po → daftar PO `?po=`, vendor → `/backoffice/vendors/:id`);
  mention `user` tidak punya rute chat, hanya disorot.

Karena label adalah snapshot, chip untuk entitas yang sudah dihapus tetap terbaca (`entity_id` menjadi
NULL, rute nonaktif) — tidak pernah crash.

---

## 4. Real-time lewat polling

Hanya percakapan yang **terbuka** yang di-poll cepat; daftar percakapan lebih lambat; tab di latar
belakang berhenti (`refetchIntervalInBackground: false`). Konstanta di `src/hooks/use-chat.ts`:
`MSG_POLL_MS = 3000`, `LIST_POLL_MS = 10000`, `PAGE_SIZE = 50`.

`placeholderData: keepPreviousData` menjaga transkrip tetap di layar selama refetch. Mengirim pesan
bersifat **optimistic**: composer langsung melukis pesan (id `temp-…`), baris asli menggantikan sementara
saat sukses dan digulung balik saat gagal; invalidasi daftar membuat preview & urutan kebaruan menyusul.
Kolom `last_message_*` yang denormalized membuat poll daftar O(baris) tanpa subquery berkorelasi, dan
indeks `(conversation_id, created_at, id)` membuat baca window/keyset cukup indeks.

---

## 5. RBAC dan gerbang tampilan

Grup izin baru `collaboration` di `src/config/roles.ts`:

| Kunci | Artinya |
|---|---|
| `use_chat` | Membuka `/backoffice/chat`; membaca/mengirim di channel/DM milik orang tersebut |
| `manage_channels` | Membuat/mengarsipkan channel, menambah/menghapus anggota |

`use_chat: true` untuk **semua** peran (termasuk cashier/staff/warehouse) agar pemilik ↔ karyawan bisa
saling menghubungi; `manage_channels: true` hanya untuk `tenant_owner`/`tenant_admin`/`store_manager`.
Peran kustom muncul otomatis karena matriks diturunkan dari katalog. Entri sidebar dan guard rute
memakai kunci yang sama, jadi mencabut izin di Settings benar-benar menyembunyikan pintunya.

`src/lib/audit.ts` menambah `create_channel` / `archive_channel` / `delete_message`. Yang diaudit adalah
siklus hidup channel, bukan tiap pesan (volume).

---

## 6. Batas kepercayaan (WAJIB dibaca)

Tidak ada row-level security pada data tenant, dan token yang dipegang browser bersifat full-access
terhadap database tenant itu sendiri. Artinya:

- Visibilitas channel/DM adalah **aturan produk/UI**, bukan batas keamanan. Siapa pun yang memegang
  token tenant dapat `SELECT` baris `chat_messages` mana pun, termasuk DM yang bukan miliknya.
- Ini identik dengan pola gerbang-UI-only di seluruh aplikasi (lihat catatan pada
  `src/hooks/use-permissions.ts`). Menutup celah ini adalah perubahan platform tersendiri, bukan tugas
  modul chat.
- Karena itu chat ini adalah **kanal koordinasi internal, bukan kanal rahasia**. Jangan menaruh data
  sensitif (kata sandi, token, data pribadi rahasia) di dalamnya; copy UI mengulang penegasan ini.

---

## 7. Titik perpanjangan yang sengaja disisakan

| Ditangguhkan | Jalur perpanjangan yang sudah tersedia |
|---|---|
| Reaksi | tabel `chat_reactions` baru mengacu `message_id`; tak perlu mengubah pesan |
| Thread / balasan | kolom `reply_to` pada `chat_messages` (belum dipakai di MVP) |
| Read-receipt / badge belum dibaca | tabel `chat_reads` per (conversation, user, last_read) |
| Hard-delete | sengaja tidak — `deleted` soft menjaga koherensi urutan |
| Presentasi / notifikasi | butuh kanal push = perubahan infra, di luar keputusan polling |

---

## 8. Alternatif yang ditolak

- **WebSocket/SSE atau change-feed Turso** — pengguna memilih polling; model serverless ini tak punya
  kanal push, menambahnya = infra + CSP + fungsi Vercel untuk manfaat kecil.
- **API chat server-side (`api/*` + `server/`)** — bertentangan dengan pola klien-Turso-direct dan
  membebani permukaan deploy/typecheck; modul klien menjaga satu seam data-access (`@/lib/db`).
- **Parse `@`/`#` dari teks saat render (tanpa `chat_mentions`)** — rapuh (duplikat/ganti nama, `@`
  kasual), kehilangan id tautan dalam; diganti baris snapshot terstruktur.
- **Body token (`[@:id]`)** — UX composer buruk (token mentah terlihat saat mengetik) dan body tak
  terbaca/dicari; dipilih label terbaca + mention terstruktur.

---

## Addendum — 2026-11-18 (refleksi pasca-implementasi)

Isi §0–§8 di atas tetap beku. Tiga hal berikut adalah **perilaku yang baru terbukti salah** saat
fiturnya diukur sesudah ship, dan koreksinya tercatat di sini karena dokumen ini adalah
satu-satunya spec chat yang dibaca orang lebih dulu:

| # | Yang terjadi | Bentuk yang benar sekarang |
|---|---|---|
| 1 | **Label terbaca di rail untuk DM tidak pernah diuji.** Sebuah DM ditampilkan sebagai "Pesan pribadi" dengan monogram dua huruf, padahal kedua orangnya punya nama | `listConversations()` wajib memuat **seluruh** peserta, bukan hanya baris pembaca: `WHERE c.id IN (SELECT conversation_id FROM chat_participants WHERE user_id = $1)` — filter pada join yang sama membuat agregasi peserta menyusut jadi satu orang, sehingga pasangan DM tidak pernah teridentifikasi. Bukti: nama baris rail kini `"SU Surya 01.17 dm halo"` |
| 2 | **Enter di composer mengirim token mentah** (`#beras`) ketika pencarian autocomplete belum kembali, jadi pesan berisi teks mentah dan nol baris mention | Ada gerbang `waitingForSuggestions`: selama pencarian kandidat masih berjalan, Enter pertama **menyelesaikan** token, Enter berikutnya baru mengirim. Diuji oleh kasus "mention chip muncul dari ketik sampai kirim" |
| 3 | **`placeholderData: keepPreviousData` pada §4 salah untuk query yang di-*key* id.** Pane masih menampilkan percakapan **sebelumnya** selama yang baru dimuat, dan composer menulis ke pane yang sedang tampil — jadi pesan bisa mendarat di channel yang salah sementara header sudah menunjuk channel baru | `useConversation`/`useMessages` **tidak** memakai placeholder (daftar `useConversations`/`useDiscoverableChannels` tetap memakainya, karena key-nya tidak berubah saat berpilih); `Chat.tsx` menampilkan `ChatEmptyState skeleton` selama identitas belum tiba. Bukti terukur: `halo dari e2e` tercatat di `operasional-toko` (`created_at` `2026-11-17T18:24:16.780Z`) padahal header pane sudah `#e2e-chat` |

Konsekuensi untuk verifikasi: `tests/chat.e2e.ts` naik dari 7 ke **8 kasus** (dua kasus baru
mengunci butir 2 dan butir 3), dan kasus pembuatan channel kini **menegakkan identitas pane lewat
header lebih dulu** sebelum ada yang diketik — karena assertion layar saja bisa hijau sementara
pesannya salah rumah. Hasil ukur satu run bersih: `tests/chat.e2e.ts (8 tests) 170,49s`, total
`Tests 10 passed (10)` / `Duration 194,11s`, exit 0. Keputusan desain (polling, label terbaca +
mention terstruktur, snapshot label, soft-delete) **tidak** berubah; yang berubah hanya cara
tulisan itu dicapai.
