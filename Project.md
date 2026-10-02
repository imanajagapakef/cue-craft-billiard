# Billiard Booking & Table Management System

> **Status:** Draft / Brainstorming
> **Version:** 0.1
> **Purpose:** Menjadi source of truth awal untuk workflow bisnis, domain logic, dan scope MVP sistem booking serta operasional tempat billiard.

---

# 1. Product Overview

Sistem ini dirancang untuk membantu tempat billiard mengelola:

* Ketersediaan meja secara real-time.
* Booking meja berdasarkan tanggal, waktu, dan durasi.
* Pembayaran **DP wajib**.
* Pembayaran DP melalui **QRIS** atau **cash di kasir**.
* Verifikasi pembayaran oleh kasir/admin.
* Konfirmasi booking otomatis.
* Notifikasi WhatsApp kepada customer.
* Check-in customer.
* Pengelolaan sesi bermain.
* Extension / penambahan durasi bermain.
* Walk-in customer.
* Monitoring seluruh meja oleh kasir/admin.
* Riwayat booking dan transaksi.
* Audit serta pencatatan aktivitas operasional.

Produk ini **bukan hanya sistem booking**. Secara keseluruhan, produk berkembang menjadi:

> **Billiard Booking & Table Management System**

Booking menjadi bagian dari operational workflow tempat billiard.

---

# 2. Problem Statement

## Masalah Customer

Dalam operasional manual, customer sering harus:

1. Datang ke lokasi.
2. Bertanya kepada kasir.
3. Mengecek meja yang tersedia.
4. Menentukan apakah masih ada meja kosong.
5. Menunggu jika penuh atau mencari tempat lain.

Masalah utama:

> Customer tidak mengetahui ketersediaan meja sebelum datang.

Masalah lain:

* Customer tidak mengetahui jam mana yang tersedia.
* Booking melalui chat/telepon berpotensi tidak konsisten.
* Bukti booking sulit dilacak.
* Customer tidak tahu apakah pembayaran sudah dikonfirmasi.
* Customer harus menghubungi kasir untuk menanyakan status booking.

## Masalah Operasional

Kasir/admin juga menghadapi:

* Pencatatan booking manual.
* Sulit memantau semua meja sekaligus.
* Risiko double booking.
* Sulit membedakan reserved, occupied, dan available.
* Verifikasi pembayaran secara manual.
* Sulit menangani perpanjangan sesi.
* Tidak ada histori operasional yang terstruktur.
* Walk-in dan online booking harus dikelola secara terpisah.

---

# 3. Product Goal

Sistem harus membuat proses berikut menjadi terstruktur:

```text
Availability
    ↓
Booking
    ↓
Deposit
    ↓
Payment Verification
    ↓
Booking Confirmation
    ↓
WhatsApp Notification
    ↓
Check-in
    ↓
Playing Session
    ↓
Extension
    ↓
Checkout
    ↓
Completed
```

Tujuan utama:

> Customer dapat mengetahui dan memesan meja sebelum datang, sementara kasir/admin tetap memiliki kontrol penuh terhadap operasional meja dan pembayaran.

---

# 4. Core Concept

Sistem memiliki tiga konsep utama:

```text
TABLE
    ↓
AVAILABILITY
    ↓
BOOKING
    ↓
PAYMENT
```

Kemudian setelah customer datang:

```text
BOOKING
    ↓
CHECK-IN
    ↓
SESSION
```

Dan jika customer ingin menambah waktu:

```text
SESSION
    ↓
EXTENSION
```

---

# 5. User Roles

## 5.1 Customer

Customer dapat:

* Melihat daftar meja.
* Melihat ketersediaan meja.
* Memilih tanggal.
* Memilih waktu mulai.
* Memilih durasi.
* Memilih meja.
* Melakukan booking.
* Membayar DP.
* Memilih QRIS atau cash di kasir.
* Mengupload bukti pembayaran QRIS.
* Melihat status pembayaran.
* Melihat status booking.
* Menerima notifikasi WhatsApp.
* Melihat detail booking.
* Membatalkan booking sesuai kebijakan.
* Melihat riwayat booking.
* Melakukan extension jika tersedia.

---

## 5.2 Cashier / Admin

Kasir/admin dapat:

* Melihat dashboard.
* Melihat seluruh status meja.
* Melihat booking.
* Membuat booking manual.
* Membuat walk-in session.
* Memverifikasi pembayaran.
* Menerima DP cash.
* Menyetujui / menolak bukti pembayaran.
* Check-in customer.
* Memulai sesi.
* Mengakhiri sesi.
* Melakukan extension melalui override sesuai permission.
* Mengubah status meja.
* Menandai maintenance.
* Menangani no-show.
* Melihat transaksi.
* Melihat audit log.

---

## 5.3 Owner / Manager

Owner/manager dapat:

* Melihat dashboard bisnis.
* Melihat revenue.
* Melihat jumlah booking.
* Melihat penggunaan meja.
* Melihat jam ramai.
* Melihat histori transaksi.
* Mengelola harga.
* Mengelola meja.
* Mengelola aturan booking.
* Mengelola kebijakan DP.
* Melihat laporan.
* Melihat audit log.

---

# 6. Table Management

Table merupakan salah satu domain utama dalam sistem.

Setiap meja memiliki:

