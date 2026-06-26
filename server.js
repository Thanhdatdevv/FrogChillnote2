// ==========================================
// FILE: index.js (THƯ MỤC GỐC DỰ ÁN)
// CHỈ KHỞI CHẠY PORT VÀ TRẢ VỀ FILE INDEX.HTML
// 
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 20191; // Sử dụng port của host cấp hoặc port mặc định 20191

// 1. Cấu hình định tuyến các file tĩnh (css, js, hình ảnh) nằm trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// 2. QUAN TRỌNG: Sửa lỗi "Cannot GET /" - Ép server trả về file index.html khi vào trang chủ
app.get('/', (req, res) => {
    // Đã sửa: Thêm dấu nháy đơn hợp lệ cho file 'index.html'
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Lắng nghe kết nối Socket.io cơ bản
io.on('connection', (socket) => {
    console.log(`💡 Có thiết bị vừa kết nối: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`❌ Thiết bị ngắt kết nối: ${socket.id}`);
    });
});

// Khởi chạy Server
http.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 SERVER GAME KHỞI CHẠY TẠI PORT: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
