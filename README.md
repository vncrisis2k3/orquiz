# EduFlow

Nền tảng ôn tập và thi trắc nghiệm trực tuyến dành cho học sinh THPT, tích hợp Google Gemini để hỗ trợ hỏi đáp, phân tích kết quả, tạo đề và xây dựng lộ trình học tập cá nhân hóa.

![EduFlow](public/hero.png)

## Tính năng

### Người dùng

- Làm bài kiểm tra theo môn học và khối lớp.
- Chế độ thi có đếm ngược và tự nộp khi hết giờ.
- Chế độ luyện tập không giới hạn thời gian.
- Xem điểm, đáp án sai, giải thích và phân tích kết quả bằng AI.
- Theo dõi điểm, cấp độ, streak và lịch sử làm bài.
- Xem bảng xếp hạng người dùng.
- Dark mode trên toàn bộ giao diện, tự lưu lựa chọn.

### StudyFlow Chatbot

- Chatbot học tập dùng chung cho mọi môn học.
- Lưu 10 lượt hỏi đáp gần nhất theo tài khoản trên trình duyệt.
- Đồng bộ lịch sử giữa chatbot nổi và trang chatbot riêng.
- Hiển thị công thức toán học bằng KaTeX.
- Mở toàn màn hình trên thiết bị di động.

### Roadmap

- Gemini tạo lộ trình học tập cá nhân hóa trong 4 tuần.
- Phân tích hồ sơ khảo sát và 5 kết quả kiểm tra gần nhất.
- Lưu và xem lại tối đa 5 roadmap gần nhất.
- Tương thích với dữ liệu roadmap cũ.

### Quản trị

- Quản lý người dùng và đề thi.
- Tạo đề thủ công hoặc tạo tự động bằng Gemini.
- Quét câu hỏi từ PDF và DOCX.
- Dashboard thống kê và biểu đồ.
- Cập nhật Gemini API key trực tiếp trong Admin.
- API key chỉ hiển thị dạng che và được lưu phía server.
- Dark mode dành cho giao diện Admin.

## Công nghệ

- Frontend: HTML5, CSS3, Vanilla JavaScript.
- Backend: Node.js, Express 5.
- Database: PostgreSQL.
- AI: Google Gemini qua `@google/generative-ai`.
- Tài liệu: `pdf-parse`, `mammoth`, `multer`.
- Bảo mật: JWT và bcrypt.
- Hiển thị toán học: KaTeX.
- Biểu đồ Admin: Chart.js.

## Yêu cầu

- Node.js 18 trở lên.
- PostgreSQL cục bộ hoặc dịch vụ cloud như Neon/Supabase.
- Gemini API key từ [Google AI Studio](https://aistudio.google.com/).

## Cài đặt

```bash
npm install
```

Tạo file `.env` tại thư mục gốc:

```env
PORT=5000
JWT_SECRET=replace_with_a_strong_secret
ADMIN_SECRET=replace_with_an_admin_secret
# Tùy chọn nếu sẽ cấu hình key trong Admin
GEMINI_API_KEY=your_gemini_api_key

# Dùng DATABASE_URL trên cloud
DATABASE_URL=postgresql://user:password@host:5432/database

# Hoặc cấu hình PostgreSQL riêng lẻ khi chạy local
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=eduflow
```

Không commit file `.env` hoặc Gemini API key lên Git.

## Khởi tạo database

```bash
npm run setup-db
```

Script tạo các bảng chính:

- `users`
- `subjects`
- `quizzes`
- `questions`
- `results`
- `system_settings`

`system_settings` lưu cấu hình Gemini do Admin cập nhật. Key trong database được ưu tiên hơn `GEMINI_API_KEY` trong `.env`.

## Chạy ứng dụng

```bash
npm start
```

Truy cập:

```text
http://localhost:5000
```

Các script có sẵn:

```bash
npm start
npm run dev
npm run setup-db
npm run seed
npm run migrate
```

## Cấu hình Gemini trong Admin

1. Đăng nhập bằng tài khoản có quyền Admin. Khi đăng ký Admin, dùng giá trị `ADMIN_SECRET` làm mã bí mật.
2. Mở mục **Cấu hình Gemini**.
3. Nhập API key mới và chọn **Lưu API key**.
4. Key mới có hiệu lực ngay, không cần khởi động lại server.

API không trả key đầy đủ về trình duyệt. Chỉ Admin đã xác thực mới có quyền xem trạng thái hoặc cập nhật key.

## Cấu trúc dự án

```text
.
├── api/
│   └── index.js           # Entry point cho Vercel
├── public/
│   ├── admin.html         # Trang quản trị
│   ├── auth.html          # Đăng nhập và đăng ký
│   ├── chatbot.html       # Trang StudyFlow Chatbot
│   ├── index.html         # Trang chủ
│   ├── leaderboard.html   # Bảng xếp hạng
│   ├── practice.html      # Chọn bài luyện tập
│   ├── profile.html       # Hồ sơ và lịch sử học tập
│   ├── quiz.html          # Giao diện làm bài
│   ├── quiz.js            # Logic thi và luyện tập
│   ├── roadmap.html       # Lộ trình học tập AI
│   ├── main.js            # Logic trang chủ và chatbot nổi
│   ├── style.css          # Style dùng chung và dark mode
│   └── theme.js           # Điều khiển theme sáng/tối
├── db.js                  # Kết nối PostgreSQL
├── migrate.js             # Migration bổ sung
├── seed_data.js           # Dữ liệu mẫu
├── server.js              # Express API và nghiệp vụ
├── setup_db.js            # Khởi tạo schema
└── vercel.json            # Cấu hình triển khai Vercel
```

## API chính

- `POST /api/register`
- `POST /api/login`
- `GET /api/auth/user`
- `GET /api/subjects`
- `GET /api/quizzes/:subject_id`
- `POST /api/results`
- `POST /api/chat`
- `GET /api/roadmap/history`
- `POST /api/roadmap/generate`
- `GET /api/admin/settings/gemini`
- `PUT /api/admin/settings/gemini`

Các API người dùng và Admin yêu cầu JWT trong header:

```http
x-auth-token: <token>
```

## Triển khai Vercel

Dự án đã có `vercel.json`:

- `/api/*` được chuyển đến `api/index.js`.
- File giao diện được phục vụ từ `public/`.

Khi triển khai, cần cấu hình các biến môi trường:

```text
DATABASE_URL
JWT_SECRET
ADMIN_SECRET
GEMINI_API_KEY (tùy chọn nếu sẽ cấu hình trong Admin)
```

Sau khi triển khai, Admin có thể thay Gemini API key trong giao diện mà không cần sửa biến môi trường.