```text
id
name / number
type
status
hourly_price
location / zone
active
created_at
updated_at
```

Contoh:

```text
T01
T02
T03
...
T12
```

---

# 7. Table Types

Sistem dapat mendukung beberapa jenis meja.

Contoh:

```text
REGULAR
VIP
```

Setiap tipe dapat memiliki harga berbeda.

Contoh:

```text
Regular
Rp40.000 / hour

VIP
Rp60.000 / hour
```

Harga aktual tidak boleh di-hardcode pada business logic.

---

# 8. Table Status

Table status harus dibedakan dari booking status.

Minimal:

```text
AVAILABLE
HELD
OCCUPIED
MAINTENANCE
```

## AVAILABLE

Meja dapat digunakan atau dibooking.

## HELD

Meja sedang ditahan untuk booking yang belum mendapatkan konfirmasi DP.

Contoh:

```text
Table 04
HELD

Booking:
BK-7F29A

Waiting for deposit
Expires:
19:30
```

## OCCUPIED

Meja sedang digunakan untuk sesi aktif.

## MAINTENANCE

Meja tidak dapat dibooking maupun digunakan.

---

# 9. Time-Based Availability

Status meja tidak cukup hanya menggunakan status global.

Sistem harus memperhitungkan:

* Booking yang sudah ada.
* Session yang sedang berjalan.
* Maintenance.
* Jam operasional.
* Buffer time.
* Hold yang masih aktif.

Contoh:

```text
Table 04

19:00 - 21:00
Andi
OCCUPIED

21:00 - 23:00
Budi
CONFIRMED

23:00 - 00:00
AVAILABLE
```

Customer yang ingin bermain pukul 21:00 tidak dapat memilih Table 04.

---

# 10. Public Availability

Customer dapat memilih:

```text
Date
Time
Duration
```

Kemudian sistem menghitung meja yang tersedia.

Contoh:

```text
02 October 2026
20:00
2 Hours
```

Hasil:

```text
Table 01
AVAILABLE
Rp80.000

Table 04
AVAILABLE
Rp100.000

Table 08
AVAILABLE
Rp100.000
```

---

# 11. Optional Floor Map

Interface customer dan admin dapat menampilkan layout meja.

Contoh:

```text
VIP AREA

[T07]        [T08]
AVAILABLE    RESERVED

[T09]        [T10]
AVAILABLE    OCCUPIED


MAIN AREA

[T01] [T02] [T03]
```

Tujuan:

* Mempermudah customer memahami posisi meja.
* Mempermudah admin memonitor operasional.
* Memberikan identitas visual yang lebih kuat dibanding daftar meja biasa.

---

# 12. Pricing

Pricing engine harus bersifat configurable.

Harga dapat berbeda berdasarkan:

* Jenis meja.
* Hari.
* Jam.
* Peak hour.
* Off-peak.
* Weekend.
* Holiday.

Contoh:

```text
REGULAR

Weekday:
10:00 - 17:00 → Rp40.000/hour
17:00 - 00:00 → Rp50.000/hour

Weekend:
Rp60.000/hour
```

Contoh VIP:

```text
VIP

Weekday:
Rp60.000/hour

Weekend:
Rp75.000/hour
```

Pricing engine harus menentukan total biaya berdasarkan periode booking.

---

# 13. Booking

Booking merupakan reservation terhadap meja pada rentang waktu tertentu.

Minimal booking memiliki:

```text
id
booking_code
customer_id
table_id
start_at
end_at
duration
total_price
deposit_amount
remaining_amount
status
payment_status
created_at
updated_at
```

---

# 14. Booking Code

Setiap booking memiliki kode unik.

Contoh:

```text
BK-7F29A
```

Kode digunakan untuk:

* Identifikasi booking.
* Check-in.
* Pencarian booking oleh kasir.
* Customer support.
* Referensi pembayaran.
* Referensi notifikasi WhatsApp.

---

# 15. Mandatory Deposit

Booking **wajib membayar DP**.

Customer tidak dapat mengunci meja secara permanen tanpa DP.

Contoh:

```text
Harga:
Rp200.000

Required Deposit:
Rp50.000

Remaining:
Rp150.000
```

Aturan:

```text
Booking dibuat
    ↓
DP belum dibayar
    ↓
Table HELD
    ↓
DP diterima
    ↓
Booking CONFIRMED
```

---

# 16. Booking Hold

Setelah customer menyelesaikan booking tetapi belum membayar DP, meja tidak langsung menjadi confirmed.

Status:

```text
AWAITING_DEPOSIT
```

Table:

```text
HELD
```

Hold memiliki expiration time.

Contoh:

```text
Booking:
BK-7F29A

Deposit:
Rp50.000

Hold expires:
19:30
```

Customer harus membayar sebelum batas tersebut.

---

# 17. Hold Expiration

Jika DP tidak diterima sebelum expiration:

```text
AWAITING_DEPOSIT
        ↓
EXPIRED
        ↓
Table kembali AVAILABLE
```

Reservation tidak boleh tetap menahan meja tanpa batas.

---

# 18. Payment Methods

MVP mendukung:

```text
QRIS
CASH_AT_COUNTER
```

Keduanya wajib membayar nominal DP yang sama.

---

# 19. QRIS Payment Flow

Customer memilih:

```text
Payment:
QRIS
```

Sistem menampilkan QRIS yang digunakan oleh bisnis.

