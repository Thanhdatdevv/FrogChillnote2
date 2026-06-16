const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Cho phép Server đọc dữ liệu JSON và text gửi lên
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Bộ nhớ tạm để lưu ghi chú (Khi restart Server trên Render, dữ liệu tạm này sẽ trống lại)
let myNote = "Chào mừng bạn đến với Notepad! Hãy sửa nội dung này bằng API.";

// 1. API Lấy nội dung ghi chú (Giống như việc bạn vào trang web để đọc)
app.get('/', (req, res) => {
    res.send(`
        <h1>My Notepad</h1>
        <p><strong>Nội dung hiện tại:</strong></p>
        <pre style="background: #f4f4f4; padding: 15px; border: 1px solid #ddd;">${myNote}</pre>
        <hr>
        <p>Để cập nhật code/nội dung trực tiếp, bạn có thể gửi request POST hoặc dùng Form bên dưới:</p>
        <form action="/update" method="POST">
            <textarea name="content" rows="10" cols="50">${myNote}</textarea><br><br>
            <button type="submit">Cập nhật Note</button>
        </form>
    `);
});

// API trả về JSON cho các ứng dụng khác cần lấy dữ liệu
app.get('/api/note', (req, res) => {
    res.json({ note: myNote });
});

// 2. API Cập nhật nội dung ghi chú (Sửa code/sửa text trực tiếp)
app.post('/update', (req, res) => {
    const newContent = req.body.content || req.body.note;
    
    if (newContent !== undefined) {
        myNote = newContent;
        // Nếu sửa từ giao diện web thì quay về trang chủ, nếu gửi API thì trả về JSON thành công
        if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
            res.redirect('/');
        } else {
            res.json({ success: true, message: "Đã cập nhật note thành công!", current_note: myNote });
        }
    } else {
        res.status(400).json({ success: false, message: "Không tìm thấy nội dung 'content' hoặc 'note' để cập nhật." });
    }
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
