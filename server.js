const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Trạng thái game
let gameState = {
    timeRemaining: 30,
    status: 'Bắt đầu cược', // 'Bắt đầu cược' hoặc 'Đang mở mắt'
    lastResult: { dice: [1, 2, 3], total: 6, type: 'Xỉu' },
    history: [], // Lưu 10 phiên gần nhất
    totalTai: 0,
    totalXiu: 0
};

// Quản lý số dư người chơi (Lưu tạm vào RAM)
let players = {};

// Đếm thời gian Game vòng lặp vô hạn
setInterval(() => {
    if (gameState.timeRemaining > 0) {
        gameState.timeRemaining--;
    } else {
        if (gameState.status === 'Bắt đầu cược') {
            // Hết giờ cược -> Tiến hành lắc xúc xắc
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const total = d1 + d2 + d3;
            const type = total >= 11 ? 'Tài' : 'Xỉu';

            gameState.lastResult = { dice: [d1, d2, d3], total, type };
            gameState.history.push({ type, total });
            if (gameState.history.length > 10) gameState.history.shift();

            gameState.status = 'Đang mở mắt';
            gameState.timeRemaining = 10; // Đợi 10 giây xem kết quả rồi qua ván mới

            // Xử lý trả thưởng cho các socket đang cược
            io.emit('game-result', gameState.lastResult);
            
            // Reset tiền cược phiên mới
            gameState.totalTai = 0;
            gameState.totalXiu = 0;
        } else {
            // Hết thời gian chờ -> Sang phiên cược mới
            gameState.status = 'Bắt đầu cược';
            gameState.timeRemaining = 30;
        }
    }
    io.emit('time-update', gameState);
}, 1000);

io.on('connection', (socket) => {
    // Khởi tạo user mới khi kết nối
    players[socket.id] = {
        name: 'Khách_' + socket.id.substring(0, 4),
        balance: 50000 // Tặng sẵn 50k trải nghiệm
    };

    // Gửi thông tin ban đầu cho người chơi mới vào
    socket.emit('init-player', players[socket.id]);
    socket.emit('time-update', gameState);

    // Xử lý đặt cược
    socket.on('place-bet', (data) => {
        const { type, amount } = data;
        const player = players[socket.id];

        if (gameState.status !== 'Bắt đầu cược') {
            return socket.emit('notification', 'Hết thời gian đặt cược phiên này!');
        }
        if (player.balance < amount || amount <= 0) {
            return socket.emit('notification', 'Số dư không đủ hoặc tiền cược không hợp lệ!');
        }

        player.balance -= amount;
        if (type === 'Tài') gameState.totalTai += amount;
        if (type === 'Xỉu') gameState.totalXiu += amount;

        // Giả lập trả thưởng ngay nếu đoán đúng khi có kết quả
        // (Trong thực tế cần lưu thông tin cược của phiên để xử lý)
        
        socket.emit('update-balance', player.balance);
        io.emit('time-update', gameState); // Cập nhật tổng tiền cược hiển thị lên màn hình
        socket.emit('notification', `Đặt cược thành công ${amount.toLocaleString()}đ vào cửa ${type}`);
    });

    // Xử lý Chatbox
    socket.on('send-chat', (msg) => {
        const player = players[socket.id];
        io.emit('receive-chat', { name: player.name, message: msg });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

http.listen(PORT, () => {
    console.log(`Server Tài Xỉu đang chạy tại port ${PORT}`);
});