Contoh:

```text
BILLIARD XYZ

[ QRIS IMAGE ]

Total Deposit
Rp50.000
```

Customer:

1. Scan QRIS.
2. Melakukan pembayaran.
3. Mengupload bukti pembayaran.
4. Menunggu verifikasi admin.

---

# 20. QRIS Payment Verification

Setelah bukti dikirim:

```text
Payment:
PROOF_SUBMITTED

Booking:
AWAITING_CONFIRMATION
```

Admin melihat:

```text
BOOKING #BK-7F29A

Customer:
Andi

Table:
T04

Deposit:
Rp50.000

Payment:
QRIS

[ PAYMENT PROOF ]

[ CONFIRM PAYMENT ]
[ REJECT PAYMENT ]
```

---

# 21. QRIS Confirmation

Jika admin melakukan:

```text
CONFIRM PAYMENT
```

Maka:

```text
Payment
PROOF_SUBMITTED
        ↓
PAID

Booking
AWAITING_DEPOSIT
        ↓
CONFIRMED

Table
HELD
        ↓
CONFIRMED / RESERVED
```

Setelah itu sistem dispatch WhatsApp notification.

---

# 22. QRIS Rejection

Jika bukti tidak valid:

```text
Payment
PROOF_SUBMITTED
        ↓
REJECTED
```

Booking tidak boleh otomatis dianggap confirmed.

Customer menerima informasi bahwa pembayaran belum terkonfirmasi.

Penolakan sebaiknya mempunyai optional reason:

```text
REASON:
- Amount mismatch
- Proof unreadable
- Wrong account
- Duplicate payment
- Other
```

---

# 23. Cash at Counter

Customer dapat memilih:

```text
Payment Method:
CASH AT COUNTER
```

Contoh:

```text
Table 04
20:00 - 22:00

Total:
Rp200.000

Required Deposit:
Rp50.000

Payment:
Cash at Counter
```

Booking:

```text
AWAITING_DEPOSIT
```

Table:

```text
HELD
```

Customer harus membayar DP langsung ke kasir sebelum hold expiration.

---

# 24. Cash Deposit Confirmation

Customer datang ke kasir.

Kasir melihat:

```text
BK-7F29A

Customer:
Andi

Deposit:
Rp50.000

Payment:
CASH
```

Kasir menerima uang lalu memilih:

```text
CONFIRM DEPOSIT
```

Sistem mengubah:

```text
Payment:
PAID

Booking:
CONFIRMED
```

Kemudian WhatsApp confirmation dikirim.

---

# 25. Booking vs Payment State

Booking status dan payment status harus dipisahkan.

## Booking Status

```text
PENDING
AWAITING_DEPOSIT
CONFIRMED
CHECKED_IN
COMPLETED
CANCELLED
EXPIRED
NO_SHOW
```

## Payment Status

```text
PENDING
PROOF_SUBMITTED
PAID
REJECTED
REFUNDED
```

Contoh valid:

```text
Booking:
CONFIRMED

Payment:
PAID
```

Contoh:

```text
Booking:
AWAITING_DEPOSIT

Payment:
PROOF_SUBMITTED
```

Keduanya tidak boleh digabung menjadi satu field.

---

# 26. WhatsApp Notification

WhatsApp digunakan sebagai notification channel.

WhatsApp **bukan source of truth**.

Database tetap menjadi sumber kebenaran utama.

---

# 27. Initial WhatsApp Events

Minimal terdapat empat event:

```text
1. Booking Created
2. Payment Proof Submitted
3. Payment Confirmed
4. Payment Rejected
```

Kemudian dapat dikembangkan:

```text
5. Booking Reminder
6. Arrival Reminder
7. Booking Cancelled
8. No-show
9. Extension Confirmed
10. Session Ending
```

---

# 28. Booking Created WhatsApp

Untuk cash booking atau booking yang masih menunggu pembayaran:

```text
BILLIARD XYZ

Booking kamu berhasil dibuat dan meja sudah ditahan sementara.

Booking: BK-7F29A
Meja: Table 04
Jam: 20:00–22:00

DP: Rp50.000
Pembayaran: Cash di kasir

Silakan bayar DP sebelum 19:30 untuk mengonfirmasi booking.

Setelah DP dikonfirmasi kasir, kamu akan menerima pesan konfirmasi.
```

Booking **belum** dianggap confirmed.

---

# 29. Payment Confirmed WhatsApp

Setelah admin mengonfirmasi pembayaran:

```text
BILLIARD XYZ

Booking kamu sudah dikonfirmasi.

Booking: BK-7F29A
Meja: Table 04
Tanggal: 2 Oktober 2026
Jam: 20:00–22:00

DP Rp50.000 telah diterima.

Sisa pembayaran: Rp150.000

Sampai jumpa dan selamat bermain!
```

Pesan dapat menyertakan link:

```text
Lihat Detail Booking
```

---

# 30. Payment Rejected WhatsApp

Contoh:

```text
BILLIARD XYZ

Pembayaran untuk booking BK-7F29A belum dapat dikonfirmasi.

Silakan periksa kembali bukti pembayaran atau lakukan pembayaran ulang melalui halaman booking.

Alasan:
Bukti pembayaran tidak terbaca.
```

---

# 31. WhatsApp Architecture

WhatsApp tidak boleh dipanggil langsung dari request utama admin.

