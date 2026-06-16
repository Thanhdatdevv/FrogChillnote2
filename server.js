const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Cho phép đọc dữ liệu JSON và form gửi lên
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Nơi lưu trữ các ghi chú trong bộ nhớ tạm (RAM)
let notes = {};

// 1. Giao diện Web đơn giản để xem và sửa note trực tiếp
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Ghi chú Online</title>
            <style>
                body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
                textarea { width: 100%; height: 200px; margin-bottom: 10px; padding: 10px; }
                button { background: #238636; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 4px; }
            </style>
        </head>
        <body>
            <h2>Tạo Ghi Chú Mới</h2>
            <form action="/api/note" method="POST">
                <input type="text" name="title" placeholder="Tiêu đề ghi chú" style="width:100%; padding:8px; margin-bottom:10px;" required><br>
                <textarea name="content" placeholder="Nhập nội dung ghi chú ở đây..." required></textarea><br>
                <button type="submit">Lưu Ghi Chú</button>
            </form>
            <h3>Các ghi chú đã tạo:</h3>
            <ul>
                ${Object.keys(notes).map(id => `<li><a href="/api/note/${id}" target="_blank">${notes[id].title} (ID: ${id})</a></li>`).join('')}
            </ul>
        </body>
        </html>
    `);
});

// 2. API POST: Tạo một ghi chú mới (Giống anotepad API)
// Truy cập bằng Postman hoặc gửi từ Form web
app.post('/api/note', (req, res) => {
    const { title, content } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: "Nội dung không được để trống" });
    }

    // Tạo một ID ngẫu nhiên cho note
    const noteId = Math.random().toString(36).substr(2, 9);
    
    notes[noteId] = {
        title: title || "Ghi chú không tiêu đề",
        content: content,
        created_at: new Date()
    };

    // Nếu gửi từ trình duyệt (form) thì quay về trang chủ, nếu gọi API thì trả về JSON
    if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
        res.redirect('/');
    } else {
        res.json({
            status: "success",
            note_id: noteId,
            url: `${req.protocol}://${req.get('host')}/api/note/${noteId}`
        });
    }
});

// 3. API GET: Lấy nội dung của một ghi chú theo ID
app.get('/api/note/:id', (req, res) => {
    const note = notes[req.params.id];
    if (!note) {
        return res.status(404).json({ error: "Không tìm thấy ghi chú" });
    }
    res.json(note);
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
