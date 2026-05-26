# Orange Quiz Platform 🍊

Một nền tảng thi trắc nghiệm trực tuyến thế hệ mới, tích hợp Trí tuệ nhân tạo (AI) để mang lại trải nghiệm học tập cá nhân hóa, hiện đại và đầy cảm hứng.

![Hero Image](hero.png)

## 🌟 Tính năng đột phá

*   **🤖 AI Roadmap Generator:** Hệ thống phân tích kết quả bài thi và mục tiêu học tập để tạo ra lộ trình học tập 4 tuần cá nhân hóa bằng Google Gemini AI.
*   **📄 AI Document Scanner:** Tự động trích xuất câu hỏi từ các file PDF và Word (DOCX) với độ chính xác cao, giúp xây dựng ngân hàng đề thi chỉ trong tích tắc.
*   **✨ Giao diện Glassmorphism:** Trải nghiệm người dùng cao cấp với hiệu ứng kính mờ, chuyển động mượt mà và thiết kế hiện đại, tối ưu trên mọi thiết bị.
*   **🎲 Smart Quiz Engine:** Tự động lựa chọn đề thi ngẫu nhiên theo môn học, hỗ trợ xem lại đáp án chi tiết và giải thích ngay sau khi hoàn thành.
*   **📊 Analytics & Ranking:** Theo dõi tiến độ học tập qua biểu đồ và cạnh tranh vị trí dẫn đầu trên bảng xếp hạng thời gian thực.
*   **🛡️ Professional Admin Suite:** Công cụ quản trị mạnh mẽ giúp quản lý người dùng, đề thi và giám sát hệ thống một cách trực quan.

## 🛠️ Công nghệ sử dụng

Hệ thống được xây dựng với kiến trúc vững chắc và hiệu năng tối ưu:

*   **Frontend:** HTML5, Modern CSS3 (Glassmorphism UI), Vanilla JavaScript (ES6+).
*   **Backend:** Node.js, Express.js.
*   **AI Engine:** Google Gemini Pro API (Phân tích dữ liệu & Phục hồi kiến thức).
*   **Database:** PostgreSQL (Hệ quản trị cơ sở dữ liệu quan hệ mạnh mẽ).
*   **Processing:** `pdf-parse`, `mammoth` (Xử lý tài liệu chuyên sâu).
*   **Security:** JWT (JSON Web Token), Bcrypt (Mã hóa mật khẩu 10 vòng).

## 🚀 Hướng dẫn cài đặt nhanh

### 1. Yêu cầu hệ thống
*   **Node.js:** Phiên bản 18.x trở lên.
*   **PostgreSQL:** Đang chạy cục bộ hoặc trên cloud.
*   **Gemini API Key:** Lấy tại [Google AI Studio](https://aistudio.google.com/).

### 2. Khởi tạo dự án
```bash
# Di chuyển vào thư mục dự án
cd quiz3

# Cài đặt các phụ thuộc
npm install
```

### 3. Cấu hình môi trường
Tạo file `.env` tại thư mục gốc với các thông số sau:
```env
PORT=5000
DB_USER=your_user
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=orange_quiz
JWT_SECRET=your_super_secret_key
GEMINI_API_KEY=your_gemini_key_here
ADMIN_SECRET=ORANGE_ADMIN_2026
```

### 4. Thiết lập & Chạy ứng dụng
```bash
# Khởi tạo cơ sở dữ liệu và dữ liệu mẫu
node setup_db.js

# Khởi chạy server
node server.js
```
Mở trình duyệt và truy cập: `c`

## 📂 Cấu trúc dự án

```text
├── server.js           # Entry point của ứng dụng & API Routes
├── db.js               # Cấu hình kết nối PostgreSQL (Pool)
├── setup_db.js         # Script tạo bảng và khởi tạo schema
├── style.css           # Design System & Glassmorphism Styles
├── main.js             # Xử lý Logic Dashboard & UI Interactions
├── quiz.js             # Engine xử lý bài thi & Kết quả
├── index.html          # Trang chủ & Lựa chọn môn học
├── roadmap.html        # Tính năng Lộ trình học tập AI
├── admin.html          # Bảng điều khiển quản trị viên
└── profile.html        # Trang cá nhân & Lịch sử thi
```

---
> [!TIP]
> Để trải nghiệm tính năng AI tốt nhất, hãy đảm bảo bạn đã cung cấp đầy đủ thông tin khảo sát trong trang cá nhân trước khi tạo Lộ trình học tập.