Flow:

```text
Admin confirms payment
        ↓
Database transaction
        ↓
Booking CONFIRMED
Payment PAID
        ↓
Dispatch notification job
        ↓
Queue
        ↓
WhatsApp Provider
        ↓
Customer
```

Keuntungan:

* Dashboard admin tidak menunggu API WhatsApp.
* Provider WhatsApp error tidak membatalkan booking.
* Notification dapat di-retry.
* Status pengiriman dapat dicatat.
* Sistem lebih reliable.

---

# 32. Notification Log

Semua notifikasi WhatsApp harus tercatat.

Contoh entity:

```text
notification_logs

id
booking_id
channel
recipient
template
status
provider_message_id
attempts
sent_at
failed_at
error_message
created_at
```

Status contoh:

```text
PENDING
SENT
DELIVERED
FAILED
```

---

# 33. Important Rule: WhatsApp Failure

Contoh:

```text
Payment:
PAID

Booking:
CONFIRMED

WhatsApp:
FAILED
```

Booking **tetap confirmed**.

WhatsApp hanya delivery mechanism.

Kegagalan provider tidak boleh rollback:

```text
PAYMENT
```

atau:

```text
BOOKING
```

---

# 34. Check-in

Customer yang sudah confirmed datang ke lokasi.

Kasir mencari:

```text
BK-7F29A
```

Kemudian:

```text
Customer:
Andi

Table:
T04

Time:
20:00 - 22:00

Payment:
PAID

Status:
CONFIRMED

[ CHECK-IN ]
```

Setelah check-in:

```text
Booking:
CHECKED_IN

Table:
OCCUPIED
```

---

# 35. Session

Booking time dan actual session time harus dapat dibedakan.

Contoh:

```text
Booking:
20:00 - 22:00

Actual Check-in:
20:07

Session Start:
20:07
```

Session memiliki:

```text
id
booking_id
table_id
started_at
scheduled_end_at
actual_end_at
status
```

Status:

```text
ACTIVE
ENDED
OVERDUE
```

---

# 36. Session Monitor

Admin dapat melihat:

```text
TABLE 05

Customer:
Andi

Started:
20:15

Scheduled End:
22:15

Remaining:
01:24:32
```

Table monitor dapat menampilkan countdown.

---

# 37. Extension / Additional Time

Customer dapat meminta tambahan durasi.

Contoh:

```text
Current Session:
19:00 - 21:00

Customer:
Request +1 Hour
```

Sistem **tidak boleh langsung menambahkan satu jam**.

Sistem harus terlebih dahulu menghitung availability setelah current session.

---

# 38. Extension Availability Rule

## Case 1 — Tidak ada booking berikutnya

```text
19:00 - 21:00
CURRENT SESSION

21:00 - 22:00
AVAILABLE

22:00 - 23:00
AVAILABLE
```

Customer dapat memilih:

```text
+30 min
+1 hour
+2 hours
```

selama masih berada dalam jam operasional dan tidak ada konflik.

---

# 39. Extension dengan Booking Berikutnya

Contoh:

```text
19:00 - 21:00
Andi

21:30 - 23:30
Budi
```

Customer meminta:

```text
+1 hour
```

Sistem menghitung:

```text
Current End:
21:00

Next Booking:
21:30

Maximum Extension:
30 minutes
```

Maka customer hanya boleh memilih sampai:

```text
+30 minutes
```

Tidak boleh menawarkan:

```text
+1 hour
```

---

# 40. Extension Tepat dengan Booking Berikutnya

Contoh:

```text
19:00 - 21:00
Andi

21:00 - 23:00
Budi
```

Maximum extension:

```text
0 minutes
```

Maka:

```text
Extension:
NOT AVAILABLE
```

---

# 41. Extension Must Re-check Availability

Availability harus dicek:

1. Saat customer membuka extension screen.
2. Saat customer memilih durasi.
3. Saat extension benar-benar disubmit ke backend.

Contoh race condition:

```text
20:42
Table masih kosong setelah session.

20:43
Customer A request extension.

20:43:05
Customer B berhasil melakukan booking.

20:43:10
Customer A confirm extension.
```

Backend harus melakukan re-check.

Jika slot sudah digunakan:

```text
EXTENSION REJECTED
```

Ini harus diproses secara atomik untuk mencegah overlapping reservation.

---

# 42. Extension Entity

Extension dapat dicatat sebagai entity sendiri.

Contoh:

```text
extensions

id
session_id
requested_by
requested_minutes
approved_minutes
price
status
approved_by
approved_at
created_at
```

Status:

```text
PENDING
APPROVED
REJECTED
CANCELLED
```

---

# 43. Extension Pricing

Extension menggunakan pricing rule yang sama atau rule khusus.

Contoh:

```text
+30 minutes
Rp25.000

+1 hour
Rp50.000
```

Harga harus berasal dari pricing configuration, bukan hardcode di frontend.

---

# 44. Next Booking Protection

Booking customer berikutnya tidak boleh diganggu secara otomatis.

Contoh:

```text
Andi:
19:00 - 21:00

Budi:
21:00 - 23:00
```

Andi tidak dapat memperpanjang sesi tanpa perubahan manual dari pihak berwenang.

---

# 45. Admin Override

Admin dengan permission tertentu dapat menangani kasus khusus.

