const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cơ sở dữ liệu lưu trữ tài khoản và số dư (Lưu trong RAM)
let users = {}; 
// Danh sách lưu thông tin cược của phiên hiện tại: { socketId: { username, type, amount } }
let currentBets = {}; 

// Trạng thái game toàn cục
let gameState = {
    timeRemaining: 30,
    status: 'Bắt đầu cược', // 'Bắt đầu cược' hoặc 'Đang mở mắt'
    lastResult: { dice: [1, 2, 3], total: 6, type: 'Xỉu' },
    history: [], // Lưu 12 phiên gần nhất
    totalTai: 0,
    totalXiu: 0
};

// --- API ĐĂNG KÝ / ĐĂNG NHẬP ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ status: 'error', msg: 'Vui lòng điền đầy đủ thông tin!' });
    if (users[username]) return res.json({ status: 'error', msg: 'Tài khoản này đã tồn tại!' });
    
    // Tạo tài khoản mới và tặng 500.000đ
    users[username] = {
        username: username,
        password: password,
        balance: 500000
    };
    res.json({ status: 'success', msg: 'Đăng ký thành công! Hãy đăng nhập.' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!users[username] || users[username].password !== password) {
        return res.json({ status: 'error', msg: 'Tài khoản hoặc mật khẩu không đúng!' });
    }
    res.json({ status: 'success', user: { username: username, balance: users[username].balance } });
});


// --- VÒNG LẶP LOGIC GAME REALTIME ---
setInterval(() => {
    if (gameState.timeRemaining > 0) {
        gameState.timeRemaining--;
    } else {
        if (gameState.status === 'Bắt đầu cược') {
            // 1. Hết giờ cược -> Lắc xúc xắc ngẫu nhiên
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const total = d1 + d2 + d3;
            const type = total >= 11 ? 'Tài' : 'Xỉu';

            gameState.lastResult = { dice: [d1, d2, d3], total, type };
            gameState.history.push({ type, total });
            if (gameState.history.length > 12) gameState.history.shift();

            gameState.status = 'Đang mở mắt';
            gameState.timeRemaining = 10; // Đợi 10 giây xem kết quả và trả thưởng

            // 2. XỬ LÝ FIX LỖI: TỰ ĐỘNG TÍNH TOÁN TRẢ THƯỞNG CHO AI THẮNG
            for (const socketId in currentBets) {
                const betInfo = currentBets[socketId];
                if (users[betInfo.username]) {
                    if (betInfo.type === type) {
                        // Thắng cược: Cộng lại tiền gốc + tiền thưởng (X2 số tiền cược)
                        const winAmount = betInfo.amount * 2;
                        users[betInfo.username].balance += winAmount;
                        
                        // Gửi thông báo thắng riêng cho socket đó
                        io.to(socketId).emit('bet-result', { 
                            status: 'win', 
                            msg: `🎉 Chúc mừng! Bạn đoán đúng cửa ${type} và nhận được +${winAmount.toLocaleString()}đ`,
                            newBalance: users[betInfo.username].balance
                        });
                    } else {
                        // Thua cược: Đã trừ tiền từ lúc đặt nên chỉ cần gửi thông báo thua
                        io.to(socketId).emit('bet-result', { 
                            status: 'lose', 
                            msg: `😭 Rất tiếc! Kết quả là ${type}, bạn đã cược sai.`,
                            newBalance: users[betInfo.username].balance
                        });
                    }
                }
            }

            // Phát kết quả xí ngầu cho mọi người xem công khai
            io.emit('game-result', gameState.lastResult);
            
            // Xóa sạch dữ liệu cược của phiên cũ để chuẩn bị phiên mới
            currentBets = {};
            gameState.totalTai = 0;
            gameState.totalXiu = 0;
        } else {
            // Hết 10 giây xem kết quả -> Sang phiên cược mới
            gameState.status = 'Bắt đầu cược';
            gameState.timeRemaining = 30;
        }
    }
    io.emit('time-update', gameState);
}, 1000);

// --- KẾT NỐI SOCKET ONLINE ---
io.on('connection', (socket) => {
    let currentLoggedUser = null;

    // Đăng ký định danh User khi họ đăng nhập thành công ngoài client
    socket.on('join-game', (username) => {
        if (users[username]) {
            currentLoggedUser = username;
            socket.emit('update-balance', users[username].balance);
        }
    });

    // XỬ LÝ FIX LỖI: ĐẶT CƯỢC (CHẶN CƯỢC 2 CỬA)
    socket.on('place-bet', (data) => {
        if (!currentLoggedUser) return socket.emit('notification', 'Bạn chưa đăng nhập!');
        if (gameState.status !== 'Bắt đầu cược') return socket.emit('notification', 'Hết thời gian đặt cược phiên này!');

        const { type, amount } = data;
        const user = users[currentLoggedUser];

        if (user.balance < amount || amount <= 0) {
            return socket.emit('notification', 'Số dư không đủ hoặc số tiền cược không hợp lệ!');
        }

        // BIỆN PHÁP CHẶN CƯỢC 2 CỬA: Kiểm tra nếu socket này đã đặt cược cửa khác trước đó
        if (currentBets[socket.id]) {
            return socket.emit('notification', `Bạn đã cược cửa [${currentBets[socket.id].type}] rồi, không được cược thêm cửa khác!`);
        }

        // Trừ tiền tài khoản ngay khi click đặt cược hợp lệ
        user.balance -= amount;
        
        // Lưu thông tin cược vào hệ thống tính thưởng của phiên
        currentBets[socket.id] = {
            username: currentLoggedUser,
            type: type,
            amount: amount
        };

        if (type === 'Tài') gameState.totalTai += amount;
        if (type === 'Xỉu') gameState.totalXiu += amount;

        socket.emit('update-balance', user.balance);
        io.emit('time-update', gameState); // Cập nhật tổng số tiền hiển thị lên thanh cửa cược
        socket.emit('notification', `Đặt cược thành công ${amount.toLocaleString()}đ vào cửa [${type}]`);
    });

    // Chatbox đồng bộ toàn bộ server
    socket.on('send-chat', (msg) => {
        if (!currentLoggedUser) return;
        io.emit('receive-chat', { name: currentLoggedUser, message: msg });
    });
});

http.listen(PORT, () => {
    console.log(`Server chạy ổn định tại port ${PORT}`);
});