Contoh:

```text
Andi wants +30 minutes.

Next booking:
Budi · 21:00
```

Admin dapat memilih:

```text
[ DENY EXTENSION ]
[ CONTACT CUSTOMER ]
[ MOVE BOOKING ]
```

Perubahan booking customer lain harus:

* Manual.
* Terdokumentasi.
* Memiliki alasan.
* Dicatat pada audit log.

Tidak boleh dilakukan secara otomatis.

---

# 46. Buffer Time

Sistem dapat mendukung buffer time antar sesi.

Contoh:

```text
Session:
20:00 - 22:00

Buffer:
22:00 - 22:10

Next booking:
22:10
```

Buffer dapat digunakan untuk:

* Membersihkan meja.
* Menyiapkan meja.
* Pergantian customer.
* Pembayaran.
* Operational handling.

Nilai buffer dapat configurable:

```text
0 min
5 min
10 min
15 min
```

MVP dapat dimulai dengan satu nilai global.

---

# 47. Walk-in Booking

Sistem harus mendukung customer yang datang langsung.

Kasir dapat membuat session:

```text
WALK-IN

Customer:
Andi

Table:
T05

Start:
20:15

Duration:
2 Hours

Payment:
Cash / QRIS
```

Kemudian:

```text
Start Session
```

Table menjadi:

```text
OCCUPIED
```

Walk-in harus menggunakan table/session system yang sama dengan online booking.

Tidak boleh dibuat sebagai workflow terpisah yang tidak tercatat.

---

# 48. Customer Booking History

Customer dapat melihat:

```text
UPCOMING

BK-7F29A
Table 04
02 Oct 2026
20:00 - 22:00
CONFIRMED
```

dan:

```text
PAST

BK-31K92
Table 02
28 Sep 2026
COMPLETED
```

---

# 49. Booking Detail

Customer dapat melihat:

```text
Booking:
BK-7F29A

Table:
Table 04

Date:
02 October 2026

Time:
20:00 - 22:00

Total:
Rp200.000

Deposit:
Rp50.000

Remaining:
Rp150.000

Payment:
PAID

Status:
CONFIRMED
```

Dapat juga menampilkan:

```text
QR / Booking Code
```

untuk check-in.

---

# 50. Booking Expiration

Booking dapat expired karena:

* DP tidak dibayar.
* Hold timeout.
* Kebijakan bisnis tertentu.

Contoh:

```text
Booking created:
18:45

Hold expiration:
19:30

DP:
Not received

Result:
EXPIRED
```

Setelah expiration:

```text
Table → AVAILABLE
```

---

# 51. No-show

Customer yang sudah confirmed tetapi tidak datang dianggap:

```text
NO_SHOW
```

Setelah grace period tertentu.

Contoh:

```text
Booking:
20:00

Grace period:
15 minutes

20:15:
Customer belum datang

Admin:
Mark NO-SHOW
```

Aturan DP untuk no-show ditentukan oleh cancellation policy.

---

# 52. Cancellation

Customer dapat membatalkan booking sesuai kebijakan bisnis.

Cancellation policy nantinya menentukan:

* Apakah DP refundable.
* Batas waktu pembatalan.
* Apakah DP hangus.
* Apakah refund sebagian.
* Apa yang terjadi jika venue membatalkan.

Contoh aturan yang mungkin:

```text
> 24 hours before:
Refund allowed

< 24 hours:
Deposit non-refundable

NO-SHOW:
Deposit non-refundable
```

Aturan tersebut masih **belum final** dan harus ditentukan bersama kebijakan bisnis venue.

---

# 53. Checkout

Saat session selesai:

```text
Scheduled:
20:00 - 22:00

Actual:
20:05 - 22:12
```

Sistem harus menghitung apakah ada:

* Extension.
* Overage.
* Additional charge.
* Remaining payment.

Contoh:

```text
Total:
Rp200.000

Deposit:
Rp50.000

Remaining:
Rp150.000
```

Customer melakukan pelunasan.

Setelah selesai:

```text
Payment:
PAID

Session:
ENDED

Booking:
COMPLETED

Table:
AVAILABLE
```

---

# 54. Table Monitor

Admin membutuhkan tampilan live operational monitor.

Contoh:

```text
TABLE MONITOR

T01    AVAILABLE
T02    OCCUPIED     01:21 LEFT
T03    RESERVED     21:00
T04    OCCUPIED     00:42 LEFT
T05    AVAILABLE
T06    MAINTENANCE
T07    RESERVED     22:30
T08    AVAILABLE
```

Tujuan utama:

> Kasir dapat memahami kondisi venue hanya dengan melihat satu layar.

---

# 55. Admin Dashboard

Dashboard minimal:

```text
TODAY

Revenue
Rp4.850.000

Bookings
32

Active Tables
9 / 12

Upcoming Bookings
14

Pending Payments
3
```

Widget tambahan:

```text
Current Occupancy
Peak Hours
Pending Confirmation
Upcoming Check-ins
Expiring Holds
```

---

# 56. Payment Dashboard

Admin dapat melihat:

```text
PENDING PAYMENTS

BK-7F29A
Andi
QRIS
Rp50.000
PROOF SUBMITTED

BK-8J23B
Budi
Cash
Rp75.000
AWAITING DEPOSIT
```

Action:

```text
Confirm
Reject
View Proof
```

---

# 57. Booking Timeline

Untuk setiap booking, sistem dapat mencatat timeline:

```text
18:45
Booking created

18:47
QRIS payment proof submitted

18:52
Payment confirmed by cashier

18:52
Booking confirmed

18:52
WhatsApp notification queued

18:53
WhatsApp sent

19:56
Customer checked in

22:00
Session ended

22:03
Final payment completed

22:03
Booking completed
```

Timeline membantu debugging dan audit.

---

# 58. Audit Log

Semua tindakan penting harus dicatat.

Contoh:

```text
Payment confirmed
Booking cancelled
Booking modified
Table status changed
Session started
Session ended
Extension approved
Extension rejected
Price changed
```

Audit record:

```text
actor
action
entity
entity_id
before
after
reason
timestamp
```

---

# 59. Core Domain States

## Table

```text
AVAILABLE
HELD
OCCUPIED
MAINTENANCE
```

## Booking

```text
PENDING
AWAITING_DEPOSIT
CONFIRMED
CHECKED_IN
COMPLETED
CANCELLED
EXPIRED
NO_SHOW
```

## Payment

```text
PENDING
PROOF_SUBMITTED
PAID
REJECTED
REFUNDED
```

## Session

```text
ACTIVE
ENDED
OVERDUE
```

## Extension

```text
PENDING
APPROVED
REJECTED
CANCELLED
```

---

# 60. Main Booking State Flow

```text
PENDING
   │
   ▼
AWAITING_DEPOSIT
   │
   ├───────────────┐
   │               │
DP RECEIVED      TIMEOUT
   │               │
   ▼               ▼
CONFIRMED        EXPIRED
   │
   ├───────────────┐
   │               │
CHECK-IN         CANCEL
   │               │
   ▼               ▼
CHECKED_IN      CANCELLED
   │
   ▼
SESSION ACTIVE
   │
   ├── EXTENSION
   │
   ▼
SESSION ENDED
   │
   ▼
COMPLETED
```

---

# 61. Main Payment Flow

```text
PENDING
   │
   ├── QRIS
   │      ↓
   │  PROOF_SUBMITTED
   │      │
   │      ├── CONFIRM → PAID
   │      └── REJECT → REJECTED
   │
   └── CASH
          ↓
      WAITING CASH
          │
          └── CONFIRM → PAID
```

---

# 62. Main Availability Algorithm

Availability harus mempertimbangkan:

```text
requested_start
requested_end
table
existing_confirmed_bookings
active_sessions
active_holds
maintenance_periods
operating_hours
buffer_time
```

Pseudo-flow:

```text
Check requested period
        ↓
Check operating hours
        ↓
Find eligible tables
        ↓
Remove maintenance tables
        ↓
Remove tables with overlapping confirmed bookings
        ↓
Remove tables with overlapping active sessions
        ↓
Remove tables with active holds
        ↓
Apply buffer rules
        ↓
Return available tables
```

---

# 63. Overlap Rule

Reservation dianggap conflict jika time range saling overlap.

Contoh:

```text
Existing:
20:00 - 22:00

Requested:
21:00 - 23:00
```

Conflict.

---

Contoh:

```text
Existing:
20:00 - 22:00

Requested:
22:00 - 23:00
```

Secara interval dasar tidak overlap, tetapi hasil akhir dapat dipengaruhi oleh buffer time.

---

# 64. Concurrency / Double Booking Protection

Availability check di frontend **tidak cukup**.

Backend wajib melakukan final validation saat membuat booking.

Harus dilindungi terhadap kasus:

```text
Customer A checks availability
Customer B checks availability

Both see:
Table 04 available

A submits
B submits almost simultaneously
```

Sistem hanya boleh menghasilkan satu reservation yang valid.

Implementasi teknis dapat menggunakan kombinasi:

* Database transaction.
* Locking.
* Constraint / exclusion strategy sesuai database.
* Re-validation sebelum commit.
* Idempotency untuk operation tertentu.

Detail implementasi diputuskan saat technical design.

---

# 65. Booking Confirmation Transaction

Saat admin mengonfirmasi DP, perubahan utama harus berada dalam satu transactional workflow.

Contoh:

```text
BEGIN TRANSACTION

Validate booking
Validate payment
Validate expiration
Confirm payment
Confirm booking

COMMIT
```

Setelah transaction sukses:

```text
Dispatch BookingConfirmed event
```

Kemudian:

```text
BookingConfirmed
      ↓
WhatsApp notification job
```

---

# 66. WhatsApp Must Be Asynchronous

Jangan:

```text
Admin click confirm
    ↓
Call WhatsApp API
    ↓
Wait
    ↓
Save confirmation
```

Gunakan:

```text
Admin click confirm
    ↓
DB transaction
    ↓
COMMIT
    ↓
Queue notification
    ↓
WhatsApp provider
```

Dengan demikian:

* Booking confirmation tidak bergantung pada latency provider.
* Retry lebih mudah.
* Error dapat dicatat.
* Admin UI tetap responsif.

---

# 67. Customer Experience

Customer ideal flow:

```text
Open Website
      ↓
See Availability
      ↓
Choose Date
      ↓
Choose Time
      ↓
Choose Duration
      ↓
Choose Table
      ↓
See Price
      ↓
Choose Payment
      ↓
Pay DP
      ↓
Wait Verification
      ↓
Receive WhatsApp
      ↓
Booking Confirmed
      ↓
Come to Venue
      ↓
Check-in
      ↓
Play
      ↓
Extend if Available
      ↓
Checkout
```

---

# 68. Admin Experience

Admin ideal flow:

```text
Open Dashboard
      ↓
See Table Monitor
      ↓
Review Pending Payments
      ↓
Verify Payment
      ↓
Booking Automatically Confirmed
      ↓
Customer Receives WhatsApp
      ↓
Customer Arrives
      ↓
Search Booking Code
      ↓
Check-in
      ↓
Monitor Session
      ↓
Handle Extension
      ↓
Checkout
```

---

# 69. MVP Scope

MVP harus fokus kepada core operational value.

## Customer

```text
- View availability
- Choose date
- Choose time
- Choose duration
- Choose table
- Create booking
- Mandatory DP
- QRIS
- Cash at counter
- Upload payment proof
- Booking status
- WhatsApp confirmation
- Booking history
- Booking detail
```

## Admin

```text
- Dashboard
- Table monitor
- Booking management
- Payment verification
- Cash deposit confirmation
- Walk-in booking
- Check-in
- Session management
- Extension
- Table status
- No-show
- Audit log
```

## System

```text
- Availability engine
- Pricing engine
- Booking lifecycle
- Payment lifecycle
- Deposit hold
- Booking expiration
- Conflict prevention
- WhatsApp notification
- Notification queue
- Notification log
```

---

# 70. Features Outside MVP

Fitur berikut dapat ditunda sampai core system stabil:

```text
Membership
Loyalty points
Promo engine
Food & Beverage ordering
Advanced POS
Multi-branch
Customer rating
Referral
Subscription
Advanced analytics
Automated marketing
Advanced payment gateway
Dynamic QRIS
```

Jangan membangun semua ini sejak awal.

Core value produk tetap:

> **Mengetahui meja yang tersedia dan menguncinya melalui booking dengan DP.**

---

# 71. Future Expansion

Setelah MVP berjalan baik, sistem dapat berkembang menjadi:

```text
BOOKING
   +
TABLE MANAGEMENT
   +
SESSION MANAGEMENT
   +
PAYMENT
   +
POS
   +
FOOD & BEVERAGE
   +
MEMBERSHIP
   +
REPORTING
```

Potensi akhirnya:

> **Billiard Venue Management Platform**

---

# 72. Potential Future Payment Upgrade

MVP:

```text
Static QRIS
+
Upload Proof
+
Manual Admin Verification
```

Future:

```text
Payment Gateway
        ↓
Dynamic QRIS
        ↓
Payment Webhook
        ↓
Automatic Payment Confirmation
        ↓
Booking Confirmation
```

Pada tahap tersebut upload bukti pembayaran dapat menjadi optional atau tidak lagi diperlukan.

---

# 73. Important Business Rules

Rules yang sudah disepakati dalam draft ini:

### Rule 1

Booking membutuhkan DP.

### Rule 2

Booking tanpa DP hanya berstatus hold / pending, bukan confirmed.

### Rule 3

Hold mempunyai expiration.

### Rule 4

DP yang berhasil diverifikasi mengubah booking menjadi confirmed.

### Rule 5

WhatsApp dikirim setelah payment confirmation.

### Rule 6

WhatsApp failure tidak membatalkan booking.

### Rule 7

Walk-in menggunakan table/session system yang sama.

### Rule 8

Extension harus memeriksa booking berikutnya.

### Rule 9

Extension tidak boleh menyebabkan overlapping reservation.

### Rule 10

Extension harus melakukan re-check sebelum commit.

### Rule 11

Booking berikutnya tidak boleh digeser otomatis.

### Rule 12

Perubahan manual oleh admin harus tercatat di audit log.

### Rule 13

Table status dan booking status harus dipisahkan.

### Rule 14

Booking time dan actual session time harus dipisahkan.

### Rule 15

Pricing tidak boleh hardcoded di frontend.

---

# 74. Open Business Decisions

Beberapa hal belum ditentukan dan harus diputuskan sebelum implementation.

## Deposit

* Persentase DP atau nominal tetap?
* Misalnya 20%, 30%, 50%?
* Apakah VIP memiliki DP berbeda?

## Hold Duration

Contoh:

```text
10 minutes
15 minutes
30 minutes
```

## Cancellation

* DP refundable?
* Refund sebagian?
* Batas waktu cancellation?
* Apa aturan no-show?

## Late Arrival

Contoh:

```text
Booking:
20:00

Customer arrives:
20:20
```

Apakah waktu tetap dihitung dari 20:00 atau session mulai 20:20?

## Grace Period

Berapa menit customer boleh melewati waktu selesai?

```text
0
5
10
15 minutes
```

## Buffer Time

Berapa menit yang dibutuhkan sebelum booking berikutnya?

## Extension

* Minimum extension?
* Increment 15 / 30 / 60 menit?
* Siapa yang boleh override?
* Apakah customer dapat extend sendiri?
* Apakah extension harus dibayar terlebih dahulu?

## Payment

* Static QRIS atau payment gateway?
* Bukti pembayaran wajib?
* Apakah admin dapat meminta upload ulang?

## Operating Hours

Contoh:

```text
10:00 - 02:00
```

Perlu diperhitungkan bahwa jam operasional dapat melewati tengah malam.

---

# 75. Recommended Initial Operational Policy

Untuk memulai prototype / MVP, gunakan aturan sederhana:

```text
Deposit:
30% dari total booking

Hold:
15 minutes

Payment:
QRIS / Cash at Counter

QRIS:
Upload proof + manual verification

Cash:
Verify directly by cashier

Extension:
15 / 30 / 60 minutes

Extension:
Only available if next booking allows it

Buffer:
10 minutes

No-show:
After 15 minutes grace period

WhatsApp:
Send after payment confirmation
```

Nilai-nilai di atas adalah **initial defaults untuk prototype**, bukan aturan bisnis final.

---

# 76. Core Product Principle

Sistem harus selalu memprioritaskan:

```text
1. Availability Accuracy
2. Booking Integrity
3. Payment Integrity
4. Operational Visibility
5. Customer Communication
```

Jangan membuat UI lebih dulu sebelum workflow ini stabil.

---

# 77. Core Workflow Source of Truth

Seluruh implementasi berikutnya harus mengacu pada workflow ini:

```text
                    CUSTOMER
                       │
                       ▼
              CHECK AVAILABILITY
                       │
                       ▼
                SELECT TABLE
                       │
                       ▼
                CREATE BOOKING
                       │
                       ▼
             AWAITING DEPOSIT
                       │
             ┌─────────┴─────────┐
             │                   │
            QRIS                CASH
             │                   │
             ▼                   ▼
       PAY + PROOF          PAY AT COUNTER
             │                   │
             └─────────┬─────────┘
                       ▼
                ADMIN VERIFY
                       │
                ┌──────┴──────┐
                │             │
             REJECT        CONFIRM
                │             │
                ▼             ▼
          PAYMENT         PAYMENT PAID
          REJECTED             │
                                ▼
                         BOOKING CONFIRMED
                                │
                                ▼
                         WHATSAPP SENT
                                │
                                ▼
                           CHECK-IN
                                │
                                ▼
                         SESSION ACTIVE
                                │
                       ┌────────┴────────┐
                       │                 │
                    EXTEND            FINISH
                       │                 │
                       ▼                 ▼
                CHECK AVAILABILITY   SESSION END
                       │                 │
                       ▼                 ▼
                  EXTENSION          CHECKOUT
                       │                 │
                       └────────┬────────┘
                                ▼
                            COMPLETED
                                │
                                ▼
                        TABLE AVAILABLE
```

---

# 78. Product Positioning

Produk ini dapat diposisikan sebagai:

> **Sistem booking dan operasional meja untuk tempat billiard.**

Bukan:

> “Website booking billiard.”

Perbedaannya penting.

Website hanya menjadi interface.

Core product sebenarnya adalah:

```text
Availability Engine
+
Reservation System
+
Deposit & Payment Verification
+
Table Operations
+
Session Management
+
Notification
```

---

# 79. Initial Technical Domain Map

Konsep domain awal:

```text
User
 │
 ├───────────────┐
 │               │
Customer       Staff
 │               │
 ▼               ▼
Booking       Admin Actions
 │
 ├── Table
 ├── Payment
 ├── Session
 ├── Extension
 └── Notification
```

Core entities yang kemungkinan dibutuhkan:

```text
users
customers
tables
table_types
bookings
booking_status_history
payments
payment_proofs
sessions
extensions
notifications
notification_logs
operating_hours
pricing_rules
maintenance_periods
audit_logs
```

Schema final belum ditentukan.

---

# 80. Final MVP Definition

MVP dianggap berhasil apabila customer dapat:

```text
Melihat meja tersedia
        ↓
Memilih waktu
        ↓
Memilih meja
        ↓
Membayar DP
        ↓
Menunggu verifikasi
        ↓
Mendapat WhatsApp
        ↓
Datang
        ↓
Check-in
        ↓
Bermain
        ↓
Extend jika slot memungkinkan
        ↓
Melakukan pelunasan
        ↓
Selesai
```

Dan kasir dapat:

```text
Melihat semua meja
        ↓
Melihat booking
        ↓
Memverifikasi DP
        ↓
Mendapatkan status meja yang akurat
        ↓
Check-in
        ↓
Memantau session
        ↓
Mengelola extension
        ↓
Checkout
```

---

# 81. Primary Success Metric

Nilai utama sistem dapat diukur dari:

```text
Booking yang berhasil
+
Penggunaan meja
+
Penurunan double booking
+
Penurunan customer harus datang hanya untuk mengecek meja
+
Kecepatan verifikasi pembayaran
+
Akurasi status meja
```

Produk tidak perlu memiliki puluhan fitur untuk membuktikan value.

Core test-nya sederhana:

> **Apakah customer bisa tahu meja mana yang tersedia, mengunci meja dengan DP, mendapatkan konfirmasi, lalu datang dan bermain tanpa proses manual yang membingungkan?**

Jika jawabannya ya, core product sudah bekerja.

---

# 82. Current Scope Boundary

Untuk tahap awal, sistem **belum membahas detail implementation framework, database engine, infrastructure, UI design, payment provider final, dan WhatsApp provider final**.

Dokumen ini menjadi:

> **Business Workflow + Domain Rules + MVP Product Specification**

Technical architecture baru dibuat setelah workflow bisnis dianggap stabil.